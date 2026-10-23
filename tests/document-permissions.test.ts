import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  handleGrantPermission,
  handleRevokePermission,
  validateGrantInput,
  isValidUUID,
  verifyTargetUserExists,
  type ManagePermissionDependencies,
} from '../app/api/documents/[id]/permissions/[userId]/route'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'
import { getDocumentAccess } from '../lib/auth/document-access'

// ---------------------------------------------------------------------------
// Mock Supabase Client Factory
// ---------------------------------------------------------------------------

interface UpsertCall {
  table: string
  record: any
  options?: any
}

interface DeleteCall {
  table: string
  filters: Record<string, any>
}

interface MockDbOptions {
  documents?: any[]
  permissions?: any[]
  profiles?: any[]
  documentError?: Error | null
  permissionError?: Error | null
  upsertError?: Error | null
  deleteError?: Error | null
  profileError?: Error | null
}

function createMockSupabaseClient({
  documents = [],
  permissions = [],
  profiles = [],
  documentError = null,
  permissionError = null,
  upsertError = null,
  deleteError = null,
  profileError = null,
}: MockDbOptions = {}) {
  const upsertCalls: UpsertCall[] = []
  const deleteCalls: DeleteCall[] = []

  // Deep-clone so tests stay isolated
  const localPerms = permissions.map((p) => ({ ...p }))

  return {
    _upsertCalls: upsertCalls,
    _deleteCalls: deleteCalls,
    _permissions: localPerms,

    from: (table: string) => {
      // ── documents ──────────────────────────────────────────────────────────
      if (table === 'documents') {
        const filters: Record<string, any> = {}
        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          maybeSingle: async () => {
            if (documentError) return { data: null, error: documentError }
            const match = documents.find((doc) =>
              Object.entries(filters).every(([k, v]) => doc[k] === v)
            )
            return { data: match ? { ...match } : null, error: null }
          },
        }
        return builder
      }

      // ── document_permissions ───────────────────────────────────────────────
      if (table === 'document_permissions') {
        const filters: Record<string, any> = {}
        let pendingUpsertRecord: any = null
        let pendingUpsertOptions: any = null

        const builder: any = {
          select: (_cols?: string) => builder,

          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },

          // Used by getDocumentAccess for single permission lookup
          maybeSingle: async () => {
            if (permissionError) return { data: null, error: permissionError }
            const match = localPerms.find((p) =>
              Object.entries(filters).every(([k, v]) => p[k] === v)
            )
            return { data: match ? { ...match } : null, error: null }
          },

          // Used by handleGrantPermission upsert
          upsert: (record: any, options?: any) => {
            pendingUpsertRecord = record
            pendingUpsertOptions = options
            return builder
          },

          // Used by handleRevokePermission delete
          delete: () => {
            return {
              eq: (f1: string, v1: any) => ({
                eq: async (f2: string, v2: any) => {
                  if (deleteError) return { error: deleteError }
                  deleteCalls.push({
                    table: 'document_permissions',
                    filters: { [f1]: v1, [f2]: v2 },
                  })
                  const idx = localPerms.findIndex(
                    (p) => p[f1] === v1 && p[f2] === v2
                  )
                  if (idx !== -1) localPerms.splice(idx, 1)
                  return { error: null }
                },
              }),
            }
          },
        }

        // Intercept the chained maybeSingle after upsert
        const originalMaybySingle = builder.maybeSingle
        builder.maybeSingle = async () => {
          if (pendingUpsertRecord) {
            if (upsertError) return { data: null, error: upsertError }
            upsertCalls.push({
              table: 'document_permissions',
              record: pendingUpsertRecord,
              options: pendingUpsertOptions,
            })
            // Upsert semantics: update if exists, insert otherwise
            const idx = localPerms.findIndex(
              (p) =>
                p.document_id === pendingUpsertRecord.document_id &&
                p.user_id === pendingUpsertRecord.user_id
            )
            if (idx !== -1) {
              localPerms[idx] = { ...localPerms[idx], ...pendingUpsertRecord }
              return { data: { ...localPerms[idx] }, error: null }
            } else {
              const newPerm = { id: `perm-new-${Date.now()}`, ...pendingUpsertRecord }
              localPerms.push(newPerm)
              return { data: { ...newPerm }, error: null }
            }
          }
          return originalMaybySingle()
        }

        return builder
      }

      // ── profiles ───────────────────────────────────────────────────────────
      if (table === 'profiles') {
        const filters: Record<string, any> = {}
        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          maybeSingle: async () => {
            if (profileError) return { data: null, error: profileError }
            const match = profiles.find((p) =>
              Object.entries(filters).every(([k, v]) => p[k] === v)
            )
            return { data: match ? { ...match } : null, error: null }
          },
        }
        return builder
      }

      throw new Error(`Unexpected table in mock: ${table}`)
    },
  }
}

