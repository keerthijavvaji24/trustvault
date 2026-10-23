import { randomUUID } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUserWithProfile } from '@/lib/auth/roles'
import { logAuditEvent } from '@/lib/audit/audit-logger'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Private Supabase Storage bucket. Never use a public bucket. */
const STORAGE_BUCKET = 'documents' as const

/** Maximum allowed upload size: 10 MB */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

/** Strict MIME type allowlist. Requests with any other type are rejected. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

/**
 * Roles permitted to upload documents.
 * Viewer role is explicitly denied.
 * The role is ALWAYS resolved server-side from the verified session cookie;
 * it is never read from the request body, headers, or query string.
 */
const UPLOAD_ALLOWED_ROLES = new Set(['admin', 'owner'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename so it is safe to embed in a Storage path.
 * - Strips leading/trailing whitespace
 * - Replaces any character that is not alphanumeric, hyphen, underscore, or dot
 *   with an underscore
 * - Collapses consecutive underscores
 * - Falls back to "unnamed_file" if the result is empty
 */
export function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim()
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return sanitized.length > 0 ? sanitized : 'unnamed_file'
}

/** PDF file magic bytes: %PDF- */
const PDF_MAGIC = Buffer.from('%PDF-')

/** PNG file magic 8-byte signature: 89 50 4E 47 0D 0A 1A 0A */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** ZIP local file header signature: PK\x03\x04 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/**
 * Validate if a buffer matches the PDF file format.
 * PDF files begin with %PDF- (or within the first 1024 bytes per ISO 32000).
 */
export function isPdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false
  if (buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    return true
  }
  const limit = Math.min(buffer.length, 1024)
  const header = buffer.subarray(0, limit)
  const index = header.indexOf(PDF_MAGIC)
  if (index === -1) return false
  const prefix = header.subarray(0, index)
  if (isPng(prefix) || isJpeg(prefix) || isZipHeader(prefix)) {
    return false
  }
  return true
}

/**
 * Validate if a buffer matches the PNG image format (RFC 2083).
 */
export function isPng(buffer: Buffer): boolean {
  if (buffer.length < 8) return false
  return buffer.subarray(0, 8).equals(PNG_MAGIC)
}

/**
 * Validate if a buffer matches the JPEG image format.
 * All JPEGs begin with SOI marker 0xFF 0xD8 followed by another marker beginning with 0xFF.
 */
export function isJpeg(buffer: Buffer): boolean {
  if (buffer.length < 3) return false
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

/**
 * Helper to check standard ZIP header (PK\x03\x04).
 */
export function isZipHeader(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  return buffer.subarray(0, 4).equals(ZIP_MAGIC)
}

/**
 * Validate if a buffer matches Microsoft Word OpenXML (.docx) format.
 * Must be a ZIP package containing OpenXML / Word structures.
 */
export function isDocx(buffer: Buffer): boolean {
  if (!isZipHeader(buffer)) return false
  return (
    buffer.includes(Buffer.from('[Content_Types].xml')) ||
    buffer.includes(Buffer.from('word/'))
  )
}

/**
 * Validate if a buffer is valid plain text (UTF-8).
 * Rejects binary null bytes, executable headers, control characters, and binary formats.
 */
export function isPlainText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true

  // Plain text must not contain null bytes (0x00)
  if (buffer.includes(0x00)) return false

  // Reject files starting with known binary signatures
  if (isPdf(buffer) || isPng(buffer) || isJpeg(buffer) || isZipHeader(buffer)) {
    return false
  }
  // Reject Windows DOS/PE executable (MZ)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return false
  }
  // Reject Linux ELF executable
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return false
  }

  // Reject control characters (< 32) except standard whitespace:
  // 0x09 (tab), 0x0A (LF), 0x0C (FF), 0x0D (CR)
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) {
      return false
    }
  }

  // Must be valid UTF-8
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return false
  }

  return true
}

/**
 * Validates actual file bytes against the declared MIME type.
 * Returns true if the file content matches the declared type, false otherwise.
 */
