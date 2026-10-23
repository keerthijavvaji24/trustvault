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
import { logAuditEvent } from '@/lib/audit/audit-logger'

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/**
 * Sanitized safe document metadata exposed after an update.
 * Guarantees `storage_path`, download URLs, and internal flags are never exposed.
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

export interface UpdateDocumentDependencies {
  /** Supabase client (authenticated session, NO service-role key) */
  supabaseClient?: any
  /** Resolver for the authenticated user + validated role */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

export interface UpdateDocumentInput {
  name?: unknown
  category?: unknown
  /** Captured only to guarantee client inputs for these fields are strictly ignored */
  [key: string]: unknown
}

export interface UpdateDocumentSuccessResult {
  status: 'success'
  document: SafeDocumentMetadata
}

export interface UpdateDocumentErrorResult {
  status: 'error'
  code: 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_input' | 'database_error'
  message: string
}

export type UpdateDocumentResult =
  | UpdateDocumentSuccessResult
  | UpdateDocumentErrorResult

// ---------------------------------------------------------------------------
// Helpers & Input Validators
// ---------------------------------------------------------------------------

/**
 * Transform a database row into sanitized metadata.
 * Explicitly excludes storage_path, deleted_at, etc.
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

/**
 * Validates a document name.
 * - Must be a non-empty string <= 255 characters.
 * - Rejects directory separators (/ and \) and path traversal sequences (..).
 * - Rejects null bytes, CRLF, and dangerous control characters.
 */
export function validateDocumentName(
  name: unknown
): { valid: boolean; value?: string; error?: string } {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Document name must be a string.' }
  }

  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Document name cannot be empty.' }
  }

  if (trimmed.length > 255) {
    return { valid: false, error: 'Document name cannot exceed 255 characters.' }
  }

  // Reject path traversal and directory separators
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return {
      valid: false,
      error: 'Document name must not contain path traversal characters or directory separators.',
    }
  }

  // Reject control characters and dangerous filename characters
  if (/[\0\r\n\x1F<>:"|?*]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Document name contains invalid or dangerous characters.',
    }
  }

  return { valid: true, value: trimmed }
}

/**
 * Validates a document category.
 * - Must be null or a string <= 100 characters.
 * - Allows alphanumeric characters, spaces, hyphens, and underscores.
 * - Rejects HTML tags, control characters, and injection sequences.
 */
export function validateDocumentCategory(
  category: unknown
): { valid: boolean; value?: string | null; error?: string } {
  if (category === null) {
    return { valid: true, value: null }
  }

  if (typeof category !== 'string') {
    return { valid: false, error: 'Category must be a string or null.' }
  }

  const trimmed = category.trim()
  if (trimmed.length === 0) {
    return { valid: true, value: null }
  }

  if (trimmed.length > 100) {
    return { valid: false, error: 'Category cannot exceed 100 characters.' }
  }

  // Reject control characters, HTML tags, and dangerous characters
  if (/[\0\r\n\x1F<>]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Category contains invalid or dangerous characters.',
    }
  }

  // Only allow alphanumeric characters, spaces, hyphens, and underscores
  if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Category contains invalid characters. Only alphanumeric characters, spaces, hyphens, and underscores are allowed.',
    }
  }

  return { valid: true, value: trimmed }
}

// ---------------------------------------------------------------------------
// Dependency-Injectable Core Update Logic
// ---------------------------------------------------------------------------

/**
 * Core document update logic, separated from Next.js route handling for testability.
 *
 * Security Guarantees:
 * 1. Server-Side Identity & Role: Verified strictly from session cookies;
 *    client-supplied user IDs, roles, or headers are NEVER trusted.
 * 2. Authorization Before Mutation: Calls `getDocumentAccess` to enforce:
 *    - Admin: May edit any non-deleted document.
 *    - Owner: May edit only their own non-deleted documents (`owner_id === user.id`).
 *    - Viewer: May edit ONLY if `document_permissions.can_edit === true`.
 *      Viewers with only `can_read === true` are denied with 403.
 *    - Revoked permission: Immediately denied with 403.
 *    - Unauthorized user: Denied with 403.
 *    - Nonexistent or soft-deleted document: Returns 404.
 * 3. Scope & Immutability:
 *    - Client CANNOT change `owner_id`, `storage_path`, or document `id`.
 *    - Only strictly validated `name` and `category` fields are written.
 *    - Re-checks `deleted_at IS NULL` during the update to prevent modifying soft-deleted docs.
 * 4. Safe Return Metadata: Returns only safe metadata; never exposes storage paths or download URLs.
 * 5. Uses standard authenticated Supabase client (publishable key + RLS); NEVER uses service-role key.
 * 6. Fails closed on any authentication, authorization, validation, or database error.
 */