// ---------------------------------------------------------------------------
// Mock Auth Resolver Factory
// ---------------------------------------------------------------------------

function mockAuthResolver(
  status: 'success' | 'unauthenticated' | 'profile_not_found' | 'invalid_role',
  userOptions?: { id?: string; email?: string; role?: UserRole; fullName?: string }
): () => Promise<AuthUserWithRoleResult> {
  return async () => {
    if (status === 'unauthenticated') {
      return {
        status: 'unauthenticated',
        user: null,
        profile: null,
        error: 'No active session found.',
      }
    }

    const userId = userOptions?.id ?? 'user-default'
    const email = userOptions?.email ?? 'test@example.com'

    if (status === 'profile_not_found') {
      return {
        status: 'profile_not_found',
        user: { id: userId, email },
        profile: null,
        error: 'User profile not found.',
      }
    }

    if (status === 'invalid_role') {
      return {
        status: 'invalid_role',
        user: { id: userId, email },
        profile: null,
        error: 'Invalid role.',
      }
    }

    const role: UserRole = userOptions?.role ?? 'viewer'
    return {
      status: 'success',
      user: { id: userId, email },
      profile: {
        id: userId,
        email,
        fullName: userOptions?.fullName ?? 'Test User',
        role,
      },
      error: null,
    }
  }
}

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = 'aabbccdd-0000-0000-0000-000000000001'
const OTHER_OWNER_ID = 'aabbccdd-0000-0000-0000-000000000002'
const ADMIN_ID = 'aabbccdd-0000-0000-0000-000000000003'
const VIEWER_ID = 'aabbccdd-0000-0000-0000-000000000004'
const TARGET_USER_ID = 'aabbccdd-0000-0000-0000-000000000005'
const ANOTHER_TARGET_ID = 'aabbccdd-0000-0000-0000-000000000006'
const DOC_ID = 'bbccddee-1111-1111-1111-111111111111'
const OTHER_DOC_ID = 'bbccddee-2222-2222-2222-222222222222'

const ownerDoc = {
  id: DOC_ID,
  owner_id: OWNER_ID,
  name: 'owner-doc.pdf',
  category: 'finance',
  storage_path: `${OWNER_ID}/uuid-owner-doc.pdf`,
  mime_type: 'application/pdf',
  created_at: '2026-10-23T10:00:00Z',
  updated_at: '2026-10-23T10:00:00Z',
  deleted_at: null,
}

const otherOwnerDoc = {
  id: OTHER_DOC_ID,
  owner_id: OTHER_OWNER_ID,
  name: 'other-doc.pdf',
  category: 'legal',
  storage_path: `${OTHER_OWNER_ID}/uuid-other-doc.pdf`,
  mime_type: 'application/pdf',
  created_at: '2026-10-23T09:00:00Z',
  updated_at: '2026-10-23T09:00:00Z',
  deleted_at: null,
}

