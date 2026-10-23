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

/**
 * RFC 4122 UUID v4 regex used for validating the target user ID from the URL.
 * Accepts all UUID versions (v1–v5) and nil UUID since Supabase can use any.
 */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

/** Safe permission record returned to the client after grant/update. */
export interface SafePermissionRecord {
  document_id: string
  user_id: string
  can_read: boolean
  can_edit: boolean
}

/** Input for granting/updating a permission. */
export interface GrantPermissionInput {
  can_read: unknown
  can_edit: unknown
  [key: string]: unknown // captured only to detect extra fields
}

export interface ManagePermissionDependencies {
  /** Authenticated Supabase client (NO service-role key). */
  supabaseClient?: any
  /** Resolver for the authenticated (requesting) user + validated role. */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

export interface PermissionSuccessResult {
  status: 'success'
  permission: SafePermissionRecord
}

export interface RevokeSuccessResult {
  status: 'success'
  revoked: true
  document_id: string
  user_id: string
}

export interface PermissionErrorResult {
  status: 'error'
  code:
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'invalid_input'
    | 'database_error'
  message: string
}

export type GrantPermissionResult = PermissionSuccessResult | PermissionErrorResult
export type RevokePermissionResult = RevokeSuccessResult | PermissionErrorResult

// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------

/** Returns true if the string is a valid UUID (any version). */
export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim())
}

/**
 * Validates and sanitizes a grant-permission request body.
 *
 * Rules:
 * - `can_read` and `can_edit` must both be explicit booleans.
 * - `can_edit = true` with `can_read = false` is rejected (inconsistent semantics).
 * - Reject unknown/extra fields to prevent mass-assignment attacks.
 * - Never allow client to modify document metadata or ownership.
 */
export function validateGrantInput(body: unknown): {
  valid: boolean
  canRead?: boolean
  canEdit?: boolean
  error?: string
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object.' }
  }

  const raw = body as Record<string, unknown>

  // Allowlist: only can_read and can_edit are accepted
  const allowedKeys = new Set(['can_read', 'can_edit'])
  const extraKeys = Object.keys(raw).filter((k) => !allowedKeys.has(k))
  if (extraKeys.length > 0) {
    return {
      valid: false,
      error: `Request body contains unexpected fields: ${extraKeys.join(', ')}. Only can_read and can_edit are accepted.`,
    }
  }

  if (!('can_read' in raw)) {
    return { valid: false, error: 'Missing required field: can_read (boolean).' }
  }
  if (!('can_edit' in raw)) {
    return { valid: false, error: 'Missing required field: can_edit (boolean).' }
  }

  if (typeof raw.can_read !== 'boolean') {
    return { valid: false, error: 'Field can_read must be a boolean (true or false).' }
  }
  if (typeof raw.can_edit !== 'boolean') {
    return { valid: false, error: 'Field can_edit must be a boolean (true or false).' }
  }

  const canRead = raw.can_read as boolean
  const canEdit = raw.can_edit as boolean

  // Reject inconsistent permission: can_edit=true requires can_read=true
  if (canEdit && !canRead) {
    return {
      valid: false,
      error:
        'Inconsistent permissions: can_edit=true requires can_read=true. ' +
        'A user with edit access must also have read access.',
    }
  }

  return { valid: true, canRead, canEdit }
}

// ---------------------------------------------------------------------------
// Authorization Check Helper
// ---------------------------------------------------------------------------

/**
 * Checks whether the requesting user (identified from server session) is authorized
 * to manage permissions on the given document.
 *
 * Authorization rules:
 * - Admin: may manage permissions on any non-deleted document.
 * - Owner: may manage permissions only on documents they own.
 * - Viewer: NEVER authorized to manage permissions, even if can_edit = true.
 * - Unauthenticated / missing profile / invalid role: fail closed.
 *
 * Returns a structured result with the authorized document record so callers
 * can use the server-verified `document_id` for database writes.
 */
async function checkPermissionAuthority(
  documentId: string,
  deps: ManagePermissionDependencies
): Promise<
  | {
      authorized: true
      userId: string
      documentId: string
      role: string
    }
  | {
      authorized: false
      code: PermissionErrorResult['code']
      message: string
    }
