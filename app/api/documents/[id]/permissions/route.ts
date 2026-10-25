import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDocumentAccess, type DocumentAccessOptions } from '@/lib/auth/document-access'
import { getCurrentUserWithProfile, type AuthUserWithRoleResult } from '@/lib/auth/roles'
import { logAuditEvent } from '@/lib/audit/audit-logger'

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export interface PermissionRecord {
  user_id: string
  full_name: string | null
  can_read: boolean
  can_edit: boolean
  created_at: string
  updated_at: string
}

export interface ListPermissionsSuccessResult {
  status: 'success'
  permissions: PermissionRecord[]
}

export interface ListPermissionsErrorResult {
  status: 'error'
  code: 'unauthenticated' | 'forbidden' | 'not_found' | 'database_error'
  message: string
}

export type ListPermissionsResult = ListPermissionsSuccessResult | ListPermissionsErrorResult

export interface ListPermissionsDependencies {
  /** Authenticated Supabase client (NO service-role key) */
  supabaseClient?: any
  /** Resolver for the authenticated user + validated role */
  currentUserResolver?: () => Promise<AuthUserWithRoleResult>
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

export async function handleListPermissions(
  documentId: string,
  deps?: ListPermissionsDependencies
): Promise<ListPermissionsResult> {
  // 1. Validate document ID
  if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
    return { status: 'error', code: 'not_found', message: 'Invalid document ID.' }
  }

  const cleanDocId = documentId.trim()

  // 2. Initialise Supabase client
  let supabase: any
  try {
    supabase = deps?.supabaseClient ?? (await createClient())
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Failed to initialise Supabase client: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  const accessOptions: DocumentAccessOptions = {
    supabaseClient: supabase,
    currentUserResolver: deps?.currentUserResolver ?? getCurrentUserWithProfile,
  }

  // 3. Authorization – ensure document exists and user is owner or admin
  let accessResult: any
  try {
    accessResult = await getDocumentAccess(cleanDocId, accessOptions)
  } catch (err) {
    return { status: 'error', code: 'forbidden', message: `Authorization check failed: ${err instanceof Error ? err.message : 'unknown error'}` }
  }

  if (accessResult.status === 'unauthenticated') {
    return { status: 'error', code: 'unauthenticated', message: accessResult.error || 'Authentication required.' }
  }
  if (accessResult.status === 'not_found') {
    return { status: 'error', code: 'not_found', message: accessResult.error || 'Document not found.' }
  }
  if (accessResult.status === 'forbidden') {
    void logAuditEvent({ action: 'permissions.list', outcome: 'denied', documentId: cleanDocId, reason: accessResult.error }, { supabaseClient: supabase })
    return { status: 'error', code: 'forbidden', message: accessResult.error || 'Access denied.' }
  }

  // Only owners or admins may list permissions
  const role = accessResult.user?.role
  if (role !== 'admin' && role !== 'owner') {
    void logAuditEvent({ action: 'permissions.list', outcome: 'denied', documentId: cleanDocId, reason: 'Insufficient role' }, { supabaseClient: supabase })
    return { status: 'error', code: 'forbidden', message: 'Only owners or admins may view permissions.' }
  }

  // 4. Fetch permission rows WITHOUT a nested profiles embed.
  //    document_permissions has more than one relationship to profiles, so
  //    PostgREST cannot infer which one to embed. Profiles are fetched
  //    separately below.
  const { data, error } = await supabase
    .from('document_permissions')
    .select('user_id, can_read, can_edit, created_at, updated_at')
    .eq('document_id', cleanDocId)

  if (error) {
    void logAuditEvent({ action: 'permissions.list', outcome: 'error', documentId: cleanDocId, reason: error.message }, { supabaseClient: supabase })
    return { status: 'error', code: 'database_error', message: `Failed to fetch permissions: ${error.message}` }
  }

  const permissionRows: any[] = data ?? []

  // 5. Fetch the related profile names separately (id + full_name only)
  const userIds: string[] = Array.from(
    new Set(
      permissionRows
        .map((row: any) => row.user_id)
        .filter((id: any): id is string => typeof id === 'string')
    )
  )

  const nameByUserId = new Map<string, string | null>()

  if (userIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)

    if (profileError) {
      void logAuditEvent({ action: 'permissions.list', outcome: 'error', documentId: cleanDocId, reason: profileError.message }, { supabaseClient: supabase })
      return { status: 'error', code: 'database_error', message: `Failed to fetch user profiles: ${profileError.message}` }
    }

    for (const profileRow of (profileRows ?? []) as any[]) {
      nameByUserId.set(profileRow.id, profileRow.full_name ?? null)
    }
  }

  const permissions: PermissionRecord[] = permissionRows.map((row: any) => ({
    user_id: row.user_id,
    full_name: nameByUserId.get(row.user_id) ?? null,
    can_read: Boolean(row.can_read),
    can_edit: Boolean(row.can_edit),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  void logAuditEvent({ action: 'permissions.list', outcome: 'allowed', documentId: cleanDocId }, { supabaseClient: supabase })
  return { status: 'success', permissions }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> | { id: string } }): Promise<Response> {
  const resolvedParams = await Promise.resolve(context?.params)
  const documentId = resolvedParams?.id

  if (!documentId) {
    return Response.json({ error: 'Document ID is required.', code: 'not_found' }, { status: 404 })
  }

  const result = await handleListPermissions(documentId, {
    currentUserResolver: getCurrentUserWithProfile,
  })

  if (result.status === 'error') {
    const statusMap: Record<string, number> = {
      unauthenticated: 401,
      forbidden: 403,
      not_found: 404,
    }
    const httpStatus = statusMap[result.code] ?? 500
    return Response.json({ error: result.message, code: result.code }, { status: httpStatus })
  }

  return Response.json({ permissions: result.permissions }, { status: 200 })
}