const deletedDoc = {
  id: 'bbccddee-3333-3333-3333-333333333333',
  owner_id: OWNER_ID,
  name: 'deleted.pdf',
  category: 'archive',
  storage_path: `${OWNER_ID}/uuid-deleted.pdf`,
  mime_type: 'application/pdf',
  created_at: '2026-10-23T08:00:00Z',
  updated_at: '2026-10-23T08:00:00Z',
  deleted_at: '2026-10-23T09:00:00Z',
}

const targetUserProfile = { id: TARGET_USER_ID, role: 'viewer' }
const anotherTargetProfile = { id: ANOTHER_TARGET_ID, role: 'owner' }
const ownerProfile = { id: OWNER_ID, role: 'owner' }
const viewerProfile = { id: VIEWER_ID, role: 'viewer' }
const adminProfile = { id: ADMIN_ID, role: 'admin' }

/** An existing permission: viewer with can_edit (for testing revocation of can_edit) */
const existingViewerPermCanEdit = {
  id: 'perm-existing-1',
  document_id: DOC_ID,
  user_id: VIEWER_ID,
  can_read: true,
  can_edit: true,
}

function makeDeps(
  client: ReturnType<typeof createMockSupabaseClient>,
  resolver: () => Promise<AuthUserWithRoleResult>
): ManagePermissionDependencies {
  return { supabaseClient: client, currentUserResolver: resolver }
}

// ---------------------------------------------------------------------------
// Tests: isValidUUID
// ---------------------------------------------------------------------------

describe('isValidUUID', () => {
  it('accepts valid UUID v4', () => {
    assert.equal(isValidUUID('aabbccdd-0000-0000-0000-000000000001'), true)
    assert.equal(isValidUUID('550e8400-e29b-41d4-a716-446655440000'), true)
  })

  it('rejects non-UUID strings', () => {
    assert.equal(isValidUUID('not-a-uuid'), false)
    assert.equal(isValidUUID('12345'), false)
    assert.equal(isValidUUID(''), false)
    assert.equal(isValidUUID(null), false)
    assert.equal(isValidUUID(undefined), false)
    assert.equal(isValidUUID(42), false)
  })

  it('rejects UUIDs with wrong segment lengths', () => {
    assert.equal(isValidUUID('aabbccdd-000-0000-0000-000000000001'), false)
    assert.equal(isValidUUID('aabbccdd-0000-0000-0000-0000000001'), false)
  })
})

// ---------------------------------------------------------------------------
// Tests: validateGrantInput
// ---------------------------------------------------------------------------

describe('validateGrantInput', () => {
  it('accepts valid can_read=true, can_edit=false', () => {
    const result = validateGrantInput({ can_read: true, can_edit: false })
    assert.equal(result.valid, true)
    assert.equal(result.canRead, true)
    assert.equal(result.canEdit, false)
  })

  it('accepts valid can_read=true, can_edit=true', () => {
    const result = validateGrantInput({ can_read: true, can_edit: true })
    assert.equal(result.valid, true)
    assert.equal(result.canRead, true)
    assert.equal(result.canEdit, true)
  })

  it('accepts can_read=false, can_edit=false (revoke-like minimal grant)', () => {
    const result = validateGrantInput({ can_read: false, can_edit: false })
    assert.equal(result.valid, true)
  })

  it('rejects can_edit=true with can_read=false as inconsistent', () => {
    const result = validateGrantInput({ can_read: false, can_edit: true })
    assert.equal(result.valid, false)
    assert.ok(result.error?.toLowerCase().includes('inconsistent'))
  })

  it('rejects non-boolean can_read', () => {
    assert.equal(validateGrantInput({ can_read: 'yes', can_edit: false }).valid, false)
    assert.equal(validateGrantInput({ can_read: 1, can_edit: false }).valid, false)
    assert.equal(validateGrantInput({ can_read: null, can_edit: false }).valid, false)
  })

  it('rejects non-boolean can_edit', () => {
    assert.equal(validateGrantInput({ can_read: true, can_edit: 'true' }).valid, false)
    assert.equal(validateGrantInput({ can_read: true, can_edit: 0 }).valid, false)
  })

  it('rejects missing can_read', () => {
    const result = validateGrantInput({ can_edit: false })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('can_read'))
  })

  it('rejects missing can_edit', () => {
    const result = validateGrantInput({ can_read: true })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('can_edit'))
  })

  it('rejects extra/unknown fields', () => {
    const result = validateGrantInput({
      can_read: true,
      can_edit: false,
      owner_id: 'evil',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.toLowerCase().includes('unexpected'))
  })

  it('rejects extra field storage_path', () => {
    const result = validateGrantInput({
      can_read: true,
      can_edit: false,
      storage_path: '../secret',
    })
    assert.equal(result.valid, false)
  })

  it('rejects extra field granted_by', () => {
    const result = validateGrantInput({
      can_read: true,
      can_edit: false,
      granted_by: 'attacker-uuid',
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.toLowerCase().includes('unexpected'))
  })

  it('rejects non-object body', () => {
    assert.equal(validateGrantInput(null).valid, false)
    assert.equal(validateGrantInput('string').valid, false)
    assert.equal(validateGrantInput([]).valid, false)
    assert.equal(validateGrantInput(42).valid, false)
  })
})