export function validateFileContent(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  mimeType: string
): boolean {
  const buf = Buffer.isBuffer(buffer)
    ? buffer
    : buffer instanceof Uint8Array
      ? Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      : Buffer.from(buffer)

  switch (mimeType) {
    case 'application/pdf':
      return isPdf(buf)
    case 'image/png':
      return isPng(buf)
    case 'image/jpeg':
      return isJpeg(buf)
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return isDocx(buf)
    case 'text/plain':
      return isPlainText(buf)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Dependency-injectable handler core
// Separated from the Next.js route so unit tests can drive it directly
// without a real Request object or Next.js infrastructure.
// ---------------------------------------------------------------------------

export interface UploadDependencies {
  /** Supabase client (authenticated session, NO service-role key) */
  supabaseClient: any
  /**
   * Resolver for the authenticated user + validated role.
   * Must return an AuthUserWithRoleResult discriminated union.
   */
  currentUserResolver: () => Promise<any>
}

export interface UploadInput {
  file: File | null
  /**
   * Any client-supplied owner_id value, captured only to be explicitly ignored.
   * It has no effect on authorization or the database row.
   */
  clientOwnerIdIgnored?: string | null
  /**
   * Any client-supplied storage_path value, captured only to be explicitly ignored.
   * It has no effect on where the file is stored.
   */
  clientStoragePathIgnored?: string | null
}

export interface UploadSuccessResult {
  status: 'success'
  documentId: string
  storagePath: string
  name: string
  mimeType: string
  ownerId: string
}

export interface UploadErrorResult {
  status: 'error'
  code:
    | 'unauthenticated'
    | 'forbidden'
    | 'missing_file'
    | 'invalid_filename'
    | 'file_too_large'
    | 'invalid_mime_type'
    | 'storage_upload_failed'
    | 'metadata_insert_failed'
  message: string
}

export type UploadResult = UploadSuccessResult | UploadErrorResult

/**
 * Core upload logic, separated from the Next.js route handler for testability.
 *
 * Security guarantees:
 * 1. User identity is resolved from verified session cookies via currentUserResolver
 *    never from the request body, headers, or query string.
 * 2. Only 'admin' and 'owner' roles may upload; 'viewer' is rejected server-side.
 * 3. owner_id stored in the database row is ALWAYS the authenticated user's ID.
 * 4. The Storage path is generated server-side: <userId>/<uuid>-<sanitized-name>.
 * 5. Only the private "documents" bucket is used; no public URLs are created.
 * 6. File content / byte signature is verified against declared MIME type server-side.
 * 7. If DB insertion fails after Storage upload, the orphaned object is cleaned up.
 * 8. Fails closed on every validation or IO error.
 */
export async function handleUpload(
  input: UploadInput,
  deps: UploadDependencies
): Promise<UploadResult> {
  // 1. Resolve authenticated user and role
  let authResult: any
  try {
    authResult = await deps.currentUserResolver()
  } catch (err) {
    return {
      status: 'error',
      code: 'unauthenticated',
      message: `Authentication check failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  if (authResult.status !== 'success') {
    return {
      status: 'error',
      code: authResult.status === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
      message:
        authResult.error ?? 'Authentication required. Valid session with a known role is needed.',
    }
  }

  // 2. Enforce upload role: admin or owner only
  // profile.role is ALWAYS resolved server-side from public.profiles;
  // it is never sourced from the client.
  const { user, profile } = authResult
  if (!UPLOAD_ALLOWED_ROLES.has(profile.role)) {
    void logAuditEvent(
      {
        action: 'document.upload',
        outcome: 'denied',
        reason: `Role "${profile.role}" is not permitted to upload documents.`,
      },
      { supabaseClient: deps.supabaseClient }
    )
    return {
      status: 'error',
      code: 'forbidden',
      message: `Role "${profile.role}" is not permitted to upload documents.`,
    }
  }

  // 3. Validate file presence
  if (!input.file) {
    return {
      status: 'error',
      code: 'missing_file',
      message: 'No file was provided in the request.',
    }
  }

  const file = input.file

  // 4. Validate filename
  if (!file.name || file.name.trim().length === 0) {
    return {
      status: 'error',
      code: 'invalid_filename',
      message: 'Uploaded file has no filename.',
    }
  }

  // 5. Validate file size
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      status: 'error',
      code: 'file_too_large',
      message: `File size ${file.size} bytes exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (10 MB).`,
    }
  }

  // 6. Validate MIME type
  if (!file.type || !ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      status: 'error',
      code: 'invalid_mime_type',
      message: `MIME type "${file.type}" is not allowed. Allowed types: ${[...ALLOWED_MIME_TYPES].join(', ')}.`,
    }
  }

  // 7. Read file content and validate actual byte signature / content
  let fileBuffer: ArrayBuffer
  try {
    fileBuffer = await file.arrayBuffer()
  } catch (err) {
    return {
      status: 'error',
      code: 'missing_file',
      message: `Failed to read file content: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  const buffer = Buffer.from(fileBuffer)

  // Verify byte length matches maximum size limit
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    return {
      status: 'error',
      code: 'file_too_large',
      message: `File size ${buffer.byteLength} bytes exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (10 MB).`,
    }
  }

  // Reject files whose declared MIME type does not match their actual content
  if (!validateFileContent(buffer, file.type)) {
    return {
      status: 'error',
      code: 'invalid_mime_type',
      message: `File content does not match the declared MIME type "${file.type}".`,
    }
  }

  // 8. Generate server-side storage path
  // verifiedOwnerId is ALWAYS the authenticated user's ID, never the client-supplied value.
  // storagePath is generated entirely server-side; client-supplied paths are ignored.
  const verifiedOwnerId: string = user.id
  const generatedId = randomUUID()
  const sanitizedName = sanitizeFilename(file.name)
  // Format: <verified-user-id>/<generated-uuid>-<sanitized-filename>
  const storagePath = `${verifiedOwnerId}/${generatedId}-${sanitizedName}`

  // 9. Upload to private "documents" Storage bucket
  const { error: storageError } = await deps.supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    })

  if (storageError) {
    return {
      status: 'error',
      code: 'storage_upload_failed',
      message: `Storage upload failed: ${storageError.message}`,
    }
  }

  // 9. Insert metadata row into public.documents
  // Uses only columns confirmed by the existing schema.
  // owner_id is ALWAYS verifiedOwnerId, never from client input.
  const documentId = randomUUID()
  const now = new Date().toISOString()

  const { error: insertError } = await deps.supabaseClient
    .from('documents')
    .insert({
      id: documentId,
      owner_id: verifiedOwnerId,
      name: sanitizedName,
      storage_path: storagePath,
      mime_type: file.type,
      // description and category are optional; not sourced from client in this endpoint
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })

  // 10. Compensate if DB insertion fails: remove the orphaned Storage object.
  if (insertError) {
    await deps.supabaseClient.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath])
      .catch(() => {
        console.error(
          '[upload] Storage cleanup after DB failure also failed for path:',
          storagePath
        )
      })

    return {
      status: 'error',
      code: 'metadata_insert_failed',
      message: `Document metadata could not be saved: ${insertError.message}`,
    }
  }

  // 11. Return success
  void logAuditEvent(
    {
      action: 'document.upload',
      outcome: 'allowed',
      documentId,
      details: { name: sanitizedName, mimeType: file.type },
    },
    { supabaseClient: deps.supabaseClient }
  )
  return {
    status: 'success',
    documentId,
    storagePath,
    name: sanitizedName,
    mimeType: file.type,
    ownerId: verifiedOwnerId,
  }
}

