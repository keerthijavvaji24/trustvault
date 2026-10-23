import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getDocumentAccess,
  type DocumentAccessOptions,
} from '@/lib/auth/document-access'
import {
  getCurrentUserWithProfile,
  type AuthUserWithRoleResult,
} from '@/lib/auth/roles'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Private Supabase Storage bucket. Never use a public bucket. */
const STORAGE_BUCKET = 'documents' as const

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Sanitized safe document metadata returned after a successful deletion.
 * Guarantees `storage_path`, download URLs, and internal paths are never exposed.
 */
export interface SafeDeletedDocumentMetadata {
  id: string
  name: string
  category: string | null
  owner_id: string
  created_at: string
  deleted_at: string
}

export interface DeleteDocumentDependencies {
  /** Supabase client (authenticated session, NO service-role key) */
  supabaseClient?: any
  /** Resolver for the authenticated user + validated role */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

export interface DeleteDocumentSuccessResult {
  status: 'success'
  document: SafeDeletedDocumentMetadata
}

export interface DeleteDocumentErrorResult {
  status: 'error'
  code: 'unauthenticated' | 'forbidden' | 'not_found' | 'storage_error' | 'database_error'
  message: string
}

export type DeleteDocumentResult =
  | DeleteDocumentSuccessResult
  | DeleteDocumentErrorResult

// ---------------------------------------------------------------------------
// Dependency-Injectable Core Delete Logic
// ---------------------------------------------------------------------------

/**
 * Core document deletion logic, separated from Next.js route handling for testability.
 *
 * Security Guarantees:
 * 1. Server-Side Identity & Role: Verified strictly from session cookies;
 *    client-supplied user IDs, roles, or headers are NEVER trusted.
 * 2. Authorization Before Any Mutation: Calls `getDocumentAccess` BEFORE touching
 *    Supabase Storage or updating the database. Authorization must succeed first.
 * 3. Role Enforcement for Deletion:
 *    - Admin: May delete any non-deleted document.
 *    - Owner: May delete ONLY their own non-deleted documents (owner_id === user.id).
 *    - Viewer: NEVER permitted to delete, even if can_edit = true.
 *      This is enforced by explicitly checking user.role after authorization succeeds.
 *    - Unauthorized user / missing profile / invalid role: Denied with 403.
 *    - Unauthenticated: Denied with 401.
 *    - Nonexistent or already soft-deleted document: Returns 404.
 * 4. Server-Derived Storage Path: `storage_path` is ALWAYS obtained from the
 *    authorized database record. Client-supplied paths are NEVER accepted.
 * 5. Document ID: Accepted ONLY from the URL path. Never from body, query, or headers.
 * 6. Soft-Delete Only: Sets `deleted_at`; does NOT physically delete the database row.
 * 7. Failure Window & Recovery Strategy:
 *    - Storage deletion and Postgres soft-deletion are NOT atomic (no distributed transaction).
 *    - Order: (a) Authorize -> (b) Storage.remove() -> (c) DB update(deleted_at).
 *    - If Storage deletion FAILS: abort immediately; DB update is NOT attempted.
 *      The document record remains intact and accessible.
 *    - If Storage deletion SUCCEEDS but DB update FAILS: The storage object is gone
 *      but `deleted_at` is not set. The document row remains visible (non-deleted).
 *      This is a partial-failure window. Recovery: a background reconciliation job
 *      (to be implemented separately) should detect documents whose storage object
 *      no longer exists and retry the soft-delete, or an operator can set `deleted_at`
 *      manually. The response returns HTTP 500 with code `database_error` so the caller
 *      knows the operation did not fully complete.
 * 8. Safe Return: Returns only sanitized metadata; never exposes storage_path.
 * 9. Uses standard authenticated Supabase client; NEVER uses service-role key.
 */
export async function handleDeleteDocument(
  documentId: string,
  deps?: DeleteDocumentDependencies
): Promise<DeleteDocumentResult> {
  // 1. Validate documentId -- taken from URL path only; never from client body
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return {
      status: 'error',
      code: 'not_found',
      message: 'Invalid document ID provided.',
    }
  }

  const cleanDocId = documentId.trim()

  // 2. Obtain authenticated Supabase client (publishable key + RLS; NO service-role key)
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

  // 3. Evaluate document authorization server-side on EVERY request BEFORE any mutation.
  // Reuses the canonical authorization logic from lib/auth/document-access.ts.
  const accessOptions: DocumentAccessOptions = {
    supabaseClient: supabase,
    currentUserResolver: deps?.currentUserResolver ?? getCurrentUserWithProfile,
  }

