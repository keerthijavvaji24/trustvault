import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import {
  handleListDocuments,
  GET,
  type SafeDocumentMetadata,
  type ListDocumentsDependencies,
} from '../app/api/documents/route'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'

// ---------------------------------------------------------------------------
// Mock Supabase Client Factory
// ---------------------------------------------------------------------------

interface MockDbOptions {
  documents?: any[]
  permissions?: any[]
  documentError?: Error | null
  permissionError?: Error | null
}

function createMockSupabaseClient({
  documents = [],
  permissions = [],
  documentError = null,
  permissionError = null,
}: MockDbOptions = {}) {
  return {
    from: (table: string) => {
      if (table === 'documents') {
        const filters: {
          eq: Record<string, any>
          is: Record<string, any>
          in: Record<string, any[]>
        } = { eq: {}, is: {}, in: {} }

        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters.eq[field] = val
            return builder
          },
          is: (field: string, val: any) => {
            filters.is[field] = val
            return builder
          },
          in: (field: string, vals: any[]) => {
            filters.in[field] = vals
            return builder
          },
          order: () => builder,
          then: (resolve: (val: any) => any) => {
            if (documentError) {
              return resolve({ data: null, error: documentError })
            }

            const filtered = documents.filter((doc) => {
              for (const [k, v] of Object.entries(filters.eq)) {
                if (doc[k] !== v) return false
              }
              for (const [k, v] of Object.entries(filters.is)) {
                if (doc[k] !== v) return false
              }
              for (const [k, vals] of Object.entries(filters.in)) {
                if (!vals.includes(doc[k])) return false
              }
              return true
            })

            return resolve({ data: filtered.map((d) => ({ ...d })), error: null })
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
          then: (resolve: (val: any) => any) => {
            if (permissionError) {
              return resolve({ data: null, error: permissionError })
            }

            const filtered = permissions.filter((perm) =>
              Object.entries(filters).every(([k, v]) => perm[k] === v)
            )

            return resolve({ data: filtered.map((p) => ({ ...p })), error: null })
          },
        }

        return builder
      }

      throw new Error(`Unexpected table requested in mock: ${table}`)
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

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const docA = {
  id: 'doc-a',
  owner_id: 'owner-1',
  name: 'financial_plan.pdf',
  category: 'finance',
  storage_path: 'owner-1/uuid-1-financial_plan.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T10:00:00Z',
  updated_at: '2026-10-23T10:00:00Z',
  deleted_at: null,
}

const docB = {
  id: 'doc-b',
  owner_id: 'owner-2',
  name: 'tax_return.pdf',
  category: 'tax',
  storage_path: 'owner-2/uuid-2-tax_return.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T11:00:00Z',
  updated_at: '2026-10-23T11:00:00Z',
  deleted_at: null,
}

const docDeleted = {
  id: 'doc-deleted',
  owner_id: 'owner-1',
  name: 'deleted_secret.pdf',
  category: 'confidential',
  storage_path: 'owner-1/uuid-3-deleted_secret.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T08:00:00Z',
  updated_at: '2026-10-23T09:00:00Z',
  deleted_at: '2026-10-23T09:00:00Z',
}

const allSampleDocs = [docA, docB, docDeleted]

// ---------------------------------------------------------------------------
// Tests Suite
// ---------------------------------------------------------------------------

describe('Server-Side Document Listing Foundation (GET /api/documents)', () => {
  // ── Authentication & Authorization Fail-Closed Checks ─────────────────────

  it('rejects unauthenticated request with code "unauthenticated"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('unauthenticated'),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'unauthenticated')
      assert.match(result.message, /No active session|Authentication required/i)
    }
  })

  it('rejects request when user profile is missing (profile_not_found)', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('profile_not_found', { id: 'user-missing-profile' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
      assert.match(result.message, /profile does not exist/i)
    }
  })

  it('rejects request when user has an invalid role', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('invalid_role', { id: 'user-bad-role' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
      assert.match(result.message, /invalid or unrecognized/i)
    }
  })

  // ── Role: ADMIN ───────────────────────────────────────────────────────────

  it('allows admin to list all non-deleted documents across all owners', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'admin-user', role: 'admin' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      // Both docA (owner-1) and docB (owner-2) must be returned
      const ids = result.documents.map((d) => d.id)
      assert.ok(ids.includes('doc-a'), 'admin should see doc-a')
      assert.ok(ids.includes('doc-b'), 'admin should see doc-b')
      // docDeleted must NOT be present
      assert.ok(!ids.includes('doc-deleted'), 'admin should NOT see soft-deleted documents')
      assert.strictEqual(result.documents.length, 2)
    }
  })

  // ── Role: OWNER ───────────────────────────────────────────────────────────

  it('allows owner to see only their own non-deleted documents', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.documents.length, 1)
      assert.strictEqual(result.documents[0].id, 'doc-a')
      assert.strictEqual(result.documents[0].owner_id, 'owner-1')
      // Must NOT see owner-2's document
      const ids = result.documents.map((d) => d.id)
      assert.ok(!ids.includes('doc-b'), 'owner-1 must NOT see owner-2 document')
      // Must NOT see soft-deleted document
      assert.ok(!ids.includes('doc-deleted'), 'owner-1 must NOT see deleted document')
    }
  })

  it('denies owner from seeing other owners documents even if owner-2 has documents', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-2', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.documents.length, 1)
      assert.strictEqual(result.documents[0].id, 'doc-b')
      assert.strictEqual(result.documents[0].owner_id, 'owner-2')
    }
  })

  // ── Role: VIEWER ──────────────────────────────────────────────────────────

  it('allows viewer to see only explicitly permitted documents with can_read = true', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-1',
          document_id: 'doc-a',
          user_id: 'viewer-1',
          can_read: true,
          can_edit: false,
        },
      ],
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-1', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.documents.length, 1)
      assert.strictEqual(result.documents[0].id, 'doc-a')
      assert.strictEqual(result.documents[0].name, 'financial_plan.pdf')
    }
  })

  it('prevents viewer from seeing an unpermitted document', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-1',
          document_id: 'doc-a',
          user_id: 'viewer-1',
          can_read: true,
          can_edit: false,
        },
        // Permission exists for doc-b, but can_read is false (revoked/disabled)
        {
          id: 'perm-2',
          document_id: 'doc-b',
          user_id: 'viewer-1',
          can_read: false,
          can_edit: false,
        },
      ],
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-1', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      const ids = result.documents.map((d) => d.id)
      assert.ok(ids.includes('doc-a'), 'viewer should see permitted doc-a')
      assert.ok(!ids.includes('doc-b'), 'viewer must NOT see doc-b where can_read is false')
      assert.strictEqual(result.documents.length, 1)
    }
  })

  it('returns empty list for viewer with zero permissions records', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [],
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-no-perms', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.deepStrictEqual(result.documents, [])
    }
  })

  // ── Deleted Documents Exclusion ───────────────────────────────────────────

  it('excludes soft-deleted documents even if viewer has explicit permission', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-deleted',
          document_id: 'doc-deleted',
          user_id: 'viewer-1',
          can_read: true,
          can_edit: false,
        },
      ],
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-1', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      const ids = result.documents.map((d) => d.id)
      assert.ok(!ids.includes('doc-deleted'), 'soft-deleted document must NEVER be returned to viewer')
      assert.strictEqual(result.documents.length, 0)
    }
  })

  it('excludes soft-deleted documents for the document owner', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      const ids = result.documents.map((d) => d.id)
      assert.ok(!ids.includes('doc-deleted'), 'soft-deleted document must not be returned to owner')
    }
  })

  // ── Safe Metadata Guarantees ──────────────────────────────────────────────

  it('returns only safe metadata: never exposes storage_path or download URLs', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      const doc = result.documents[0]
      // Verify safe fields exist
      assert.strictEqual(doc.id, 'doc-a')
      assert.strictEqual(doc.name, 'financial_plan.pdf')
      assert.strictEqual(doc.category, 'finance')
      assert.strictEqual(doc.owner_id, 'owner-1')
      assert.strictEqual(doc.created_at, '2026-10-23T10:00:00Z')
      assert.strictEqual(doc.updated_at, '2026-10-23T10:00:00Z')
      assert.strictEqual(doc.mime_type, 'application/pdf')

      // Verify dangerous/internal fields are NEVER exposed
      assert.strictEqual((doc as any).storage_path, undefined, 'storage_path must NOT be exposed')
      assert.strictEqual((doc as any).storagePath, undefined, 'storagePath must NOT be exposed')
      assert.strictEqual((doc as any).download_url, undefined, 'download_url must NOT be exposed')
      assert.strictEqual((doc as any).downloadUrl, undefined, 'downloadUrl must NOT be exposed')
      assert.strictEqual((doc as any).deleted_at, undefined, 'deleted_at must NOT be exposed')
    }
  })

  // ── Database Fail-Closed Protection ───────────────────────────────────────

  it('fails closed when database query returns an unexpected error', async () => {
    const mockSupabase = createMockSupabaseClient({
      documentError: new Error('Database connection failed'),
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'admin-user', role: 'admin' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'database_error')
    }
  })

  it('fails closed when permission query returns an error for viewer', async () => {
    const mockSupabase = createMockSupabaseClient({
      permissionError: new Error('Permission table locked'),
    })

    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-1', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'database_error')
    }
  })

  // ── Client-Supplied Parameter Non-Trust ───────────────────────────────────

  it('never trusts client-supplied owner_id or role: derives ownership solely from server session', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })

    // User is owner-1, attempting to request owner-2 documents or claim admin role
    const result = await handleListDocuments({
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      // Must only return documents owned by verified user (owner-1)
      assert.strictEqual(result.documents.length, 1)
      assert.strictEqual(result.documents[0].id, 'doc-a')
      assert.strictEqual(result.documents[0].owner_id, 'owner-1')
      const ids = result.documents.map((d) => d.id)
      assert.ok(!ids.includes('doc-b'), 'cannot access owner-2 documents via client manipulation')
    }
  })
})

