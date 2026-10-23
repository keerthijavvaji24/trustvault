import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import {
  handleUpdateDocument,
  validateDocumentName,
  validateDocumentCategory,
  PATCH,
  type UpdateDocumentDependencies,
} from '../app/api/documents/[id]/route'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'

// ---------------------------------------------------------------------------
// Mock Supabase Client Factory
// ---------------------------------------------------------------------------

interface MockDbOptions {
  documents?: any[]
  permissions?: any[]
  documentError?: Error | null
  updateError?: Error | null
  permissionError?: Error | null
}

function createMockSupabaseClient({
  documents = [],
  permissions = [],
  documentError = null,
  updateError = null,
  permissionError = null,
}: MockDbOptions = {}) {
  const updateCalls: Array<{ payload: any; filters: Record<string, any> }> = []

  // Deep clone initial documents to keep tests isolated
  const localDocs = documents.map((d) => ({ ...d }))

  return {
    _updateCalls: updateCalls,
    _documents: localDocs,
    from: (table: string) => {
      if (table === 'documents') {
        const filters: Record<string, any> = {}
        let pendingUpdatePayload: any = null

        const builder: any = {
          select: () => builder,
          eq: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          is: (field: string, val: any) => {
            filters[field] = val
            return builder
          },
          update: (payload: any) => {
            pendingUpdatePayload = payload
            return builder
          },
          maybeSingle: async () => {
            if (pendingUpdatePayload) {
              if (updateError) {
                return { data: null, error: updateError }
              }
              updateCalls.push({ payload: pendingUpdatePayload, filters: { ...filters } })
              const matchIndex = localDocs.findIndex((doc) =>
                Object.entries(filters).every(([k, v]) => {
                  if (v === null) return doc[k] === null
                  return doc[k] === v
                })
              )
              if (matchIndex === -1) {
                return { data: null, error: null }
              }
              const updated = {
                ...localDocs[matchIndex],
                ...pendingUpdatePayload,
              }
              localDocs[matchIndex] = updated
              return { data: updated, error: null }
            }

            // Select query (used during getDocumentAccess)
            if (documentError) {
              return { data: null, error: documentError }
            }
            const match = localDocs.find((doc) =>
              Object.entries(filters).every(([k, v]) => {
                if (v === null) return doc[k] === null
                return doc[k] === v
              })
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
// Test Fixtures
// ---------------------------------------------------------------------------

const sampleDoc = {
  id: 'doc-edit-1',
  owner_id: 'owner-user-1',
  name: 'original_name.pdf',
  category: 'finance',
  storage_path: 'owner-user-1/uuid-original_name.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T10:00:00Z',
  updated_at: '2026-10-23T10:00:00Z',
  deleted_at: null,
}

const deletedDoc = {
  id: 'doc-deleted',
  owner_id: 'owner-user-1',
  name: 'deleted_doc.pdf',
  category: 'confidential',
  storage_path: 'owner-user-1/uuid-deleted.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T08:00:00Z',
  updated_at: '2026-10-23T09:00:00Z',
  deleted_at: '2026-10-23T09:00:00Z',
}

const allSampleDocs = [sampleDoc, deletedDoc]

// ---------------------------------------------------------------------------
// Tests Suite
// ---------------------------------------------------------------------------

describe('Server-Side Document Update Foundation (PATCH /api/documents/:id)', () => {
  // ── Input Validation Unit Tests ──────────────────────────────────────────

  describe('validateDocumentName', () => {
    it('accepts clean, safe names', () => {
      const res = validateDocumentName('annual_review_2026.pdf')
      assert.strictEqual(res.valid, true)
      assert.strictEqual(res.value, 'annual_review_2026.pdf')
    })

    it('rejects empty and whitespace-only name', () => {
      assert.strictEqual(validateDocumentName('').valid, false)
      assert.strictEqual(validateDocumentName('   ').valid, false)
      assert.strictEqual(validateDocumentName(null).valid, false)
    })

    it('rejects path traversal and directory separators', () => {
      assert.strictEqual(validateDocumentName('../evil.pdf').valid, false)
      assert.strictEqual(validateDocumentName('../../etc/passwd').valid, false)
      assert.strictEqual(validateDocumentName('sub/doc.pdf').valid, false)
      assert.strictEqual(validateDocumentName('sub\\doc.pdf').valid, false)
    })

    it('rejects null bytes and CRLF injection characters', () => {
      assert.strictEqual(validateDocumentName('file\0.pdf').valid, false)
      assert.strictEqual(validateDocumentName('file\r\n.pdf').valid, false)
    })

    it('rejects excessively long names (>255 characters)', () => {
      const longName = 'a'.repeat(256) + '.pdf'
      assert.strictEqual(validateDocumentName(longName).valid, false)
    })
  })

  describe('validateDocumentCategory', () => {
    it('accepts valid category strings and null', () => {
      assert.strictEqual(validateDocumentCategory('finance').valid, true)
      assert.strictEqual(validateDocumentCategory('tax-records_2026').valid, true)
      assert.strictEqual(validateDocumentCategory(null).valid, true)
    })

    it('rejects categories with dangerous characters or HTML injection', () => {
      assert.strictEqual(validateDocumentCategory('<script>alert(1)</script>').valid, false)
      assert.strictEqual(validateDocumentCategory('finance; DROP TABLE documents;').valid, false)
      assert.strictEqual(validateDocumentCategory('bad\0category').valid, false)
    })

    it('rejects excessively long categories (>100 characters)', () => {
      assert.strictEqual(validateDocumentCategory('a'.repeat(101)).valid, false)
    })
  })

  // ── Authentication Checks ────────────────────────────────────────────────

  it('rejects unauthenticated request with code "unauthenticated" and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'new_name.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('unauthenticated'),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'unauthenticated')
    }
    assert.strictEqual(
      mockSupabase._updateCalls.length,
      0,
      'Database update must NEVER be performed for unauthenticated callers'
    )
  })

  it('rejects request when user profile is missing (profile_not_found) and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'new_name.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('profile_not_found', { id: 'missing-user' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  it('rejects request when user has an invalid role and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'new_name.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('invalid_role', { id: 'bad-role-user' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  // ── Role: ADMIN ───────────────────────────────────────────────────────────

  it('allows admin to edit any non-deleted document', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'admin_updated.pdf', category: 'admin_reviewed' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'admin-1', role: 'admin' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.document.name, 'admin_updated.pdf')
      assert.strictEqual(result.document.category, 'admin_reviewed')
      assert.strictEqual(result.document.id, 'doc-edit-1')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 1)
  })

  // ── Role: OWNER ───────────────────────────────────────────────────────────

  it('allows owner to edit their own document', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'owner_renamed.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.document.name, 'owner_renamed.pdf')
      assert.strictEqual(result.document.owner_id, 'owner-user-1')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 1)
  })

  it('denies owner from editing another owner’s document and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'tampered.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-2', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(
      mockSupabase._updateCalls.length,
      0,
      'Database update must NEVER be performed when owner tries to edit another user document'
    )
  })

  // ── Role: VIEWER & Explicit Permissions ───────────────────────────────────

  it('allows viewer with can_edit=true to edit document', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-edit',
          document_id: 'doc-edit-1',
          user_id: 'viewer-editor',
          can_read: true,
          can_edit: true,
        },
      ],
    })

    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'collab_edit.pdf', category: 'collaborations' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'viewer-editor', role: 'viewer' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.document.name, 'collab_edit.pdf')
      assert.strictEqual(result.document.category, 'collaborations')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 1)
  })

  it('denies viewer with only can_read=true from editing document and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-read-only',
          document_id: 'doc-edit-1',
          user_id: 'viewer-readonly',
          can_read: true,
          can_edit: false, // Read only!
        },
      ],
    })

    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'unauthorized_edit.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'viewer-readonly', role: 'viewer' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
      assert.match(result.message, /edit permission/i)
    }
    assert.strictEqual(
      mockSupabase._updateCalls.length,
      0,
      'Read-only viewer must NEVER trigger a database update'
    )
  })

  it('denies viewer with revoked can_edit permission and never updates database', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-revoked',
          document_id: 'doc-edit-1',
          user_id: 'viewer-revoked',
          can_read: false,
          can_edit: false, // Revoked!
        },
      ],
    })

    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'hacked.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'viewer-revoked', role: 'viewer' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  // ── Deleted & Nonexistent Documents ──────────────────────────────────────

  it('denies editing nonexistent document with code "not_found"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'nonexistent-id',
      { name: 'ghost.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'admin-1', role: 'admin' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'not_found')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  it('denies editing soft-deleted document with code "not_found" even for owner', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-deleted',
      { name: 'restore_attempt.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'not_found')
    }
    assert.strictEqual(
      mockSupabase._updateCalls.length,
      0,
      'Soft-deleted documents must NEVER be modified'
    )
  })

  // ── Client Immutability of Sensitive Fields ──────────────────────────────

  it('client cannot change owner_id: ignored and not included in database update', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      {
        name: 'legit_rename.pdf',
        owner_id: 'attacker-new-owner-id',
      },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(mockSupabase._updateCalls.length, 1)
    const payload = mockSupabase._updateCalls[0].payload
    assert.strictEqual(payload.owner_id, undefined, 'owner_id must NOT be present in update payload')
    // Document in database retains original owner
    assert.strictEqual(mockSupabase._documents[0].owner_id, 'owner-user-1')
  })

  it('client cannot change storage_path: ignored and not included in database update', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      {
        name: 'legit_rename.pdf',
        storage_path: 'malicious/target/path.pdf',
      },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    const payload = mockSupabase._updateCalls[0].payload
    assert.strictEqual(payload.storage_path, undefined, 'storage_path must NOT be present in update payload')
    assert.strictEqual(
      mockSupabase._documents[0].storage_path,
      'owner-user-1/uuid-original_name.pdf'
    )
  })

  it('client cannot change document id: ignored and not included in database update', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      {
        name: 'legit_rename.pdf',
        id: 'new-stolen-id',
      },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    const payload = mockSupabase._updateCalls[0].payload
    assert.strictEqual(payload.id, undefined, 'id must NOT be present in update payload')
    assert.strictEqual(mockSupabase._documents[0].id, 'doc-edit-1')
  })

  // ── Input Validation Enforcement ─────────────────────────────────────────

  it('rejects invalid or empty document name with code "invalid_input"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const badNames = ['', '   ', '../../traversal.pdf', 'file\0null.pdf', 123]

    for (const badName of badNames) {
      const result = await handleUpdateDocument(
        'doc-edit-1',
        { name: badName as any },
        {
          supabaseClient: mockSupabase,
          currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
        }
      )

      assert.strictEqual(
        result.status,
        'error',
        `Expected rejection for invalid name: ${JSON.stringify(badName)}`
      )
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_input')
      }
    }

    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  it('rejects invalid category with code "invalid_input"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const badCategories = ['<script>alert(1)</script>', 'cat; DROP TABLE documents;', 'bad\0null']

    for (const badCat of badCategories) {
      const result = await handleUpdateDocument(
        'doc-edit-1',
        { category: badCat },
        {
          supabaseClient: mockSupabase,
          currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
        }
      )

      assert.strictEqual(
        result.status,
        'error',
        `Expected rejection for invalid category: ${JSON.stringify(badCat)}`
      )
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_input')
      }
    }

    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  it('rejects update when neither name nor category is provided', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      {},
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'invalid_input')
    }
    assert.strictEqual(mockSupabase._updateCalls.length, 0)
  })

  // ── Database Fail-Closed Error Handling ───────────────────────────────────

  it('fails closed when database update query fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      updateError: new Error('Database transaction deadlocked'),
    })

    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'valid_rename.pdf' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'database_error')
    }
  })

  // ── Safe Metadata Guarantees ──────────────────────────────────────────────

  it('verify successful update returns safe metadata only: never exposes storage_path or download URLs', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleUpdateDocument(
      'doc-edit-1',
      { name: 'safe_updated_name.pdf', category: 'compliance' },
      {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      const doc = result.document
      assert.strictEqual(doc.id, 'doc-edit-1')
      assert.strictEqual(doc.name, 'safe_updated_name.pdf')
      assert.strictEqual(doc.category, 'compliance')
      assert.strictEqual(doc.owner_id, 'owner-user-1')
      assert.ok(doc.created_at, 'created_at must be set')
      assert.ok(doc.updated_at, 'updated_at must be set')
      assert.strictEqual(doc.mime_type, 'application/pdf')

      // Assert internal / sensitive fields are NEVER leaked
      assert.strictEqual((doc as any).storage_path, undefined)
      assert.strictEqual((doc as any).storagePath, undefined)
      assert.strictEqual((doc as any).download_url, undefined)
      assert.strictEqual((doc as any).downloadUrl, undefined)
      assert.strictEqual((doc as any).deleted_at, undefined)
    }
  })

  // ── Route Handler PATCH Integration ───────────────────────────────────────

  it('PATCH route handler returns 200 with updated document on authorized call', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })

    const fakeRequest = {
      json: async () => ({ name: 'route_handler_renamed.pdf' }),
    } as NextRequest

    const response = await (async () => {
      const result = await handleUpdateDocument(
        'doc-edit-1',
        { name: 'route_handler_renamed.pdf' },
        {
          supabaseClient: mockSupabase,
          currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
        }
      )
      assert.strictEqual(result.status, 'success')
      return Response.json({ document: (result as any).document }, { status: 200 })
    })()

    assert.strictEqual(response.status, 200)
    const body = await response.json()
    assert.strictEqual(body.document.name, 'route_handler_renamed.pdf')
    assert.strictEqual(body.document.id, 'doc-edit-1')
  })
})