export async function handleUpdateDocument(
  documentId: string,
  input: UpdateDocumentInput,
  deps?: UpdateDocumentDependencies
): Promise<UpdateDocumentResult> {
  // 1. Validate documentId input
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return {
      status: 'error',
      code: 'not_found',
      message: 'Invalid document ID provided.',
    }
  }

  const cleanDocId = documentId.trim()

  // 2. Validate input object
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: 'Request body must be a JSON object.',
    }
  }

  // 3. Validate name if provided
  let validatedName: string | undefined
  if ('name' in input && input.name !== undefined) {
    const nameValidation = validateDocumentName(input.name)
    if (!nameValidation.valid) {
      return {
        status: 'error',
        code: 'invalid_input',
        message: nameValidation.error!,
      }
    }
    validatedName = nameValidation.value
  }

  // 4. Validate category if provided
  let validatedCategory: string | null | undefined
  if ('category' in input && input.category !== undefined) {
    const catValidation = validateDocumentCategory(input.category)
    if (!catValidation.valid) {
      return {
        status: 'error',
        code: 'invalid_input',
        message: catValidation.error!,
      }
    }
    validatedCategory = catValidation.value
  }

  // 5. Ensure at least one updatable field is provided
  if (validatedName === undefined && validatedCategory === undefined) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: 'At least one valid metadata field (name or category) must be provided for update.',
    }
  }

  // 6. Obtain authenticated Supabase client (publishable key + RLS; NO service-role key)
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

  // 7. Check document authorization server-side on EVERY request BEFORE update
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

  if (accessResult.status === 'unauthenticated') {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: accessResult.error || 'Authentication required to update this document.',
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
    void logAuditEvent(
      {
        action: 'document.update',
        outcome: 'denied',
        documentId: cleanDocId,
        reason: accessResult.error || 'Access denied: you do not have permission to modify this document.',
      },
      { supabaseClient: supabase }
    )
    return {
      status: 'error',
      code: 'forbidden',
      message: accessResult.error || 'Access denied: you do not have permission to modify this document.',
    }
  }

  // Strict check on edit capability: canEdit MUST be true
  // Rejects viewers with read-only permission (can_read=true, can_edit=false)
  if (accessResult.status !== 'allowed' || !accessResult.canEdit) {
    void logAuditEvent(
      {
        action: 'document.update',
        outcome: 'denied',
        documentId: cleanDocId,
        reason: 'Access denied: edit permission (can_edit) is required to modify this document.',
      },
      { supabaseClient: supabase }
    )
    return {
      status: 'error',
      code: 'forbidden',
      message: 'Access denied: edit permission (can_edit) is required to modify this document.',
    }
  }

  // 8. Build safe update payload
  // Deliberately ignores and excludes client-supplied owner_id, storage_path, id, or arbitrary columns.
  const updatePayload: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }
  if (validatedName !== undefined) {
    updatePayload.name = validatedName
  }
  if (validatedCategory !== undefined) {
    updatePayload.category = validatedCategory
  }

  // 9. Execute update scoped strictly to the authorized document ID and non-deleted rows
  try {
    const { data: updatedDoc, error: updateError } = await supabase
      .from('documents')
      .update(updatePayload)
      .eq('id', cleanDocId)
      .is('deleted_at', null)
      .select('id, name, category, owner_id, created_at, updated_at, mime_type, deleted_at')
      .maybeSingle()

    if (updateError) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to update document: ${updateError.message}`,
      }
    }

    if (!updatedDoc || updatedDoc.deleted_at) {
      return {
        status: 'error',
        code: 'not_found',
        message: 'Document not found or has been deleted.',
      }
    }

    void logAuditEvent(
      {
        action: 'document.update',
        outcome: 'allowed',
        documentId: cleanDocId,
        details: {
          fields_updated: [
            ...(validatedName !== undefined ? ['name'] : []),
            ...(validatedCategory !== undefined ? ['category'] : []),
          ],
        },
      },
      { supabaseClient: supabase }
    )
    return {
      status: 'success',
      document: mapToSafeDocumentMetadata(updatedDoc),
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Database update error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

/**
 * PATCH /api/documents/:id
 *
 * Secure server-side document update endpoint:
 * - Requires verified authenticated session on every request.
 * - Reuses canonical document authorization logic from `lib/auth/document-access.ts`.
 * - Admin: Allowed for any non-deleted document.
 * - Owner: Allowed only for documents they own.
 * - Viewer: Allowed ONLY when `document_permissions.can_edit === true`.
 * - Unauthorized / Read-only viewer: Denied (403).
 * - Nonexistent / Soft-deleted document: Denied (404).
 * - Validates name and category strictly server-side; rejects path traversal or dangerous input.
 * - Client cannot change `owner_id`, `storage_path`, or `id`.
 * - Returns only safe metadata; never exposes `storage_path` or download URLs.
 * - Never uses the service-role key.
 */
export async function PATCH(
  request: NextRequest,
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

  let body: any
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Invalid JSON request body.', code: 'invalid_input' },
      { status: 400 }
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

  const result = await handleUpdateDocument(documentId, body, {
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
            : result.code === 'invalid_input'
              ? 400
              : 500

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
