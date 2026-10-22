import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getDocumentAccess,
  canReadDocument,
  canEditDocument,
  type DocumentAccessOptions,
} from '../lib/auth/document-access'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'

/**
 * Creates a mock Supabase client simulating public.documents and public.document_permissions.
 * Enables deterministic testing of database queries and failure modes without network I/O.
 */
function createMockSupabaseClient({
  documents = [],
  permissions = [],
  documentError = null,
  permissionError = null,
}: {
  documents?: any[]
  permissions?: any[]
  documentError?: Error | null
  permissionError?: Error | null
} = {}) {
  return {
    from: (table: string) => {
      if (table === 'documents') {
        const filters: Record<string, any> = {}
        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          maybeSingle: async () => {
            if (documentError) {
              return { data: null, error: documentError }
            }
            const match = documents.find((doc) =>
              Object.entries(filters).every(([k, v]) => doc[k] === v)
            )
            return { data: match ? { ...match } : null, error: null }
          },
        }
        return builder
      }

      if (table === 'document_permissions') {
        const filters: Record<string, any> = {}
        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          maybeSingle: async () => {
            if (permissionError) {
              return { data: null, error: permissionError }
            }
            const match = permissions.find((perm) =>
              Object.entries(filters).every(([k, v]) => perm[k] === v)
            )
            return { data: match ? { ...match } : null, error: null }
          },
        }
        return builder
      }

      throw new Error(`Unexpected table requested in mock: ${table}`)
    },
  }
}

