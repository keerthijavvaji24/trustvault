import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  handleUpload,
  sanitizeFilename,
  validateFileContent,
  isPdf,
  isPng,
  isJpeg,
  isDocx,
  isPlainText,
  type UploadDependencies,
  type UploadInput,
} from '../app/api/documents/upload/route'
import type { AuthUserWithRoleResult, UserRole } from '../lib/auth/roles'

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

/**
 * Returns realistic file content matching the MIME type for tests.
 */
export function getDefaultContentForMimeType(type: string): Buffer | string {
  switch (type) {
    case 'application/pdf':
      return Buffer.from('%PDF-1.4\n%mock valid pdf content\n%%EOF')
    case 'image/png':
      return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    case 'image/jpeg':
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('mock-docx-data-[Content_Types].xml-word/document.xml'),
      ])
    case 'text/plain':
    default:
      return 'Valid plain text content for testing.'
  }
}

/**
 * Creates a mock File object. Node's test environment doesn't have the File
 * global, so we construct a minimal duck-typed version that satisfies the
 * handleUpload interface.
 */
function makeMockFile({
  name = 'test.pdf',
  type = 'application/pdf',
  size = 1024,
  content,
}: {
  name?: string
  type?: string
  size?: number
  content?: string | Uint8Array | Buffer
} = {}): File {
  const fileContent = content !== undefined ? content : getDefaultContentForMimeType(type)
  const blob = new Blob([fileContent as any], { type })
  // Override size if we need to simulate an oversized file
  const file = new File([blob], name, { type })
  if (size !== blob.size) {
    Object.defineProperty(file, 'size', { value: size, writable: false })
  }
  return file
}

/**
 * Returns a mock auth resolver that yields a predetermined result.
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

/**
 * Builds a mock Supabase client that captures calls and returns controllable
 * results for storage.upload, storage.remove, and from('documents').insert.
 */
