import { createClient } from '../supabase/server'
import {
  getCurrentUserWithProfile,
  type AuthUserWithRoleResult,
  type UserRole,
} from './roles'

/**
 * Supported permission levels for document access.
 * - 'read': Allows viewing and downloading the document.
 * - 'edit': Allows viewing, downloading, and future modifications.
 */
export type DocumentPermissionLevel = 'read' | 'edit'

/**
 * Authorization reason detailing how access was granted.
 */
export type DocumentAccessReason = 'admin' | 'owner' | 'explicit_permission'

/**
 * Minimal sanitized document information returned upon authorized access.
 * Leaks no internal database internals beyond authorized fields.
 */
export interface DocumentSummary {
  id: string
  ownerId: string
  name: string
  category: string
  storagePath: string
  mimeType: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Discriminated union for document authorization results.
 * Distinguishes unauthenticated, not_found, forbidden, and allowed statuses,
 * enabling API endpoints and Server Actions to return precise HTTP status codes
 * (401, 404, 403, 200) without leaking sensitive cross-tenant data.
 */
export type DocumentAccessResult =
  | {
      status: 'unauthenticated'
      error: string
    }
  | {
      status: 'not_found'
      error: string
    }
  | {
      status: 'forbidden'
      error: string
      role?: UserRole
    }
  | {
      status: 'allowed'
      accessLevel: DocumentPermissionLevel
      canRead: boolean
      canEdit: boolean
      reason: DocumentAccessReason
      document: DocumentSummary
      user: {
        id: string
        email?: string
        role: UserRole
      }
    }

/**
 * Optional dependencies for dependency injection (primarily used in unit/integration tests).
 * In production callers, this parameter is left undefined.
 */
export interface DocumentAccessOptions {
  /**
   * Custom Supabase client instance (mock or alternative client).
   */
  supabaseClient?: any
  /**
   * Custom authenticated user & role resolver.
   */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

/**
 * Server-only document authorization utility.
 *
 * Security Boundary & Guarantees:
 * 1. Server-Side Enforcement: All authorization decisions are evaluated strictly
 *    on the server. Browser-supplied roles, user IDs, or client parameters are NEVER trusted.
 * 2. Identity Verification: User identity is extracted from verified Supabase session cookies
 *    and verified against public.profiles.
 * 3. Fail Closed: Any failure (unauthenticated session, missing profile, invalid role,
 *    missing document, missing permission, or database error) results in denial.
 * 4. IDOR / Cross-Document Protection: Documents are fetched by ID and cross-checked against
 *    the authenticated user's ID, role, and explicit rows in public.document_permissions.
 * 5. Immediate Revocation: Every invocation performs fresh database lookups with NO caching.
 *    Any revoked permission stops working immediately on the next request.
 * 6. Role Boundaries:
 *    - Admin: Full access across application documents (verified via public.profiles).
 *    - Owner: Full access to documents they own (documents.owner_id === user.id).
 *             Does NOT automatically gain access to other owners' documents.
 *    - Viewer: Access ONLY if an explicit, active row exists in public.document_permissions.
 */
export async function getDocumentAccess(
  documentId: string,
  options?: DocumentAccessOptions
): Promise<DocumentAccessResult> {
  // Enforce server-only boundary
  if (typeof window !== 'undefined') {
    throw new Error('getDocumentAccess can only be called from a server environment.')
  }

  // 1. Validate documentId input to avoid spurious DB queries or injection
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return {
      status: 'not_found',
      error: 'Invalid document ID provided.',
    }
  }

  const cleanDocId = documentId.trim()

  // 2. Resolve authenticated user and validated application role from public.profiles
  const authResolver = options?.currentUserResolver ?? getCurrentUserWithProfile
  let authResult: AuthUserWithRoleResult

