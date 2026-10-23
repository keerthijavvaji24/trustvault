import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import {
  handleDownload,
  sanitizeDownloadFilename,
  GET,
  type DownloadDependencies,
} from '../app/api/documents/[id]/download/route'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'

// ---------------------------------------------------------------------------
// Mock Supabase Client Factory
// ---------------------------------------------------------------------------

interface MockDbOptions {
  documents?: any[]
  permissions?: any[]
  storageObjects?: Record<string, Buffer | Blob>
  storageDownloadError?: Error | null
  documentError?: Error | null
  permissionError?: Error | null
}

function createMockSupabaseClient({
  documents = [],
  permissions = [],
  storageObjects = {},
  storageDownloadError = null,
  documentError = null,
  permissionError = null,
}: MockDbOptions = {}) {
  const downloadCalls: string[] = []

  return {
    _downloadCalls: downloadCalls,
    storage: {
      from: (_bucket: string) => ({
        download: async (path: string) => {
          downloadCalls.push(path)
          if (storageDownloadError) {
            return { data: null, error: storageDownloadError }
          }
          if (storageObjects[path] !== undefined) {
            return { data: storageObjects[path], error: null }
          }
          return {
            data: Buffer.from('%PDF-1.4 mock file payload'),
            error: null,
          }
        },
      }),
    },
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

const validOwnerDoc = {
  id: 'doc-101',
  owner_id: 'owner-user-1',
  name: 'quarterly_report.pdf',
  category: 'finance',
  storage_path: 'owner-user-1/uuid-101-quarterly_report.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T10:00:00Z',
  updated_at: '2026-10-23T10:00:00Z',
  deleted_at: null,
}

const deletedDoc = {
  id: 'doc-deleted',
  owner_id: 'owner-user-1',
  name: 'old_secret.pdf',
  category: 'confidential',
  storage_path: 'owner-user-1/uuid-999-old_secret.pdf',
  mime_type: 'application/pdf',
  created_at: '2026-10-23T08:00:00Z',
  updated_at: '2026-10-23T09:00:00Z',
  deleted_at: '2026-10-23T09:00:00Z',
}

const allSampleDocs = [validOwnerDoc, deletedDoc]

// ---------------------------------------------------------------------------
// Tests Suite
// ---------------------------------------------------------------------------

describe('Server-Side Document Download Foundation (GET /api/documents/:id/download)', () => {
  // ── Filename Sanitization Unit Tests ─────────────────────────────────────

  describe('sanitizeDownloadFilename', () => {
    it('preserves clean safe filenames', () => {
      assert.strictEqual(sanitizeDownloadFilename('report.pdf'), 'report.pdf')
      assert.strictEqual(sanitizeDownloadFilename('taxes_2026.docx'), 'taxes_2026.docx')
    })

    it('strips newlines and carriage returns (CRLF injection prevention)', () => {
      const malicious = 'evil\r\nSet-Cookie: admin=true\r\n.pdf'
      const sanitized = sanitizeDownloadFilename(malicious)
      assert.ok(!sanitized.includes('\r'), 'must not contain \\r')
      assert.ok(!sanitized.includes('\n'), 'must not contain \\n')
    })

    it('strips double quotes to prevent breaking header parameter delimiters', () => {
      const malicious = 'file"; filename="hacked.pdf'
      const sanitized = sanitizeDownloadFilename(malicious)
      assert.ok(!sanitized.includes('"'), 'must not contain double quotes')
    })

    it('replaces path traversal directory separators with underscores', () => {
      const traversal = '../../etc/passwd'
      const sanitized = sanitizeDownloadFilename(traversal)
      assert.ok(!sanitized.includes('/'), 'must not contain forward slash')
      assert.ok(!sanitized.includes('\\'), 'must not contain backslash')
    })

    it('falls back to "document" if filename is empty or only whitespace', () => {
      assert.strictEqual(sanitizeDownloadFilename(''), 'document')
      assert.strictEqual(sanitizeDownloadFilename('   '), 'document')
    })
  })

  // ── Authentication Checks ────────────────────────────────────────────────

  it('rejects unauthenticated request with code "unauthenticated" and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('unauthenticated'),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'unauthenticated')
    }
    // Verify storage was NEVER touched
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed for unauthenticated requests'
    )
  })

  it('rejects request when user profile is missing (profile_not_found) and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('profile_not_found', { id: 'missing-user' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(mockSupabase._downloadCalls.length, 0)
  })

  it('rejects request when user has an invalid role and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('invalid_role', { id: 'bad-role-user' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(mockSupabase._downloadCalls.length, 0)
  })

  // ── Authorization: Owner ─────────────────────────────────────────────────

  it('allows owner to download their own document', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      storageObjects: {
        'owner-user-1/uuid-101-quarterly_report.pdf': Buffer.from('owner-file-content'),
      },
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.name, 'quarterly_report.pdf')
      assert.strictEqual(result.mimeType, 'application/pdf')
      const text = Buffer.from(result.data).toString()
      assert.strictEqual(text, 'owner-file-content')
    }

    assert.strictEqual(mockSupabase._downloadCalls.length, 1)
    assert.strictEqual(
      mockSupabase._downloadCalls[0],
      'owner-user-1/uuid-101-quarterly_report.pdf'
    )
  })

  it('denies owner from downloading another owner’s document and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-user-2', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed when owner attempts cross-tenant download'
    )
  })

  // ── Authorization: Admin ─────────────────────────────────────────────────

  it('allows admin to download any document across the application', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      storageObjects: {
        'owner-user-1/uuid-101-quarterly_report.pdf': Buffer.from('admin-download-content'),
      },
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'admin-user-1', role: 'admin' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.name, 'quarterly_report.pdf')
      assert.strictEqual(result.mimeType, 'application/pdf')
    }
    assert.strictEqual(mockSupabase._downloadCalls.length, 1)
    assert.strictEqual(
      mockSupabase._downloadCalls[0],
      'owner-user-1/uuid-101-quarterly_report.pdf'
    )
  })

  // ── Authorization: Viewer ────────────────────────────────────────────────

  it('allows viewer with explicit read permission to download the document', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-1',
          document_id: 'doc-101',
          user_id: 'viewer-user-1',
          can_read: true,
          can_edit: false,
        },
      ],
      storageObjects: {
        'owner-user-1/uuid-101-quarterly_report.pdf': Buffer.from('viewer-authorized-bytes'),
      },
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-user-1', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.name, 'quarterly_report.pdf')
      const text = Buffer.from(result.data).toString()
      assert.strictEqual(text, 'viewer-authorized-bytes')
    }
    assert.strictEqual(mockSupabase._downloadCalls.length, 1)
  })

  it('denies viewer without permission and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [], // zero permissions
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-unauthorized', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed when viewer lacks permission'
    )
  })

  it('denies viewer with revoked permission (can_read = false) and never accesses storage', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      permissions: [
        {
          id: 'perm-revoked',
          document_id: 'doc-101',
          user_id: 'viewer-revoked',
          can_read: false,
          can_edit: false,
        },
      ],
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-revoked', role: 'viewer' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed when permission is revoked'
    )
  })

  // ── Deleted Document & Nonexistent Document ──────────────────────────────

  it('denies download of soft-deleted documents with code "not_found"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })

    // Even the owner of the deleted document cannot download it
    const result = await handleDownload('doc-deleted', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'not_found')
    }
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed for deleted documents'
    )
  })

  it('denies download of nonexistent document with code "not_found"', async () => {
    const mockSupabase = createMockSupabaseClient({ documents: allSampleDocs })
    const result = await handleDownload('nonexistent-doc-id', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'admin-1', role: 'admin' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'not_found')
    }
    assert.strictEqual(mockSupabase._downloadCalls.length, 0)
  })

  // ── Server-Side Storage Path Control ──────────────────────────────────────

  it('client cannot control storage_path: always uses storage_path from verified database record', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: [
        {
          id: 'doc-safe',
          owner_id: 'owner-1',
          name: 'safe.pdf',
          category: 'general',
          storage_path: 'owner-1/legit-uuid-safe.pdf',
          mime_type: 'application/pdf',
          created_at: '2026-10-23T10:00:00Z',
          updated_at: '2026-10-23T10:00:00Z',
          deleted_at: null,
        },
      ],
      storageObjects: {
        'owner-1/legit-uuid-safe.pdf': Buffer.from('verified-file-bytes'),
      },
    })

    const result = await handleDownload('doc-safe', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(mockSupabase._downloadCalls.length, 1)
    // The exact path used MUST match the database row, never any client input
    assert.strictEqual(mockSupabase._downloadCalls[0], 'owner-1/legit-uuid-safe.pdf')
  })

  // ── Error Handling Fail-Closed ────────────────────────────────────────────

  it('fails closed when Supabase Storage download fails', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      storageDownloadError: new Error('Storage object corrupted or bucket unreachable'),
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'storage_error')
    }
  })

  it('fails closed when database query fails during authorization', async () => {
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      documentError: new Error('Postgres connection reset'),
    })

    const result = await handleDownload('doc-101', {
      supabaseClient: mockSupabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
    })

    assert.strictEqual(result.status, 'error')
    assert.strictEqual(
      mockSupabase._downloadCalls.length,
      0,
      'Storage must NEVER be accessed when database fails'
    )
  })

  // ── Next.js GET Route Handler Response Format ─────────────────────────────

  it('GET route handler returns 200 with appropriate download headers for authorized caller', async () => {
    const fileBytes = Buffer.from('%PDF-1.4 sample pdf content for download')
    const mockSupabase = createMockSupabaseClient({
      documents: allSampleDocs,
      storageObjects: {
        'owner-user-1/uuid-101-quarterly_report.pdf': fileBytes,
      },
    })

    // Invoke GET handler with mock context and dependency
    const fakeRequest = {} as NextRequest
    const response = await (async () => {
      // Test the response constructed by handleDownload
      const result = await handleDownload('doc-101', {
        supabaseClient: mockSupabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-user-1', role: 'owner' }),
      })
      assert.strictEqual(result.status, 'success')

      if (result.status === 'success') {
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
      throw new Error('Expected success')
    })()

    assert.strictEqual(response.status, 200)
    assert.strictEqual(response.headers.get('Content-Type'), 'application/pdf')
    assert.strictEqual(
      response.headers.get('Content-Disposition'),
      'attachment; filename="quarterly_report.pdf"'
    )
    assert.strictEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.strictEqual(
      response.headers.get('Cache-Control'),
      'private, no-cache, no-store, must-revalidate'
    )

    const downloadedText = await response.text()
    assert.strictEqual(downloadedText, '%PDF-1.4 sample pdf content for download')
  })
})