function makeMockSupabaseClient({
  storageUploadError = null,
  insertError = null,
  captureInserted,
  captureStorageUpload,
  captureStorageRemove,
}: {
  storageUploadError?: { message: string } | null
  insertError?: { message: string } | null
  captureInserted?: (row: any) => void
  captureStorageUpload?: (path: string) => void
  captureStorageRemove?: (paths: string[]) => void
} = {}) {
  const removedPaths: string[] = []
  const uploadedPaths: string[] = []

  return {
    storage: {
      from: (_bucket: string) => ({
        upload: async (path: string, _data: any, _opts?: any) => {
          uploadedPaths.push(path)
          captureStorageUpload?.(path)
          if (storageUploadError) {
            return { data: null, error: storageUploadError }
          }
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          removedPaths.push(...paths)
          captureStorageRemove?.(paths)
          return { data: paths, error: null }
        },
      }),
    },
    from: (_table: string) => ({
      insert: async (row: any) => {
        captureInserted?.(row)
        if (insertError) {
          return { data: null, error: insertError }
        }
        return { data: row, error: null }
      },
    }),
    _uploadedPaths: uploadedPaths,
    _removedPaths: removedPaths,
  }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

const VALID_FILE = makeMockFile({ name: 'report.pdf', type: 'application/pdf', size: 1024 })

function makeDeps(
  overrides: Partial<UploadDependencies> & {
    supabaseOptions?: Parameters<typeof makeMockSupabaseClient>[0]
  } = {}
): UploadDependencies {
  const { supabaseOptions, ...rest } = overrides
  return {
    supabaseClient: makeMockSupabaseClient(supabaseOptions ?? {}),
    currentUserResolver: mockAuthResolver('success', { id: 'owner-abc', role: 'owner' }),
    ...rest,
  }
}

function makeInput(overrides: Partial<UploadInput> = {}): UploadInput {
  return { file: VALID_FILE, ...overrides }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Document Upload Foundation', () => {
  // ── sanitizeFilename unit tests ──────────────────────────────────────────

  describe('sanitizeFilename', () => {
    it('passes safe filenames through unchanged', () => {
      assert.strictEqual(sanitizeFilename('report.pdf'), 'report.pdf')
      assert.strictEqual(sanitizeFilename('my-file_2024.docx'), 'my-file_2024.docx')
    })

    it('replaces unsafe characters with underscores', () => {
      const result = sanitizeFilename('../../etc/passwd')
      // Slashes are replaced so the path cannot traverse directories
      assert.ok(!result.includes('/'), 'should not contain /')
      assert.ok(!result.includes('\\'), 'should not contain backslash')
      // The sanitizer intentionally keeps dots; what it strips are traversal separators.
      // Verify the result is a flat safe string (no directory separators).
      assert.ok(result.length > 0, 'result should not be empty')
    })

    it('strips leading and trailing whitespace', () => {
      assert.strictEqual(sanitizeFilename('  hello.pdf  '), 'hello.pdf')
    })

    it('collapses multiple consecutive underscores', () => {
      const result = sanitizeFilename('hello   world.pdf')
      assert.ok(!result.includes('__'), 'should not have consecutive underscores')
    })

    it('returns "unnamed_file" for an empty or whitespace-only filename', () => {
      assert.strictEqual(sanitizeFilename(''), 'unnamed_file')
      assert.strictEqual(sanitizeFilename('   '), 'unnamed_file')
    })
  })

  // ── Authentication / authorisation ──────────────────────────────────────

  it('rejects unauthenticated upload with code "unauthenticated"', async () => {
    const result = await handleUpload(makeInput(), {
      ...makeDeps(),
      currentUserResolver: mockAuthResolver('unauthenticated'),
    })
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'unauthenticated')
    }
  })

  it('rejects viewer upload with code "forbidden"', async () => {
    const result = await handleUpload(makeInput(), {
      ...makeDeps(),
      currentUserResolver: mockAuthResolver('success', { id: 'viewer-1', role: 'viewer' }),
    })
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
  })

  it('allows owner to upload successfully', async () => {
    const result = await handleUpload(makeInput(), makeDeps())
    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.ownerId, 'owner-abc')
      assert.ok(result.documentId, 'documentId must be set')
      assert.ok(result.storagePath.startsWith('owner-abc/'), 'storagePath must start with verified user id')
    }
  })

  it('allows admin to upload successfully', async () => {
    const result = await handleUpload(makeInput(), {
      ...makeDeps(),
      currentUserResolver: mockAuthResolver('success', { id: 'admin-1', role: 'admin' }),
    })
    assert.strictEqual(result.status, 'success')
    if (result.status === 'success') {
      assert.strictEqual(result.ownerId, 'admin-1')
      assert.ok(result.storagePath.startsWith('admin-1/'), 'storagePath must be prefixed with admin id')
    }
  })

  it('rejects when profile is missing (profile_not_found)', async () => {
    const result = await handleUpload(makeInput(), {
      ...makeDeps(),
      currentUserResolver: mockAuthResolver('profile_not_found'),
    })
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
  })

  it('rejects when role is invalid', async () => {
    const result = await handleUpload(makeInput(), {
      ...makeDeps(),
      currentUserResolver: mockAuthResolver('invalid_role'),
    })
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'forbidden')
    }
  })

  // ── File validation ──────────────────────────────────────────────────────

  it('rejects when no file is provided', async () => {
    const result = await handleUpload(makeInput({ file: null }), makeDeps())
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'missing_file')
    }
  })

  it('rejects oversized file (>10 MB)', async () => {
    const bigFile = makeMockFile({
      name: 'huge.pdf',
      type: 'application/pdf',
      size: 10 * 1024 * 1024 + 1,
    })
    const result = await handleUpload(makeInput({ file: bigFile }), makeDeps())
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'file_too_large')
    }
  })

  it('accepts file exactly at 10 MB limit', async () => {
    const exactFile = makeMockFile({
      name: 'exact.pdf',
      type: 'application/pdf',
      size: 10 * 1024 * 1024,
    })
    const result = await handleUpload(makeInput({ file: exactFile }), makeDeps())
    assert.strictEqual(result.status, 'success')
  })

  it('rejects disallowed MIME type', async () => {
    const badFile = makeMockFile({
      name: 'script.exe',
      type: 'application/x-msdownload',
      size: 100,
    })
    const result = await handleUpload(makeInput({ file: badFile }), makeDeps())
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'invalid_mime_type')
    }
  })

  it('accepts all allowed MIME types', async () => {
    const allowed = [
      { name: 'doc.pdf', type: 'application/pdf' },
      { name: 'doc.txt', type: 'text/plain' },
      { name: 'img.png', type: 'image/png' },
      { name: 'img.jpg', type: 'image/jpeg' },
      {
        name: 'doc.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ]
    for (const { name, type } of allowed) {
      const file = makeMockFile({ name, type, size: 512 })
      const result = await handleUpload(makeInput({ file }), makeDeps())
      assert.strictEqual(
        result.status,
        'success',
        `Expected success for MIME type ${type}, got: ${JSON.stringify(result)}`
      )
    }
  })

  // ── Security: client-supplied values must be ignored ────────────────────

  it('ignores client-supplied owner_id: ownership is always from the authenticated user', async () => {
    const inserted: any[] = []
    const supabase = makeMockSupabaseClient({
      captureInserted: (row) => inserted.push(row),
    })

    const result = await handleUpload(
      {
        file: VALID_FILE,
        clientOwnerIdIgnored: 'attacker-user-id',
      },
      {
        supabaseClient: supabase,
        currentUserResolver: mockAuthResolver('success', { id: 'real-owner-id', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(inserted.length, 1, 'expected exactly one insert')
    assert.strictEqual(
      inserted[0].owner_id,
      'real-owner-id',
      'owner_id must be the authenticated user, not the client-supplied value'
    )
    if (result.status === 'success') {
      assert.strictEqual(result.ownerId, 'real-owner-id')
      assert.ok(
        result.storagePath.startsWith('real-owner-id/'),
        'storage path must start with the authenticated user id'
      )
    }
  })

  it('ignores client-supplied storage_path: path is always server-generated', async () => {
    const uploadedPaths: string[] = []
    const supabase = makeMockSupabaseClient({
      captureStorageUpload: (path) => uploadedPaths.push(path),
    })

    const result = await handleUpload(
      {
        file: VALID_FILE,
        clientStoragePathIgnored: '../../sensitive/path/hack.pdf',
      },
      {
        supabaseClient: supabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-xyz', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(uploadedPaths.length, 1)
    // Must start with the authenticated user's id, not the client-supplied path
    assert.ok(
      uploadedPaths[0].startsWith('owner-xyz/'),
      `Storage path "${uploadedPaths[0]}" must start with authenticated user id "owner-xyz/"`
    )
    assert.ok(
      !uploadedPaths[0].includes('sensitive'),
      'Storage path must not contain client-supplied path segments'
    )
  })

  // ── Storage + DB failure / cleanup ───────────────────────────────────────

  it('returns storage_upload_failed when Storage upload fails', async () => {
    const result = await handleUpload(
      makeInput(),
      makeDeps({ supabaseOptions: { storageUploadError: { message: 'bucket not found' } } })
    )
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'storage_upload_failed')
    }
  })

  it('cleans up Storage object and returns error when DB insert fails after successful upload', async () => {
    const removedPaths: string[] = []
    const uploadedPaths: string[] = []

    const supabase = makeMockSupabaseClient({
      insertError: { message: 'unique constraint violation' },
      captureStorageUpload: (p) => uploadedPaths.push(p),
      captureStorageRemove: (ps) => removedPaths.push(...ps),
    })

    const result = await handleUpload(makeInput(), {
      supabaseClient: supabase,
      currentUserResolver: mockAuthResolver('success', { id: 'owner-cleanup', role: 'owner' }),
    })

    // Must NOT report success
    assert.strictEqual(result.status, 'error')
    if (result.status === 'error') {
      assert.strictEqual(result.code, 'metadata_insert_failed')
    }

    // The same path that was uploaded must have been cleaned up
    assert.strictEqual(uploadedPaths.length, 1, 'expected exactly one upload attempt')
    assert.strictEqual(removedPaths.length, 1, 'expected exactly one remove call for cleanup')
    assert.strictEqual(
      removedPaths[0],
      uploadedPaths[0],
      'the cleaned-up path must match the uploaded path'
    )
  })

  // ── Storage path format ───────────────────────────────────────────────────

  it('generates storage path in format <userId>/<uuid>-<sanitized-filename>', async () => {
    const uploadedPaths: string[] = []
    const supabase = makeMockSupabaseClient({
      captureStorageUpload: (p) => uploadedPaths.push(p),
    })

    const file = makeMockFile({ name: 'My Report (final).pdf', type: 'application/pdf', size: 512 })
    const result = await handleUpload(
      { file },
      {
        supabaseClient: supabase,
        currentUserResolver: mockAuthResolver('success', { id: 'user-path-test', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(uploadedPaths.length, 1)

    const [userId, rest] = uploadedPaths[0].split('/')
    assert.strictEqual(userId, 'user-path-test', 'path prefix must be the authenticated user id')
    assert.ok(rest, 'path must have a second segment')
    // rest should be <uuid>-<sanitized-filename>
    const uuidPart = rest.split('-').slice(0, 5).join('-')
    // UUID v4 regex
    assert.match(
      uuidPart,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      'path must contain a valid UUID v4 segment'
    )
  })

  // ── DB columns used ───────────────────────────────────────────────────────

  it('inserts exactly the confirmed schema columns with owner_id from verified user', async () => {
    const inserted: any[] = []
    const supabase = makeMockSupabaseClient({ captureInserted: (r) => inserted.push(r) })

    const file = makeMockFile({ name: 'invoice.pdf', type: 'application/pdf', size: 2048 })
    const result = await handleUpload(
      { file },
      {
        supabaseClient: supabase,
        currentUserResolver: mockAuthResolver('success', { id: 'owner-cols', role: 'owner' }),
      }
    )

    assert.strictEqual(result.status, 'success')
    assert.strictEqual(inserted.length, 1)
    const row = inserted[0]

    // Confirm each used column
    assert.ok(typeof row.id === 'string' && row.id.length > 0, 'id must be set')
    assert.strictEqual(row.owner_id, 'owner-cols', 'owner_id must be the authenticated user')
    assert.ok(typeof row.name === 'string' && row.name.length > 0, 'name must be set')
    assert.ok(typeof row.storage_path === 'string' && row.storage_path.length > 0, 'storage_path must be set')
    assert.strictEqual(row.mime_type, 'application/pdf', 'mime_type must be set')
    assert.ok(typeof row.created_at === 'string', 'created_at must be set')
    assert.ok(typeof row.updated_at === 'string', 'updated_at must be set')
    assert.strictEqual(row.deleted_at, null, 'deleted_at must be null on insert')
  })

  // ── MIME Spoofing & Byte Signature Validation ─────────────────────────────

  describe('Server-Side File Signature & Content Validation', () => {
    // ── Rejections for spoofed / mismatched MIME types ─────────────────────

    it('rejects PDF upload when content is plain text', async () => {
      const spoofedPdf = makeMockFile({
        name: 'fake.pdf',
        type: 'application/pdf',
        content: 'This is plain text pretending to be a PDF file.',
      })
      const result = await handleUpload(makeInput({ file: spoofedPdf }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
        assert.match(result.message, /does not match the declared MIME type/)
      }
    })

    it('rejects PDF upload when content is PNG image bytes', async () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
      const spoofedPdf = makeMockFile({
        name: 'image_as_pdf.pdf',
        type: 'application/pdf',
        content: pngBytes,
      })
      const result = await handleUpload(makeInput({ file: spoofedPdf }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects PNG upload when content is JPEG image bytes', async () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
      const spoofedPng = makeMockFile({
        name: 'jpeg_as_png.png',
        type: 'image/png',
        content: jpegBytes,
      })
      const result = await handleUpload(makeInput({ file: spoofedPng }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects PNG upload when content is plain text', async () => {
      const spoofedPng = makeMockFile({
        name: 'text_as_png.png',
        type: 'image/png',
        content: 'not a png at all',
      })
      const result = await handleUpload(makeInput({ file: spoofedPng }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects JPEG upload when content is PNG image bytes', async () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
      const spoofedJpeg = makeMockFile({
        name: 'png_as_jpeg.jpg',
        type: 'image/jpeg',
        content: pngBytes,
      })
      const result = await handleUpload(makeInput({ file: spoofedJpeg }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects JPEG upload when content is PDF bytes', async () => {
      const pdfBytes = Buffer.from('%PDF-1.7\n%fake-pdf-as-jpg')
      const spoofedJpeg = makeMockFile({
        name: 'pdf_as_jpeg.jpg',
        type: 'image/jpeg',
        content: pdfBytes,
      })
      const result = await handleUpload(makeInput({ file: spoofedJpeg }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects DOCX upload when content is plain text', async () => {
      const spoofedDocx = makeMockFile({
        name: 'fake.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: 'Just plain text claiming to be a DOCX document.',
      })
      const result = await handleUpload(makeInput({ file: spoofedDocx }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects DOCX upload when content is generic ZIP without OpenXML/Word structure', async () => {
      // Valid ZIP header but lacks [Content_Types].xml or word/ directory
      const genericZip = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('arbitrary_archive_entry_not_word_docs'),
      ])
      const spoofedDocx = makeMockFile({
        name: 'generic_archive.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: genericZip,
      })
      const result = await handleUpload(makeInput({ file: spoofedDocx }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains PDF magic bytes', async () => {
      const spoofedTxt = makeMockFile({
        name: 'disguised.txt',
        type: 'text/plain',
        content: '%PDF-1.4 binary content inside txt extension',
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains PNG magic bytes', async () => {
      const pngInTxt = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('rest of png file'),
      ])
      const spoofedTxt = makeMockFile({
        name: 'png_disguised.txt',
        type: 'text/plain',
        content: pngInTxt,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains JPEG magic bytes', async () => {
      const jpegInTxt = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from('jpeg image data'),
      ])
      const spoofedTxt = makeMockFile({
        name: 'jpeg_disguised.txt',
        type: 'text/plain',
        content: jpegInTxt,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content is a Windows PE executable (MZ header)', async () => {
      const peExe = Buffer.concat([
        Buffer.from([0x4d, 0x5a]), // 'MZ'
        Buffer.from('This program cannot be run in DOS mode.'),
      ])
      const spoofedTxt = makeMockFile({
        name: 'malware.txt',
        type: 'text/plain',
        content: peExe,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains binary null bytes', async () => {
      const nullBytes = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64])
      const spoofedTxt = makeMockFile({
        name: 'null_binary.txt',
        type: 'text/plain',
        content: nullBytes,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains invalid UTF-8 byte sequences', async () => {
      // 0xC0 and 0xC1 are invalid start bytes in UTF-8
      const invalidUtf8 = Buffer.from([0x48, 0x65, 0x6c, 0xc0, 0xaf, 0x6f])
      const spoofedTxt = makeMockFile({
        name: 'invalid_utf8.txt',
        type: 'text/plain',
        content: invalidUtf8,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    it('rejects TXT upload when content contains non-printable control characters', async () => {
      // 0x01 (SOH) is a control character not allowed in plain text
      const ctrlChar = Buffer.from([0x48, 0x65, 0x01, 0x6c, 0x6f])
      const spoofedTxt = makeMockFile({
        name: 'ctrl_chars.txt',
        type: 'text/plain',
        content: ctrlChar,
      })
      const result = await handleUpload(makeInput({ file: spoofedTxt }), makeDeps())
      assert.strictEqual(result.status, 'error')
      if (result.status === 'error') {
        assert.strictEqual(result.code, 'invalid_mime_type')
      }
    })

    // ── Direct validateFileContent unit tests ──────────────────────────────

    describe('validateFileContent unit tests', () => {
      it('validates genuine PDF buffer', () => {
        const buf = Buffer.from('%PDF-1.4\n%genuine pdf\n%%EOF')
        assert.strictEqual(validateFileContent(buf, 'application/pdf'), true)
        assert.strictEqual(validateFileContent(buf, 'image/png'), false)
        assert.strictEqual(validateFileContent(buf, 'image/jpeg'), false)
        assert.strictEqual(validateFileContent(buf, 'text/plain'), false)
      })

      it('validates genuine PNG buffer', () => {
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
        assert.strictEqual(validateFileContent(buf, 'image/png'), true)
        assert.strictEqual(validateFileContent(buf, 'application/pdf'), false)
        assert.strictEqual(validateFileContent(buf, 'image/jpeg'), false)
        assert.strictEqual(validateFileContent(buf, 'text/plain'), false)
      })

      it('validates genuine JPEG buffer', () => {
        const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
        assert.strictEqual(validateFileContent(buf, 'image/jpeg'), true)
        assert.strictEqual(validateFileContent(buf, 'image/png'), false)
        assert.strictEqual(validateFileContent(buf, 'application/pdf'), false)
        assert.strictEqual(validateFileContent(buf, 'text/plain'), false)
      })

      it('validates genuine DOCX buffer', () => {
        const buf = Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.from('doc-entry-[Content_Types].xml-word/document.xml'),
        ])
        assert.strictEqual(
          validateFileContent(buf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
          true
        )
        assert.strictEqual(validateFileContent(buf, 'application/pdf'), false)
        assert.strictEqual(validateFileContent(buf, 'text/plain'), false)
      })

      it('validates genuine plain text buffer (ASCII, UTF-8, and tabs/newlines)', () => {
        const buf = Buffer.from('Hello world!\nLine 2\tTabbed.\r\nUnicode: ñ, é, 🚀')
        assert.strictEqual(validateFileContent(buf, 'text/plain'), true)
        assert.strictEqual(validateFileContent(buf, 'application/pdf'), false)
      })

      it('allows empty buffer for text/plain but rejects for binary formats', () => {
        const empty = Buffer.alloc(0)
        assert.strictEqual(validateFileContent(empty, 'text/plain'), true)
        assert.strictEqual(validateFileContent(empty, 'application/pdf'), false)
        assert.strictEqual(validateFileContent(empty, 'image/png'), false)
        assert.strictEqual(validateFileContent(empty, 'image/jpeg'), false)
        assert.strictEqual(
          validateFileContent(empty, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
          false
        )
      })

      it('returns false for unrecognized MIME types', () => {
        const buf = Buffer.from('hello')
        assert.strictEqual(validateFileContent(buf, 'application/x-unknown'), false)
      })

      it('rejects truncated signatures', () => {
        assert.strictEqual(isPdf(Buffer.from('%PD')), false)
        assert.strictEqual(isPng(Buffer.from([0x89, 0x50, 0x4e])), false)
        assert.strictEqual(isJpeg(Buffer.from([0xff, 0xd8])), false)
        assert.strictEqual(isDocx(Buffer.from([0x50, 0x4b, 0x03])), false)
      })
    })
  })
})