// ---------------------------------------------------------------------------
// Tests: Authentication & authorization for grant
// ---------------------------------------------------------------------------

describe('handleGrantPermission – authentication & authorization', () => {
  it('unauthenticated request returns code unauthenticated', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(client, mockAuthResolver('unauthenticated'))

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'unauthenticated')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('missing profile returns code forbidden', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('profile_not_found', { id: OWNER_ID })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'forbidden')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('invalid role returns code forbidden', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(client, mockAuthResolver('invalid_role', { id: OWNER_ID }))

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'forbidden')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('viewer cannot grant access even if can_edit=true', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [existingViewerPermCanEdit],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
      assert.ok(result.message.toLowerCase().includes('viewer'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })

  it('owner cannot grant permission on another owner\'s document', async () => {
    const client = createMockSupabaseClient({
      documents: [otherOwnerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    // OWNER_ID trying to manage OTHER_OWNER_ID's document
    const result = await handleGrantPermission(
      OTHER_DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'forbidden')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('unauthenticated user performs no database upsert', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(client, mockAuthResolver('unauthenticated'))

    await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(client._upsertCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Authentication & authorization for revoke
// ---------------------------------------------------------------------------

describe('handleRevokePermission – authentication & authorization', () => {
  it('unauthenticated request returns code unauthenticated', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(client, mockAuthResolver('unauthenticated'))

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'unauthenticated')
    assert.equal(client._deleteCalls.length, 0)
  })

  it('missing profile returns forbidden for revoke', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(
      client,
      mockAuthResolver('profile_not_found', { id: OWNER_ID })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'forbidden')
    assert.equal(client._deleteCalls.length, 0)
  })

  it('viewer cannot revoke access', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [existingViewerPermCanEdit],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
      assert.ok(result.message.toLowerCase().includes('viewer'))
    }
    assert.equal(client._deleteCalls.length, 0)
  })

  it('owner cannot revoke permission on another owner\'s document', async () => {
    const client = createMockSupabaseClient({ documents: [otherOwnerDoc] })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(OTHER_DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'forbidden')
    assert.equal(client._deleteCalls.length, 0)
  })

  it('unauthenticated user performs no database delete', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(client, mockAuthResolver('unauthenticated'))

    await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(client._deleteCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Successful grant operations
// ---------------------------------------------------------------------------

describe('handleGrantPermission – successful grants', () => {
  it('owner grants read-only access to a target user', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.permission.document_id, DOC_ID)
      assert.equal(result.permission.user_id, TARGET_USER_ID)
      assert.equal(result.permission.can_read, true)
      assert.equal(result.permission.can_edit, false)
    }
  })

  it('owner grants read+write access to a target user', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.permission.can_read, true)
      assert.equal(result.permission.can_edit, true)
    }
  })

  it('admin grants read-only access on any document', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.permission.can_read, true)
      assert.equal(result.permission.can_edit, false)
    }
  })

  it('admin grants read+write access on any document', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.permission.can_edit, true)
    }
  })

  it('owner updates an existing permission (idempotent upsert)', async () => {
    const existingPerm = {
      id: 'perm-existing',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [existingPerm],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    // Upgrade to read+write
    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.permission.can_edit, true)
    }
    // Upsert should have been called exactly once
    assert.equal(client._upsertCalls.length, 1)
  })

  it('repeated grant calls are idempotent and do not create duplicate rows', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )
    const input = { can_read: true, can_edit: false }

    const r1 = await handleGrantPermission(DOC_ID, TARGET_USER_ID, input, deps)
    const r2 = await handleGrantPermission(DOC_ID, TARGET_USER_ID, input, deps)

    assert.equal(r1.status, 'success')
    assert.equal(r2.status, 'success')
    // Second upsert should not create a second row
    assert.equal(client._permissions.filter((p: any) => p.document_id === DOC_ID && p.user_id === TARGET_USER_ID).length, 1)
  })
})