/**
 * Helper to construct mock auth resolver return values.
 */
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
        error: 'User profile does not exist in public.profiles.',
      }
    }

    if (status === 'invalid_role') {
      return {
        status: 'invalid_role',
        user: { id: userId, email },
        profile: null,
        error: 'Invalid or unrecognized role.',
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

const sampleDocument = {
  id: 'doc-100',
  owner_id: 'owner-user-1',
  name: 'financial_records.pdf',
  category: 'finance',
  storage_path: 'vault/doc-100.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-22T10:00:00Z',
  updated_at: '2026-10-22T10:00:00Z',
  deleted_at: null,
}

describe('Server-Side Document Authorization Foundation', () => {
  // Test 1: owner can access own document
  it('allows owner to access their own document with edit capability', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'owner-user-1',
        role: 'owner',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'allowed')
    if (access.status === 'allowed') {
      assert.strictEqual(access.reason, 'owner')
      assert.strictEqual(access.accessLevel, 'edit')
      assert.strictEqual(access.canRead, true)
      assert.strictEqual(access.canEdit, true)
      assert.strictEqual(access.document.id, 'doc-100')
      assert.strictEqual(access.document.ownerId, 'owner-user-1')
    }

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, true)
    assert.strictEqual(canEdit, true)
  })

  // Test 2: owner cannot access another owner's document
  it('denies owner from accessing another owner’s document when no permission exists', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
      permissions: [], // No explicit permission row for owner-user-2
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'owner-user-2', // Different owner
        role: 'owner',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'forbidden')

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, false)
    assert.strictEqual(canEdit, false)
  })

  // Test 3: viewer with read permission can read
  it('allows viewer with read permission to read, but denies edit capability', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
      permissions: [
        {
          id: 'perm-1',
          document_id: 'doc-100',
          user_id: 'viewer-user-1',
          can_read: true,
          can_edit: false,
        },
      ],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'viewer-user-1',
        role: 'viewer',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'allowed')
    if (access.status === 'allowed') {
      assert.strictEqual(access.reason, 'explicit_permission')
      assert.strictEqual(access.accessLevel, 'read')
      assert.strictEqual(access.canRead, true)
      assert.strictEqual(access.canEdit, false)
    }

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, true)
    assert.strictEqual(canEdit, false)
  })

  // Test 4: viewer with edit permission can edit
  it('allows viewer with edit permission to both read and edit', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
      permissions: [
        {
          id: 'perm-2',
          document_id: 'doc-100',
          user_id: 'viewer-user-2',
          can_read: true,
          can_edit: true,
        },
      ],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'viewer-user-2',
        role: 'viewer',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'allowed')
    if (access.status === 'allowed') {
      assert.strictEqual(access.reason, 'explicit_permission')
      assert.strictEqual(access.accessLevel, 'edit')
      assert.strictEqual(access.canRead, true)
      assert.strictEqual(access.canEdit, true)
    }

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, true)
    assert.strictEqual(canEdit, true)
  })

  // Test 5: viewer without permission is denied
  it('denies viewer with no explicit permission record in public.document_permissions', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
      permissions: [], // Empty permissions
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'viewer-user-unshared',
        role: 'viewer',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'forbidden')

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, false)
    assert.strictEqual(canEdit, false)
  })

  // Test 6: revoked permission is denied (Immediate Revocation)
  it('immediately denies access when permission record is revoked (flags set to false)', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
      permissions: [
        {
          id: 'perm-revoked',
          document_id: 'doc-100',
          user_id: 'viewer-user-revoked',
          can_read: false,
          can_edit: false,
        },
      ],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'viewer-user-revoked',
        role: 'viewer',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'forbidden')

    const canRead = await canReadDocument('doc-100', options)
    assert.strictEqual(canRead, false)
  })

  it('immediately denies access when permission row is deleted from database', async () => {
    let permissions = [
      {
        id: 'perm-to-delete',
        document_id: 'doc-100',
        user_id: 'viewer-user-dynamic',
        can_read: true,
        can_edit: false,
      },
    ]

    const dynamicSupabase = {
      from: (table: string) => {
        if (table === 'documents') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { ...sampleDocument }, error: null }),
              }),
            }),
          }
        }
        if (table === 'document_permissions') {
          return {
            select: () => ({
              eq: (f1: string, v1: any) => ({
                eq: (f2: string, v2: any) => ({
                  maybeSingle: async () => {
                    const match = permissions.find(
                      (p) => (p as any)[f1] === v1 && (p as any)[f2] === v2
                    )
                    return { data: match ? { ...match } : null, error: null }
                  },
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      },
    }

    const options: DocumentAccessOptions = {
      supabaseClient: dynamicSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'viewer-user-dynamic',
        role: 'viewer',
      }),
    }

    // Step 1: Active permission exists -> access allowed
    const firstCheck = await getDocumentAccess('doc-100', options)
    assert.strictEqual(firstCheck.status, 'allowed')

    // Step 2: Permission is revoked by deleting the row from database
    permissions = []

    // Step 3: Immediate revocation -> next request is immediately forbidden without caching
    const secondCheck = await getDocumentAccess('doc-100', options)
    assert.strictEqual(secondCheck.status, 'forbidden')
  })

  // Test 7: unauthenticated access is denied
  it('denies unauthenticated requests without performing elevated checks', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('unauthenticated'),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'unauthenticated')

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, false)
    assert.strictEqual(canEdit, false)
  })

  // Test 8: missing profile or invalid role fails closed
  it('denies access when profile is missing in public.profiles', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('profile_not_found'),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'forbidden')

    const canRead = await canReadDocument('doc-100', options)
    assert.strictEqual(canRead, false)
  })

  it('denies access when user role is invalid or unrecognized', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('invalid_role'),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'forbidden')

    const canRead = await canReadDocument('doc-100', options)
    assert.strictEqual(canRead, false)
  })

  // Test 9: admin can access documents across application
  it('allows verified admin full access to any document across the application', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [sampleDocument],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'admin-user-1',
        role: 'admin',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'allowed')
    if (access.status === 'allowed') {
      assert.strictEqual(access.reason, 'admin')
      assert.strictEqual(access.accessLevel, 'edit')
      assert.strictEqual(access.canRead, true)
      assert.strictEqual(access.canEdit, true)
    }

    const canRead = await canReadDocument('doc-100', options)
    const canEdit = await canEditDocument('doc-100', options)
    assert.strictEqual(canRead, true)
    assert.strictEqual(canEdit, true)
  })

  // Test 10: non-existent document returns not_found
  it('returns not_found when querying non-existent document', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'admin-user-1',
        role: 'admin',
      }),
    }

    const access = await getDocumentAccess('non-existent-doc-999', options)
    assert.strictEqual(access.status, 'not_found')
  })

  // Test 11: soft-deleted document returns not_found
  it('returns not_found when document has deleted_at set (soft delete)', async () => {
    const softDeletedDoc = {
      ...sampleDocument,
      id: 'doc-deleted',
      deleted_at: '2026-10-22T12:00:00Z',
    }

    const mockSupabase = createMockSupabaseClient({
      documents: [softDeletedDoc],
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'owner-user-1',
        role: 'owner',
      }),
    }

    const access = await getDocumentAccess('doc-deleted', options)
    assert.strictEqual(access.status, 'not_found')
  })

  // Test 12: database error fails closed
  it('fails closed when database query returns an unexpected error', async () => {
    const mockSupabase = createMockSupabaseClient({
      documentError: new Error('Database connection failed'),
    })

    const options: DocumentAccessOptions = {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', {
        id: 'owner-user-1',
        role: 'owner',
      }),
    }

    const access = await getDocumentAccess('doc-100', options)
    assert.strictEqual(access.status, 'not_found')
  })
})