  let accessResult: any
  try {
    accessResult = await getDocumentAccess(cleanDocId, accessOptions)
  } catch (err) {
    return {
      status: 'error',
      code: 'forbidden',
      message: `Authorization check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  // Map authorization statuses to fail-closed delete errors.
  if (accessResult.status === 'unauthenticated') {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: accessResult.error || 'Authentication required to delete this document.',
    }
  }

  if (accessResult.status === 'not_found') {
    return {
      status: 'error',
      code: 'not_found',
      message: accessResult.error || 'Document not found or access denied.',
    }
  }

  if (accessResult.status === 'forbidden') {
    return {
      status: 'error',
      code: 'forbidden',
      message: accessResult.error || 'Access denied: you do not have permission to delete this document.',
    }
  }

  if (accessResult.status !== 'allowed') {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: authorization check did not succeed.',
    }
  }

  // 4. Enforce role-based delete authorization.
  //
  // CRITICAL: Viewers MUST NEVER be allowed to delete, even if can_edit = true.
  // getDocumentAccess() can return 'allowed' for viewers with explicit permissions.
  // We must explicitly block them here because delete is a privileged operation
  // that is NOT part of the edit permission model.
  //
  // Only 'admin' or 'owner' roles may delete.
  const userRole = accessResult.user?.role
  const accessReason = accessResult.reason

  if (userRole === 'viewer') {
    // Viewer explicitly denied regardless of can_edit or can_read flags.
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: viewer accounts are not permitted to delete documents.',
    }
  }

  if (userRole !== 'admin' && userRole !== 'owner') {
    // Unknown or missing role -- fail closed.
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: delete permission requires admin or owner role.',
    }
  }

  // For owner role: access must be granted as 'owner' (their own document).
  // getDocumentAccess already enforces owner_id === user.id, but we validate
  // the reason explicitly as a defense-in-depth measure.
  if (userRole === 'owner' && accessReason !== 'owner') {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: owner accounts may only delete their own documents.',
    }
  }

  // 5. Retrieve verified storage path from the authorized database record.
  // NEVER accept storage_path from the client (request body, query, or headers).
  const authorizedDoc = accessResult.document
  if (!authorizedDoc || !authorizedDoc.storagePath) {
    return {
      status: 'error',
      code: 'not_found',
      message: 'Document storage record is missing or invalid.',
    }
  }

  // The storage path was extracted exclusively from the authorized DB record.
  const verifiedStoragePath = authorizedDoc.storagePath

  // 6. Delete the storage object ONLY AFTER authorization has succeeded.
  //    If this fails, abort immediately -- do NOT soft-delete the DB row.
  try {
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([verifiedStoragePath])

    if (storageError) {
      return {
        status: 'error',
        code: 'storage_error',
        message: `Failed to delete file from storage: ${storageError.message}`,
      }
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'storage_error',
      message: `Storage deletion error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  // 7. Soft-delete the database record by setting deleted_at.
  //    - Scoped strictly to the authorized document ID (prevents IDOR).
  //    - Guarded by `deleted_at IS NULL` (prevents double-deletion races).
  //    - If this fails after Storage deletion, return database_error.
  //      The storage object is already deleted; see failure window docs above.
  const nowIso = new Date().toISOString()

  try {
    const { data: deletedDoc, error: dbError } = await supabase
      .from('documents')
      .update({ deleted_at: nowIso })
      .eq('id', cleanDocId)
      .is('deleted_at', null)
      .select('id, name, category, owner_id, created_at, deleted_at')
      .maybeSingle()

    if (dbError) {
      // Storage object is already gone but DB soft-delete failed.
      // Partial-failure state: document row remains visible until reconciled.
      return {
        status: 'error',
        code: 'database_error',
        message: `Storage object deleted but database soft-delete failed: ${dbError.message}. Manual reconciliation required.`,
      }
    }

    if (!deletedDoc) {
      // No row matched id + deleted_at IS NULL.
      // Document may have been concurrently deleted between auth and update.
      return {
        status: 'error',
        code: 'not_found',
        message: 'Document was not found or was already deleted during the operation.',
      }
    }

    // 8. Return safe metadata only -- never expose storage_path.
    const safeMetadata: SafeDeletedDocumentMetadata = {
      id: deletedDoc.id,
      name: deletedDoc.name,
      category: deletedDoc.category ?? null,
      owner_id: deletedDoc.owner_id,
      created_at: deletedDoc.created_at,
      deleted_at: deletedDoc.deleted_at,
    }

    return {
      status: 'success',
      document: safeMetadata,
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Database soft-delete error: ${err instanceof Error ? err.message : 'unknown error'}. Manual reconciliation may be required.`,
    }
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

/**
 * DELETE /api/documents/:id/delete
 *
 * Secure server-side document deletion endpoint:
 * - Authenticates request on every call using session cookies.
 * - Reuses canonical document authorization logic from `lib/auth/document-access.ts`.
 * - Admin: Allowed to delete any non-deleted document.
 * - Owner: Allowed only to delete their own non-deleted documents.
 * - Viewer: NEVER allowed to delete, even if can_edit = true.
 * - Unauthorized / missing profile / invalid role: Denied (403).
 * - Unauthenticated: Denied (401).
 * - Nonexistent or already soft-deleted document: Denied (404).
 * - Obtains `storage_path` strictly from the authorized database document record.
 * - Storage is NEVER accessed if authorization fails.
 * - Performs soft-delete (sets deleted_at); does NOT physically delete the row.
 * - Returns only safe metadata; never exposes storage_path.
 * - Never uses the service-role key.
 *
 * Failure Window:
 * Storage and DB are NOT in a distributed transaction. If Storage deletion succeeds
 * but DB soft-delete fails, a partial failure state exists. See handleDeleteDocument
 * for the full recovery strategy documentation.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
): Promise<Response> {
  const resolvedParams = await Promise.resolve(context?.params)
  const documentId = resolvedParams?.id

  if (!documentId) {
    return Response.json(
      { error: 'Document ID is required.', code: 'not_found' },
      { status: 404 }
    )
  }

  let supabase: any
  try {
    supabase = await createClient()
  } catch {
    return Response.json(
      {
        error: 'Server configuration error. Unable to initialize database client.',
        code: 'database_error',
      },
      { status: 500 }
    )
  }

  const result = await handleDeleteDocument(documentId, {
    supabaseClient: supabase,
    currentUserResolver: getCurrentUserWithProfile,
  })

  if (result.status === 'error') {
    const httpStatus =
      result.code === 'unauthenticated'
        ? 401
        : result.code === 'forbidden'
          ? 403
          : result.code === 'not_found'
            ? 404
            : 500 // storage_error or database_error

    return Response.json(
      { error: result.message, code: result.code },
      { status: httpStatus }
    )
  }

  return Response.json(
    { document: result.document },
    { status: 200 }
  )
}
