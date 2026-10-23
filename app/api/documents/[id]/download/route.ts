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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename for safe inclusion in the Content-Disposition header.
 * - Strips HTTP header injection characters (\r, \n)
 * - Strips quotes (") to prevent breaking header parameter delimiters
 * - Strips path traversal characters (/ and \)
 * - Falls back to a safe default if empty
 */
export function sanitizeDownloadFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'document'
  }
  const sanitized = filename
    .replace(/[\r\n\0\x1F"]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
  return sanitized.length > 0 ? sanitized : 'document'
}

// ---------------------------------------------------------------------------
// Dependency-Injectable Download Core
// ---------------------------------------------------------------------------

export interface DownloadDependencies {
  /** Supabase client (authenticated session, NO service-role key) */
  supabaseClient?: any
  /** Resolver for the authenticated user + validated role */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

export interface DownloadSuccessResult {
  status: 'success'
  data: ArrayBuffer
  name: string
  mimeType: string
}

export interface DownloadErrorResult {
  status: 'error'
  code: 'unauthenticated' | 'forbidden' | 'not_found' | 'storage_error' | 'database_error'
  message: string
}

export type DownloadResult = DownloadSuccessResult | DownloadErrorResult

/**
 * Core document download logic, separated from Next.js route handling for testability.
 *
 * Security Guarantees:
 * 1. Server-Side Identity: Authenticated via server-side session cookies. Client-supplied
 *    user IDs, roles, or headers are NEVER trusted.
 * 2. Authorization Before Storage Access: Calls `getDocumentAccess` to enforce:
 *    - Admin: Full download access.
 *    - Owner: May only download documents they own (`owner_id === user.id`).
 *    - Viewer: May only download documents with an active explicit `can_read === true` permission.
 *    - Revoked/inactive permissions: Immediately denied with 403.
 *    - Unauthorized user: Denied with 403 without storage access.
 *    - Nonexistent or soft-deleted document: Returns 404 without leaking other tenants' data.
 * 3. Server-Derived Storage Path: `storage_path` is ALWAYS obtained from the verified database
 *    record. Client-supplied paths are NEVER trusted or used.
 * 4. Private Storage Only: Uses the private "documents" bucket. No public URLs are generated.
 * 5. Fails closed on any authentication, authorization, database, or storage error.
 */
export async function handleDownload(
  documentId: string,
  deps?: DownloadDependencies
): Promise<DownloadResult> {
  // 1. Validate documentId input
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return {
      status: 'error',
      code: 'not_found',
      message: 'Invalid document ID provided.',
    }
  }

  const cleanDocId = documentId.trim()

  // 2. Initialize authenticated Supabase client (publishable key + RLS; NO service-role key)
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

  // 3. Evaluate document authorization server-side on EVERY request
  // Reuses the canonical authorization logic from lib/auth/document-access.ts
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

  // Map authorization statuses to fail-closed download errors
  if (accessResult.status === 'unauthenticated') {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: accessResult.error || 'Authentication required to download this document.',
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
      message: accessResult.error || 'Access denied: you do not have permission to download this document.',
    }
  }

  if (accessResult.status !== 'allowed' || !accessResult.canRead) {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: read permission required to download this document.',
    }
  }

  // 4. Retrieve verified storage path from authorized database record
  // NEVER trust or accept storage paths from the client.
  const authorizedDoc = accessResult.document
  if (!authorizedDoc || !authorizedDoc.storagePath) {
    return {
      status: 'error',
      code: 'not_found',
      message: 'Document storage record is missing.',
    }
  }

  // 5. Download object from private Supabase Storage bucket
  // Storage access occurs ONLY after document authorization has succeeded.
  let storageData: any
  try {
    const { data, error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(authorizedDoc.storagePath)

    if (storageError || !data) {
      return {
        status: 'error',
        code: 'storage_error',
        message: `Failed to download file from storage: ${storageError?.message || 'Storage object not found.'}`,
      }
    }

    storageData = data
  } catch (err) {
    return {
      status: 'error',
      code: 'storage_error',
      message: `Storage download error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  // 6. Convert downloaded data to ArrayBuffer
  let arrayBuffer: ArrayBuffer
  try {
    if (typeof storageData.arrayBuffer === 'function') {
      arrayBuffer = await storageData.arrayBuffer()
    } else if (Buffer.isBuffer(storageData)) {
      const copy = new Uint8Array(storageData)
      arrayBuffer = copy.buffer.slice(
        copy.byteOffset,
        copy.byteOffset + copy.byteLength
      ) as ArrayBuffer
    } else {
      arrayBuffer = await new Blob([storageData]).arrayBuffer()
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'storage_error',
      message: `Failed to process downloaded file data: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  return {
    status: 'success',
    data: arrayBuffer,
    name: authorizedDoc.name,
    mimeType: authorizedDoc.mimeType || 'application/octet-stream',
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

/**
 * GET /api/documents/:id/download
 *
 * Secure server-side document download endpoint:
 * - Authenticates request on every call using session cookies.
 * - Reuses canonical document authorization logic from `lib/auth/document-access.ts`.
 * - Admin: Allowed.
 * - Owner: Allowed only for documents they own.
 * - Viewer: Allowed only with active, explicit `can_read === true` permission.
 * - Revoked permission: Immediately denied (403).
 * - Unauthorized user: Denied (403).
 * - Nonexistent or soft-deleted document: Denied (404).
 * - Obtains `storage_path` strictly from the authorized database document record.
 * - Storage is NEVER accessed if authorization fails.
 * - Streams file bytes directly with safe Content-Disposition and MIME headers;
 *   never returns permanent public URLs or exposes storage paths.
 */
export async function GET(
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
      { error: 'Server configuration error. Unable to initialize database client.' },
      { status: 500 }
    )
  }

  const result = await handleDownload(documentId, {
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
            : 500

    return Response.json(
      { error: result.message, code: result.code },
      { status: httpStatus }
    )
  }

  return new Response(result.data, {
    status: 200,
    headers: {
      'Content-Type': result.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${sanitizeDownloadFilename(result.name)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
    },
  })
}