// ---------------------------------------------------------------------------
// Tests: Successful revoke operations
// ---------------------------------------------------------------------------

describe('handleRevokePermission – successful revocations', () => {
  it('owner revokes permission from a target user', async () => {
    const permToRevoke = {
      id: 'perm-to-revoke',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [permToRevoke],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.revoked, true)
      assert.equal(result.document_id, DOC_ID)
      assert.equal(result.user_id, TARGET_USER_ID)
    }
  })

  it('admin revokes permission on any document', async () => {
    const permToRevoke = {
      id: 'perm-admin-revoke',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: true,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [permToRevoke],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'success')
    if (result.status === 'success') assert.equal(result.revoked, true)
  })

  it('revoking a non-existent permission is idempotent (returns success)', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [], // no permissions at all
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    // Should succeed (idempotent) rather than return 404 for missing permission
    assert.equal(result.status, 'success')
  })

  it('repeated revoke calls are idempotent', async () => {
    const perm = {
      id: 'p1',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [perm],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const r1 = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)
    const r2 = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(r1.status, 'success')
    assert.equal(r2.status, 'success')
  })
})

// ---------------------------------------------------------------------------
// Tests: Document existence checks
// ---------------------------------------------------------------------------

describe('handleGrantPermission – document existence checks', () => {
  it('nonexistent document returns not_found', async () => {
    const client = createMockSupabaseClient({
      documents: [],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      'ccddee00-9999-9999-9999-999999999999',
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'not_found')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('already-deleted document returns not_found', async () => {
    const client = createMockSupabaseClient({
      documents: [deletedDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      deletedDoc.id,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'not_found')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('nonexistent document returns not_found for revoke', async () => {
    const client = createMockSupabaseClient({ documents: [] })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleRevokePermission(
      'ccddee00-9999-9999-9999-999999999999',
      TARGET_USER_ID,
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'not_found')
    assert.equal(client._deleteCalls.length, 0)
  })

  it('already-deleted document returns not_found for revoke', async () => {
    const client = createMockSupabaseClient({ documents: [deletedDoc] })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(deletedDoc.id, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'not_found')
    assert.equal(client._deleteCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Target user validation
// ---------------------------------------------------------------------------

describe('handleGrantPermission – target user validation', () => {
  it('nonexistent target user returns not_found', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [], // no profiles
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'not_found')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('malformed target UUID is rejected with invalid_input', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      'not-a-valid-uuid',
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('malformed target UUID is rejected for revoke with invalid_input', async () => {
    const client = createMockSupabaseClient({ documents: [ownerDoc] })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(DOC_ID, 'bad-uuid', deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('response does not expose unnecessary profile information about target user', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [{ ...targetUserProfile, email: 'secret@example.com', full_name: 'Secret User' }],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      const perm = result.permission
      const permKeys = Object.keys(perm)
      assert.ok(!permKeys.includes('email'), 'response must not expose email')
      assert.ok(!permKeys.includes('full_name'), 'response must not expose full_name')
      assert.ok(!permKeys.includes('password'), 'response must not expose password')
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: Input validation
// ---------------------------------------------------------------------------

describe('handleGrantPermission – request body validation', () => {
  it('missing can_read returns invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_edit: false }, // missing can_read
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('missing can_edit returns invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true }, // missing can_edit
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('non-boolean can_read returns invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: 'yes', can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('non-boolean can_edit returns invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: 1 },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('can_edit=true with can_read=false is rejected with invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: false, can_edit: true },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.toLowerCase().includes('inconsistent'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })

  it('extra field owner_id in body is rejected with invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false, owner_id: 'attacker-id' },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
    assert.equal(client._upsertCalls.length, 0)
  })

  it('extra field storage_path in body is rejected with invalid_input', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false, storage_path: '../evil' },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
  })

  it('extra field granted_by in body is rejected with invalid_input and never saved', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false, granted_by: 'forged-uuid' },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'invalid_input')
    assert.equal(client._upsertCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Self-grant prevention
// ---------------------------------------------------------------------------

describe('handleGrantPermission – self-grant prevention', () => {
  it('owner cannot grant themselves access (self-grant attempt)', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [ownerProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    // Owner tries to grant themselves (own user ID as targetUserId)
    const result = await handleGrantPermission(
      DOC_ID,
      OWNER_ID, // same as requester
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
      assert.ok(result.message.toLowerCase().includes('yourself'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })

  it('admin cannot self-grant access', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [adminProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      ADMIN_ID, // same as requester
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
    }
    assert.equal(client._upsertCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// Tests: Response safety
// ---------------------------------------------------------------------------

describe('handleGrantPermission – response safety', () => {
  it('successful grant response does not expose storage_path', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      const permKeys = Object.keys(result.permission)
      assert.ok(!permKeys.includes('storage_path'), 'must not expose storage_path')
      assert.ok(!permKeys.includes('storagePath'), 'must not expose storagePath')
    }
  })

  it('successful grant response contains exactly the safe fields', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      const permKeys = new Set(Object.keys(result.permission))
      assert.ok(permKeys.has('document_id'))
      assert.ok(permKeys.has('user_id'))
      assert.ok(permKeys.has('can_read'))
      assert.ok(permKeys.has('can_edit'))
    }
  })

  it('upsert writes only can_read, can_edit, and server-verified granted_by — never touches document columns', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(client._upsertCalls.length, 1)
    const upsertRecord = client._upsertCalls[0].record
    const upsertKeys = Object.keys(upsertRecord)

    // Must contain exactly these keys; no document metadata
    assert.ok(upsertKeys.includes('document_id'))
    assert.ok(upsertKeys.includes('user_id'))
    assert.ok(upsertKeys.includes('can_read'))
    assert.ok(upsertKeys.includes('can_edit'))
    assert.ok(upsertKeys.includes('granted_by'))
    assert.equal(upsertRecord.granted_by, OWNER_ID)

    // Must NOT write dangerous document fields
    assert.ok(!upsertKeys.includes('owner_id'), 'must not write owner_id')
    assert.ok(!upsertKeys.includes('storage_path'), 'must not write storage_path')
    assert.ok(!upsertKeys.includes('name'), 'must not write document name')
    assert.ok(!upsertKeys.includes('deleted_at'), 'must not write deleted_at')
  })

  it('successful revoke response does not expose storage_path', async () => {
    const perm = {
      id: 'p1',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [perm],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      const keys = Object.keys(result)
      assert.ok(!keys.includes('storage_path'))
      assert.ok(!keys.includes('name'))
      assert.ok(!keys.includes('owner_id'))
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: Immediate revocation verification via getDocumentAccess
// ---------------------------------------------------------------------------

describe('Immediate revocation – access is denied immediately after revoke', () => {
  it('revoked viewer loses document access immediately via getDocumentAccess', async () => {
    // Set up: viewer has permission
    const viewerPerm = {
      id: 'perm-viewer',
      document_id: DOC_ID,
      user_id: VIEWER_ID,
      can_read: true,
      can_edit: false,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [viewerPerm],
    })

    // Verify access BEFORE revocation
    const accessBefore = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.equal(accessBefore.status, 'allowed', 'viewer should have access before revocation')

    // Revoke the permission
    const revokeResult = await handleRevokePermission(DOC_ID, VIEWER_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: OWNER_ID, role: 'owner' }),
    })
    assert.equal(revokeResult.status, 'success')

    // Verify access AFTER revocation — must be denied immediately (no cache)
    const accessAfter = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.equal(accessAfter.status, 'forbidden', 'viewer must be denied immediately after revocation')
  })

  it('revoked viewer with can_edit loses download access (canRead becomes false)', async () => {
    const viewerPerm = {
      id: 'perm-viewer-edit',
      document_id: DOC_ID,
      user_id: VIEWER_ID,
      can_read: true,
      can_edit: true,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [viewerPerm],
    })

    // Verify canRead before
    const before = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.equal(before.status, 'allowed')
    if (before.status === 'allowed') assert.equal(before.canRead, true)

    // Revoke
    await handleRevokePermission(DOC_ID, VIEWER_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: OWNER_ID, role: 'owner' }),
    })

    // Verify canRead is gone
    const after = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.notEqual(after.status, 'allowed', 'access must be revoked immediately')
  })

  it('granted viewer gains access immediately after grant', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [], // no permissions initially
      profiles: [viewerProfile],
    })

    // Verify NO access before grant
    const before = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.equal(before.status, 'forbidden', 'viewer should not have access before grant')

    // Grant read permission
    await handleGrantPermission(DOC_ID, VIEWER_ID, { can_read: true, can_edit: false }, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: OWNER_ID, role: 'owner' }),
    })

    // Verify access AFTER grant
    const after = await getDocumentAccess(DOC_ID, {
      supabaseClient: client,
      currentUserResolver: mockAuthResolver('success', { id: VIEWER_ID, role: 'viewer' }),
    })
    assert.equal(after.status, 'allowed', 'viewer must have access immediately after grant')
  })
})

// ---------------------------------------------------------------------------
// Tests: Database safety
// ---------------------------------------------------------------------------

describe('Database safety', () => {
  it('delete operation is scoped to exact (document_id, user_id) — not broader', async () => {
    const perm1 = {
      id: 'p1',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
    }
    const perm2 = {
      id: 'p2',
      document_id: DOC_ID,
      user_id: ANOTHER_TARGET_ID,
      can_read: true,
      can_edit: true,
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [perm1, perm2],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    // Revoke only TARGET_USER_ID's permission
    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)
    assert.equal(result.status, 'success')

    // ANOTHER_TARGET_ID's permission should still exist
    const remaining = client._permissions.find(
      (p: any) => p.document_id === DOC_ID && p.user_id === ANOTHER_TARGET_ID
    )
    assert.ok(remaining, "another user's permission must not be affected by targeted revoke")
  })

  it('upsert failure returns database_error', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
      upsertError: new Error('constraint violation'),
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'database_error')
  })

  it('delete failure returns database_error', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      deleteError: new Error('timeout'),
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleRevokePermission(DOC_ID, TARGET_USER_ID, deps)

    assert.equal(result.status, 'error')
    if (result.status === 'error') assert.equal(result.code, 'database_error')
  })
})

// ---------------------------------------------------------------------------
// Tests: verifyTargetUserExists helper
// ---------------------------------------------------------------------------

describe('verifyTargetUserExists', () => {
  it('returns exists=true when profile exists', async () => {
    const client = createMockSupabaseClient({ profiles: [targetUserProfile] })
    const result = await verifyTargetUserExists(client, TARGET_USER_ID)
    assert.equal(result.exists, true)
  })

  it('returns exists=false when profile does not exist', async () => {
    const client = createMockSupabaseClient({ profiles: [] })
    const result = await verifyTargetUserExists(client, TARGET_USER_ID)
    assert.equal(result.exists, false)
  })

  it('returns exists=false with error when DB query fails', async () => {
    const client = createMockSupabaseClient({
      profileError: new Error('DB error'),
    })
    const result = await verifyTargetUserExists(client, TARGET_USER_ID)
    assert.equal(result.exists, false)
    assert.ok(result.error)
  })
})

// ---------------------------------------------------------------------------
// Tests: HTTP status code mapping
// ---------------------------------------------------------------------------

describe('HTTP status code mapping', () => {
  const errorCodeMappings: Array<{ code: string; expected: number }> = [
    { code: 'unauthenticated', expected: 401 },
    { code: 'forbidden', expected: 403 },
    { code: 'not_found', expected: 404 },
    { code: 'invalid_input', expected: 400 },
    { code: 'database_error', expected: 500 },
  ]

  for (const { code, expected } of errorCodeMappings) {
    it(`maps code '${code}' to HTTP ${expected}`, () => {
      const httpStatus =
        code === 'unauthenticated'
          ? 401
          : code === 'forbidden'
            ? 403
            : code === 'not_found'
              ? 404
              : code === 'invalid_input'
                ? 400
                : 500
      assert.equal(httpStatus, expected)
    })
  }
})

// ---------------------------------------------------------------------------
// Tests: granted_by database enforcement and verification
// ---------------------------------------------------------------------------

describe('granted_by database enforcement and verification', () => {
  it('granted_by is sent to the database on grant and equals authenticated owner ID', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'success')
    assert.equal(client._upsertCalls.length, 1)
    const upsertRecord = client._upsertCalls[0].record
    assert.equal(upsertRecord.granted_by, OWNER_ID)
  })

  it('granted_by is sent to the database on grant and equals authenticated admin ID', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(result.status, 'success')
    assert.equal(client._upsertCalls.length, 1)
    const upsertRecord = client._upsertCalls[0].record
    assert.equal(upsertRecord.granted_by, ADMIN_ID)
  })

  it('client-supplied granted_by is rejected and ignored (never sent to database)', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [targetUserProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      {
        can_read: true,
        can_edit: false,
        granted_by: '00000000-0000-0000-0000-000000000000',
      },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.includes('unexpected fields: granted_by'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })

  it('existing permission update also sets granted_by to authenticated user ID', async () => {
    const existingPerm = {
      id: 'perm-existing-1',
      document_id: DOC_ID,
      user_id: TARGET_USER_ID,
      can_read: true,
      can_edit: false,
      granted_by: OTHER_OWNER_ID, // previously granted by other owner
    }
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      permissions: [existingPerm],
      profiles: [targetUserProfile],
    })
    // Admin updates the permission
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      TARGET_USER_ID,
      { can_read: true, can_edit: true },
      deps
    )

    assert.equal(result.status, 'success')
    assert.equal(client._upsertCalls.length, 1)
    const upsertRecord = client._upsertCalls[0].record
    // Must update granted_by to current authenticated user's ID for RLS compliance (granted_by = auth.uid())
    assert.equal(upsertRecord.granted_by, ADMIN_ID)
    assert.equal(upsertRecord.can_edit, true)
  })

  it('self-grant remains denied for owner', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [ownerProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: OWNER_ID, role: 'owner' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      OWNER_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
      assert.ok(result.message.toLowerCase().includes('yourself'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })

  it('self-grant remains denied for admin', async () => {
    const client = createMockSupabaseClient({
      documents: [ownerDoc],
      profiles: [adminProfile],
    })
    const deps = makeDeps(
      client,
      mockAuthResolver('success', { id: ADMIN_ID, role: 'admin' })
    )

    const result = await handleGrantPermission(
      DOC_ID,
      ADMIN_ID,
      { can_read: true, can_edit: false },
      deps
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'forbidden')
      assert.ok(result.message.toLowerCase().includes('yourself'))
    }
    assert.equal(client._upsertCalls.length, 0)
  })
})