// ---------------------------------------------------------------------------
// Next.js Route Handler
// ---------------------------------------------------------------------------

/**
 * POST /api/documents/upload
 *
 * Accepts multipart/form-data with a `file` field.
 * Authenticates via server-side session cookies on every request.
 * Only `admin` and `owner` roles may upload.
 * All authorization decisions, IDs, and storage paths are derived server-side.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json(
      { error: 'Invalid request: expected multipart/form-data.' },
      { status: 400 }
    )
  }

  const file = formData.get('file')
  // Deliberately read but discard any client-supplied owner_id and storage_path.
  // These values MUST NOT influence any authorization or path decision.
  const _ignoredClientOwnerId = formData.get('owner_id')
  const _ignoredClientStoragePath = formData.get('storage_path')

  const input: UploadInput = {
    file: file instanceof File ? file : null,
    clientOwnerIdIgnored:
      typeof _ignoredClientOwnerId === 'string' ? _ignoredClientOwnerId : null,
    clientStoragePathIgnored:
      typeof _ignoredClientStoragePath === 'string' ? _ignoredClientStoragePath : null,
  }

  // Obtain a fresh authenticated Supabase client for every request.
  // Uses the publishable key + RLS; the service-role key is never used.
  let supabase: any
  try {
    supabase = await createClient()
  } catch {
    return Response.json(
      { error: 'Server configuration error. Unable to initialize database client.' },
      { status: 500 }
    )
  }

  const result = await handleUpload(input, {
    supabaseClient: supabase,
    currentUserResolver: getCurrentUserWithProfile,
  })

  if (result.status === 'error') {
    const httpStatus =
      result.code === 'unauthenticated'
        ? 401
        : result.code === 'forbidden'
          ? 403
          : result.code === 'missing_file' ||
              result.code === 'invalid_filename' ||
              result.code === 'file_too_large' ||
              result.code === 'invalid_mime_type'
            ? 400
            : 500

    return Response.json({ error: result.message, code: result.code }, { status: httpStatus })
  }

  return Response.json(
    {
      documentId: result.documentId,
      name: result.name,
      mimeType: result.mimeType,
      storagePath: result.storagePath,
    },
    { status: 201 }
  )
}
