import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getCurrentUserWithProfile,
  type AuthUserWithRoleResult,
} from '@/lib/auth/roles'

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Sanitized, safe document metadata exposed to clients.
 *
 * Security guarantees:
 * - NEVER exposes `storage_path`.
 * - NEVER exposes direct storage or signed download URLs.
 * - NEVER exposes internal soft-delete flags (`deleted_at`).
 */
export interface SafeDocumentMetadata {
  id: string
  name: string
  category: string | null
  owner_id: string
  created_at: string
  updated_at: string
  mime_type?: string | null
}

export interface ListDocumentsDependencies {
  /** Supabase client (authenticated session, NO service-role key) */
  supabaseClient?: any
  /** Resolver for the authenticated user + validated role */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

export interface ListDocumentsSuccessResult {
  status: 'success'
  documents: SafeDocumentMetadata[]
}

export interface ListDocumentsErrorResult {
  status: 'error'
  code: 'unauthenticated' | 'forbidden' | 'database_error'
  message: string
}

export type ListDocumentsResult = ListDocumentsSuccessResult | ListDocumentsErrorResult

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Transform a database row from public.documents into a sanitized metadata object.
 * Explicitly omits storage_path, deleted_at, and any other internal columns.
 */
export function mapToSafeDocumentMetadata(row: any): SafeDocumentMetadata {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    mime_type: row.mime_type ?? null,
  }
}

// ---------------------------------------------------------------------------
// Core Listing Logic (Dependency-Injectable for Testability)
// ---------------------------------------------------------------------------

/**
 * Core document listing logic separated from Next.js route handling.
 *
 * Security Guarantees:
 * 1. Server-Side Identity & Role Resolution: User ID and role are strictly
 *    resolved from verified session cookies via `currentUserResolver`.
 *    Client-supplied headers, query parameters, or body values are NEVER trusted.
 * 2. Role Boundaries:
 *    - Admin: May list all non-deleted documents.
 *    - Owner: May list only their own non-deleted documents (`owner_id === user.id`).
 *    - Viewer: May list only non-deleted documents for which they have an explicit
 *      row in `public.document_permissions` with `can_read === true`.
 * 3. Soft-Delete Exclusion: Documents with `deleted_at != null` are strictly excluded
 *    at both database query level and in-memory defense-in-depth filtering.
 * 4. Safe Metadata Only: No storage paths, internal keys, or download URLs are returned.
 * 5. Row-Level Security: Uses standard authenticated Supabase client; NEVER uses
 *    or exposes the Supabase service-role key.
 * 6. Fails closed on any authentication, role, or database error.
 */