> {
  const cleanDocId = documentId.trim()

  const accessOptions: DocumentAccessOptions = {
    supabaseClient: deps.supabaseClient,
    currentUserResolver: deps.currentUserResolver ?? getCurrentUserWithProfile,
  }

  let accessResult: any
  try {
    accessResult = await getDocumentAccess(cleanDocId, accessOptions)
  } catch (err) {
    return {
      authorized: false,
      code: 'forbidden',
      message: `Authorization check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  if (accessResult.status === 'unauthenticated') {
    return {
      authorized: false,
      code: 'unauthenticated',
      message: accessResult.error || 'Authentication required.',
    }
  }

  if (accessResult.status === 'not_found') {
    return {
      authorized: false,
      code: 'not_found',
      message: accessResult.error || 'Document not found or access denied.',
    }
  }

  if (accessResult.status === 'forbidden') {
    return {
      authorized: false,
      code: 'forbidden',
      message: accessResult.error || 'Access denied: you do not have permission to manage this document.',
    }
  }

  if (accessResult.status !== 'allowed') {
    return {
      authorized: false,
      code: 'forbidden',
      message: 'Access denied: authorization check did not succeed.',
    }
  }

  const userRole = accessResult.user?.role
  const accessReason = accessResult.reason

  // Viewer: NEVER allowed to manage permissions, regardless of can_edit
  if (userRole === 'viewer') {
    return {
      authorized: false,
      code: 'forbidden',
      message: 'Access denied: viewer accounts are not permitted to manage document permissions.',
    }
  }

  // Owner must be accessing their own document (defense-in-depth on access reason)
  if (userRole === 'owner' && accessReason !== 'owner') {
    return {
      authorized: false,
      code: 'forbidden',
      message: 'Access denied: you may only manage permissions for documents you own.',
    }
  }

  if (userRole !== 'admin' && userRole !== 'owner') {
    return {
      authorized: false,
      code: 'forbidden',
      message: 'Access denied: permission management requires admin or owner role.',
    }
  }

  return {
    authorized: true,
    userId: accessResult.user.id,
    documentId: cleanDocId,
    role: userRole,
  }
}

// ---------------------------------------------------------------------------
// Target User Validation
// ---------------------------------------------------------------------------

/**
 * Verifies that the target user exists in public.profiles.
 * Returns `{ exists: true }` on success, or `{ exists: false, error }` on failure.
 *
 * Security: Never exposes profile data other than existence confirmation.
 * Uses the authenticated (non-service-role) Supabase client.
 */
export async function verifyTargetUserExists(
  supabase: any,
  targetUserId: string
): Promise<{ exists: boolean; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .maybeSingle()

    if (error) {
      return { exists: false, error: `Failed to verify target user: ${error.message}` }
    }

    return { exists: Boolean(data) }
  } catch (err) {
    return {
      exists: false,
      error: `Target user verification error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Core: Grant / Update Permission
// ---------------------------------------------------------------------------

/**
 * Grants or updates permission for a target user on a specific document.
 *
 * Security Guarantees:
 * 1. Authorization runs BEFORE any database write.
 * 2. document_id comes only from the verified URL param (never from client body).
 * 3. target_user_id comes only from the verified URL param.
 * 4. Only can_read and can_edit are written; all other fields are ignored.
 * 5. Uses upsert (ON CONFLICT DO UPDATE) for idempotent, race-safe operation.
 * 6. Verifies the target user exists in public.profiles before writing.
 * 7. Prevents a requester from granting themselves access (self-grant blocked).
 * 8. Viewer role is explicitly denied even if they have can_edit access.
 * 9. Owner can only manage their own documents.
 * 10. Admin can manage any non-deleted document.
 * 11. Never exposes storage_path, document metadata, or profile secrets.
 * 12. No service-role key.
 */
export async function handleGrantPermission(
  documentId: string,
  targetUserId: string,
  input: unknown,
  deps?: ManagePermissionDependencies
): Promise<GrantPermissionResult> {
  // 1. Validate documentId from URL path
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return { status: 'error', code: 'not_found', message: 'Invalid document ID.' }
  }

  // 2. Validate targetUserId as a UUID
  if (!isValidUUID(targetUserId)) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: 'Target user ID must be a valid UUID.',
    }
  }

  const cleanDocId = documentId.trim()
  const cleanTargetId = targetUserId.trim()

  // 3. Initialize Supabase client
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

  const effectiveDeps: ManagePermissionDependencies = {
    supabaseClient: supabase,
    currentUserResolver: deps?.currentUserResolver ?? getCurrentUserWithProfile,
  }

  // 4. Check authorization (runs getDocumentAccess; admin/owner only; viewer denied)
  const authCheck = await checkPermissionAuthority(cleanDocId, effectiveDeps)
  if (!authCheck.authorized) {
    return {
      status: 'error',
      code: authCheck.code,
      message: authCheck.message,
    }
  }

  // 5. Self-grant prevention: requester cannot grant themselves access
  if (authCheck.userId === cleanTargetId) {
    return {
      status: 'error',
      code: 'forbidden',
      message: 'You cannot grant permissions to yourself.',
    }
  }

  // 6. Validate request body input
  const validation = validateGrantInput(input)
  if (!validation.valid) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: validation.error!,
    }
  }

  const { canRead, canEdit } = validation

  // 7. Verify target user exists in public.profiles
  const targetCheck = await verifyTargetUserExists(supabase, cleanTargetId)
  if (!targetCheck.exists) {
    return {
      status: 'error',
      code: 'not_found',
      message: targetCheck.error
        ? `Target user not found: ${targetCheck.error}`
        : 'Target user does not exist.',
    }
  }

  // 8. Upsert permission record (idempotent; safe for repeated grant/update calls)
  // Writes can_read, can_edit, and server-verified granted_by (authenticated user ID).
  // Never touches document metadata or storage_path.
  // Conflicts on (document_id, user_id) are resolved by updating the permission flags and granted_by.
  try {
    const { data, error: upsertError } = await supabase
      .from('document_permissions')
      .upsert(
        {
          document_id: cleanDocId,
          user_id: cleanTargetId,
          can_read: canRead,
          can_edit: canEdit,
          granted_by: authCheck.userId,
        },
        {
          onConflict: 'document_id,user_id',
          ignoreDuplicates: false, // always update on conflict
        }
      )
      .select('document_id, user_id, can_read, can_edit')
      .maybeSingle()

    if (upsertError) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to save permission: ${upsertError.message}`,
      }
    }

    if (!data) {
      return {
        status: 'error',
        code: 'database_error',
        message: 'Permission upsert did not return a record.',
      }
    }

    // 9. Return safe record only — never expose storage_path or document metadata
    const safeRecord: SafePermissionRecord = {
      document_id: data.document_id,
      user_id: data.user_id,
      can_read: Boolean(data.can_read),
      can_edit: Boolean(data.can_edit),
    }

    return { status: 'success', permission: safeRecord }
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Permission upsert error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Core: Revoke Permission
// ---------------------------------------------------------------------------

/**
 * Revokes (deletes) the permission record for a target user on a document.
 *
 * Security Guarantees:
 * 1. Authorization runs BEFORE any database write.
 * 2. document_id and target_user_id come only from verified URL params.
 * 3. The delete is scoped to the exact (document_id, user_id) pair.
 * 4. Viewer role is always denied.
 * 5. Owner can only revoke permissions on their own documents.
 * 6. Admin can revoke permissions on any non-deleted document.
 * 7. Safe response: never returns storage_path, document metadata, or profile data.
 * 8. Idempotent: revoking a non-existent permission returns success (already revoked).
 * 9. No service-role key.
 *
 * After revocation:
 * - getDocumentAccess immediately denies viewer access (no caching).
 * - Document listing, download, and update immediately fail for the revoked user.
 */
export async function handleRevokePermission(
  documentId: string,
  targetUserId: string,
  deps?: ManagePermissionDependencies
): Promise<RevokePermissionResult> {
  // 1. Validate documentId from URL path
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return { status: 'error', code: 'not_found', message: 'Invalid document ID.' }
  }

  // 2. Validate targetUserId as a UUID
  if (!isValidUUID(targetUserId)) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: 'Target user ID must be a valid UUID.',
    }
  }

  const cleanDocId = documentId.trim()
  const cleanTargetId = targetUserId.trim()

  // 3. Initialize Supabase client
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

  const effectiveDeps: ManagePermissionDependencies = {
    supabaseClient: supabase,
    currentUserResolver: deps?.currentUserResolver ?? getCurrentUserWithProfile,
  }

  // 4. Check authorization (runs getDocumentAccess; admin/owner only; viewer denied)
  const authCheck = await checkPermissionAuthority(cleanDocId, effectiveDeps)
  if (!authCheck.authorized) {
    return {
      status: 'error',
      code: authCheck.code,
      message: authCheck.message,
    }
  }

  // 5. Delete the permission record scoped to the verified (document_id, user_id) pair
  try {
    const { error: deleteError } = await supabase
      .from('document_permissions')
      .delete()
      .eq('document_id', cleanDocId)
      .eq('user_id', cleanTargetId)

    if (deleteError) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Failed to revoke permission: ${deleteError.message}`,
      }
    }

    // Idempotent: no error if permission did not exist (already revoked)
    return {
      status: 'success',
      revoked: true,
      document_id: cleanDocId,
      user_id: cleanTargetId,
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Permission revoke error: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handlers
// ---------------------------------------------------------------------------

type RouteContext = {
  params: Promise<{ id: string; userId: string }> | { id: string; userId: string }
}

/**
 * PUT /api/documents/:id/permissions/:userId
 *
 * Grant or update read/write permission for a named user on a specific document.
 *
 * Authorization:
 * - Admin: may manage permissions on any non-deleted document.
 * - Owner: may manage permissions only on documents they own.
 * - Viewer: always forbidden, even with can_edit = true.
 * - Unauthenticated: 401.
 *
 * Request body:
 * { "can_read": boolean, "can_edit": boolean }
 *
 * Security:
 * - document_id and target user_id come only from URL params (never trusted from body).
 * - Body is strictly validated; unknown fields rejected.
 * - can_edit=true with can_read=false is rejected (400).
 * - Target user must exist in public.profiles.
 * - Requester cannot grant themselves access (403).
 * - Uses upsert for idempotent, race-safe permission saves.
 * - Never exposes storage_path or document metadata.
 * - No service-role key.
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const resolvedParams = await Promise.resolve(context?.params)
  const documentId = resolvedParams?.id
  const targetUserId = resolvedParams?.userId

  if (!documentId || !targetUserId) {
    return Response.json(
      { error: 'Document ID and user ID are required.', code: 'not_found' },
      { status: 404 }
    )
  }

  let body: unknown
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
      { error: 'Server configuration error.', code: 'database_error' },
      { status: 500 }
    )
  }

  const result = await handleGrantPermission(documentId, targetUserId, body, {
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

  return Response.json({ permission: result.permission }, { status: 200 })
}

/**
 * DELETE /api/documents/:id/permissions/:userId
 *
 * Revoke all access for a named user on a specific document.
 *
 * Authorization: same as PUT above.
 *
 * Security:
 * - Scoped delete: only removes the (document_id, user_id) row.
 * - Idempotent: safe to call multiple times (already-revoked is success).
 * - Revocation takes effect immediately on next getDocumentAccess call (no cache).
 * - Never exposes storage_path or document metadata.
 * - No service-role key.
 */
export async function DELETE(
  _request: NextRequest,
  context: RouteContext
): Promise<Response> {
  const resolvedParams = await Promise.resolve(context?.params)
  const documentId = resolvedParams?.id
  const targetUserId = resolvedParams?.userId

  if (!documentId || !targetUserId) {
    return Response.json(
      { error: 'Document ID and user ID are required.', code: 'not_found' },
      { status: 404 }
    )
  }

  let supabase: any
  try {
    supabase = await createClient()
  } catch {
    return Response.json(
      { error: 'Server configuration error.', code: 'database_error' },
      { status: 500 }
    )
  }

  const result = await handleRevokePermission(documentId, targetUserId, {
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
    { revoked: true, document_id: result.document_id, user_id: result.user_id },
    { status: 200 }
  )
}