  try {
    authResult = await authResolver()
  } catch (err) {
    return {
      status: 'forbidden',
      error: `Authentication verification failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }

  if (authResult.status === 'unauthenticated') {
    return {
      status: 'unauthenticated',
      error: authResult.error || 'Authentication required to access documents.',
    }
  }

  if (authResult.status === 'profile_not_found') {
    return {
      status: 'forbidden',
      error: 'User profile does not exist in public.profiles. Access denied.',
    }
  }

  if (authResult.status === 'invalid_role') {
    return {
      status: 'forbidden',
      error: 'User has an invalid or unrecognized application role. Access denied.',
    }
  }

  const { user, profile } = authResult

  // 3. Obtain Supabase server client
  let supabase: any
  try {
    supabase = options?.supabaseClient ?? (await createClient())
  } catch (err) {
    return {
      status: 'forbidden',
      error: `Failed to initialize database client: ${err instanceof Error ? err.message : 'Unknown error'}`,
    }
  }

  // 4. Query the target document from public.documents
  // Select only columns required for authorization and summary
  const { data: document, error: docError } = await supabase
    .from('documents')
    .select('id, owner_id, name, category, storage_path, mime_type, created_at, updated_at, deleted_at')
    .eq('id', cleanDocId)
    .maybeSingle()

  if (docError) {
    return {
      status: 'not_found',
      error: `Document query failed: ${docError.message}`,
    }
  }

  // Fail closed if document does not exist or has been soft-deleted
  if (!document || document.deleted_at) {
    return {
      status: 'not_found',
      error: 'Document not found or access denied.',
    }
  }

  const documentSummary: DocumentSummary = {
    id: document.id,
    ownerId: document.owner_id,
    name: document.name,
    category: document.category,
    storagePath: document.storage_path,
    mimeType: document.mime_type ?? null,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  }

  // 5. Evaluate Access Rules

  // Rule 1: ADMIN ACCESS
  // Admin role grants system-wide document access. Admin role is verified server-side.
  if (profile.role === 'admin') {
    return {
      status: 'allowed',
      accessLevel: 'edit',
      canRead: true,
      canEdit: true,
      reason: 'admin',
      document: documentSummary,
      user: {
        id: user.id,
        email: user.email,
        role: profile.role,
      },
    }
  }

  // Rule 2: OWNER ACCESS
  // An owner can access a document they own (documents.owner_id === user.id).
  if (profile.role === 'owner' && document.owner_id === user.id) {
    return {
      status: 'allowed',
      accessLevel: 'edit',
      canRead: true,
      canEdit: true,
      reason: 'owner',
      document: documentSummary,
      user: {
        id: user.id,
        email: user.email,
        role: profile.role,
      },
    }
  }

  // Rule 2 Corollary & Rule 3: VIEWER / EXPLICIT COLLABORATOR ACCESS
  // - An owner does NOT automatically gain access to another owner's document.
  // - A viewer does NOT gain access via ownership.
  // - Access requires an explicit, active row in public.document_permissions.
  // - Immediate Revocation: Always query current database state on every evaluation.
  const { data: permData, error: permError } = await supabase
    .from('document_permissions')
    .select('id, document_id, user_id, can_read, can_edit')
    .eq('document_id', document.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (permError) {
    return {
      status: 'forbidden',
      error: `Failed to evaluate document permissions: ${permError.message}`,
      role: profile.role,
    }
  }

  // If no explicit permission row exists for this user and document, fail closed
  if (!permData) {
    return {
      status: 'forbidden',
      error: 'Access denied: you do not have permission to access this document.',
      role: profile.role,
    }
  }

  // Check explicit permission flags in public.document_permissions
  const canEdit = Boolean(permData.can_edit)
  const canRead = Boolean(permData.can_read) || canEdit // edit permission inherently allows read/download

  // If both flags are false, permission has been revoked or deactivated
  if (!canRead && !canEdit) {
    return {
      status: 'forbidden',
      error: 'Access denied: permission is not active or has been revoked.',
      role: profile.role,
    }
  }

  // Supported permission levels: exactly 'read' or 'edit'
  const accessLevel: DocumentPermissionLevel = canEdit ? 'edit' : 'read'

  return {
    status: 'allowed',
    accessLevel,
    canRead: true,
    canEdit,
    reason: 'explicit_permission',
    document: documentSummary,
    user: {
      id: user.id,
      email: user.email,
      role: profile.role,
    },
  }
}

/**
 * Convenience helper to check if the current user has read access to a document.
 * Returns true only if authorization succeeds with read capability.
 */
export async function canReadDocument(
  documentId: string,
  options?: DocumentAccessOptions
): Promise<boolean> {
  const result = await getDocumentAccess(documentId, options)
  return result.status === 'allowed' && result.canRead
}

/**
 * Convenience helper to check if the current user has edit access to a document.
 * Returns true only if authorization succeeds with edit capability.
 */
export async function canEditDocument(
  documentId: string,
  options?: DocumentAccessOptions
): Promise<boolean> {
  const result = await getDocumentAccess(documentId, options)
  return result.status === 'allowed' && result.canEdit
}