export async function handleListDocuments(
  deps?: ListDocumentsDependencies
): Promise<ListDocumentsResult> {
  // 1. Resolve authenticated user and validated application role
  const resolver = deps?.currentUserResolver ?? getCurrentUserWithProfile
  let authResult: AuthUserWithRoleResult

  try {
    authResult = await resolver()
  } catch (err) {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: `Authentication check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  if (authResult.status === 'unauthenticated') {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: authResult.error || 'Authentication required to list documents.',
    }
  }

  if (authResult.status === 'profile_not_found') {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'User profile does not exist in public.profiles. Access denied.',
    }
  }

  if (authResult.status === 'invalid_role') {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'User has an invalid or unrecognized application role. Access denied.',
    }
  }

  const { user, profile } = authResult
  const role = profile.role

  // Validate recognized role
  if (role !== 'admin' && role !== 'owner' && role !== 'viewer') {
    return {
      status: 'error',
      code: 'forbidden',
      message: `Role "${role}" is not permitted to list documents.`,
    }
  }

  // 2. Initialize authenticated Supabase client (Publishable key + RLS; NO service-role key)
  let supabase: any
  try {
    supabase = deps?.supabaseClient ?? (await createClient())
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Failed to initialize database client: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  // 3. Query documents according to verified server-side role

  // ── Role: ADMIN ───────────────────────────────────────────────────────────
  // Admins may list all non-deleted documents across the application.
  if (role === 'admin') {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, category, owner_id, created_at, updated_at, mime_type, deleted_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to query documents: ${error.message}`,
      }
    }

    const documents = (data ?? [])
      .filter((doc: any) => !doc.deleted_at)
      .map(mapToSafeDocumentMetadata)

    return {
      status: 'success',
      documents,
    }
  }

  // ── Role: OWNER ───────────────────────────────────────────────────────────
  // Owners may list only their own non-deleted documents.
  // owner_id is strictly derived from the verified user session (never from client).
  if (role === 'owner') {
    const { data, error } = await supabase
      .from('documents')
      .select('id, name, category, owner_id, created_at, updated_at, mime_type, deleted_at')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (error) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to query documents: ${error.message}`,
      }
    }

    const documents = (data ?? [])
      .filter((doc: any) => !doc.deleted_at && doc.owner_id === user.id)
      .map(mapToSafeDocumentMetadata)

    return {
      status: 'success',
      documents,
    }
  }

  // ── Role: VIEWER ──────────────────────────────────────────────────────────
  // Viewers may list only non-deleted documents for which they have an explicit
  // document_permissions record with can_read = true.
  if (role === 'viewer') {
    // Step A: Query explicit active read permissions for this viewer
    const { data: perms, error: permError } = await supabase
      .from('document_permissions')
      .select('document_id, can_read')
      .eq('user_id', user.id)
      .eq('can_read', true)

    if (permError) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to query document permissions: ${permError.message}`,
      }
    }

    const allowedDocIds: string[] = Array.from(
      new Set(
        (perms ?? [])
          .filter((p: any) => p && p.can_read === true && typeof p.document_id === 'string')
          .map((p: any) => p.document_id)
      )
    )

    // If viewer has no permitted documents, return empty array immediately
    if (allowedDocIds.length === 0) {
      return {
        status: 'success',
        documents: [],
      }
    }

    // Step B: Query documents matching the explicitly permitted document IDs
    const { data, error: docError } = await supabase
      .from('documents')
      .select('id, name, category, owner_id, created_at, updated_at, mime_type, deleted_at')
      .in('id', allowedDocIds)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (docError) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to query documents: ${docError.message}`,
      }
    }

    const allowedSet = new Set(allowedDocIds)
    const documents = (data ?? [])
      .filter((doc: any) => !doc.deleted_at && allowedSet.has(doc.id))
      .map(mapToSafeDocumentMetadata)

    return {
      status: 'success',
      documents,
    }
  }

  return {
    status: 'error',
    code: 'forbidden',
    message: 'Access denied.',
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

/**
 * GET /api/documents
 *
 * Secure document listing endpoint:
 * - Admin: lists all non-deleted documents.
 * - Owner: lists only their own non-deleted documents.
 * - Viewer: lists only non-deleted documents with explicit can_read = true in document_permissions.
 *
 * Security:
 * - Authenticates on every request using session cookies.
 * - Ignores all client-supplied parameters, headers, or query strings for identity/roles/ownership.
 * - Excludes soft-deleted documents.
 * - Never exposes storage paths or download URLs.
 * - Uses publishable key with RLS; never uses service-role key.
 */
export async function GET(_request: NextRequest): Promise<Response> {
  let supabase: any
  try {
    supabase = await createClient()
  } catch {
    return Response.json(
      { error: 'Server configuration error. Unable to initialize database client.' },
      { status: 500 }
    )
  }

  const result = await handleListDocuments({
    supabaseClient: supabase,
    currentUserResolver: getCurrentUserWithProfile,
  })

  if (result.status === 'error') {
    const httpStatus =
      result.code === 'unauthenticated'
        ? 401
        : result.code === 'forbidden'
          ? 403
          : 500

    return Response.json(
      { error: result.message, code: result.code },
      { status: httpStatus }
    )
  }

  return Response.json(
    { documents: result.documents },
    { status: 200 }
  )
}
