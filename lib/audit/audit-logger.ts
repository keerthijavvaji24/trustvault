import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

/** Allowed audit actions matching database constraint */
export const AUDIT_ACTIONS = [
  'document.upload',
  'document.download',
  'document.update',
  'document.delete',
  'permission.grant',
  'permission.update',
  'permission.revoke',
  'permissions.list',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Allowed audit outcomes matching database constraint */
export const AUDIT_OUTCOMES = ['allowed', 'denied', 'error'] as const

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

/** UUID v4 regex for document_id and target_user_id validation */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sensitive keys stripped from details to prevent secret/path leakage */
const SENSITIVE_DETAIL_KEYS = new Set([
  'storage_path',
  'storagepath',
  'password',
  'token',
  'secret',
  'filebuffer',
  'buffer',
  'data',
  'p_server_token',
])

export interface RecordAuditLogParams {
  action: AuditAction
  outcome: AuditOutcome
  documentId?: string | null
  targetUserId?: string | null
  reason?: string | null
  details?: Record<string, unknown>
}

export interface AuditLoggerOptions {
  /** Supabase client (authenticated session; NO service-role key) */
  supabaseClient?: any
  /** Optional override for server attestation token (defaults to process.env.AUDIT_SERVER_TOKEN) */
  serverToken?: string
}

export type AuditLogResult =
  | {
      status: 'success'
      auditId: string
    }
  | {
      status: 'error'
      code: 'missing_token' | 'invalid_input' | 'database_error'
      message: string
    }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validates whether an action matches the supported allowlist */
export function isValidAuditAction(action: unknown): action is AuditAction {
  return typeof action === 'string' && AUDIT_ACTIONS.includes(action as AuditAction)
}

/** Validates whether an outcome matches the supported allowlist */
export function isValidAuditOutcome(outcome: unknown): outcome is AuditOutcome {
  return typeof outcome === 'string' && AUDIT_OUTCOMES.includes(outcome as AuditOutcome)
}

/** Validates a UUID string */
export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim())
}

/**
 * Sanitizes the audit details JSON object:
 * - Strips sensitive fields (storage paths, secrets, raw buffers)
 * - Ensures details is a plain serializable JSON object
 */
export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return {}
  }

  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase()
    if (SENSITIVE_DETAIL_KEYS.has(lowerKey)) {
      continue // skip sensitive keys
    }

    // Do not serialize functions, symbols, or large buffers
    if (typeof value === 'function' || typeof value === 'symbol') {
      continue
    }

    if (Buffer.isBuffer(value) || value instanceof ArrayBuffer) {
      continue
    }

    clean[key] = value
  }

  return clean
}

// ---------------------------------------------------------------------------
// Core Audit Logger Helper
// ---------------------------------------------------------------------------

/**
 * Server-side audit logging helper.
 *
 * Security Guarantees:
 * 1. Server-Only Execution: Fails if invoked in a client/browser environment.
 * 2. Authenticated Session: Calls PostgreSQL RPC `record_audit_log` which derives
 *    `actor_id` from `auth.uid()` and `actor_role` from `public.profiles`.
 * 3. Server Attestation: Supplies `process.env.AUDIT_SERVER_TOKEN` directly from the
 *    server runtime. Fails closed with `missing_token` if the token is not configured.
 * 4. Input Validation: Strictly checks `action` and `outcome` against allowlists before RPC call.
 * 5. Data Sanitization: Strips `storage_path`, tokens, and binary buffers from `details`.
 * 6. No Service-Role Key: Uses the standard authenticated client with RLS.
 */
export async function logAuditEvent(
  params: RecordAuditLogParams,
  options?: AuditLoggerOptions
): Promise<AuditLogResult> {
  // 1. Enforce server-only boundary
  if (typeof window !== 'undefined') {
    throw new Error('logAuditEvent can only be called from a server environment.')
  }

  // 2. Validate action
  if (!isValidAuditAction(params.action)) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: `Invalid audit action: "${params.action}". Must be one of: ${AUDIT_ACTIONS.join(', ')}.`,
    }
  }

  // 3. Validate outcome
  if (!isValidAuditOutcome(params.outcome)) {
    return {
      status: 'error',
      code: 'invalid_input',
      message: `Invalid audit outcome: "${params.outcome}". Must be one of: ${AUDIT_OUTCOMES.join(', ')}.`,
    }
  }

  // 4. Validate documentId if provided
  let cleanDocId: string | null = null
  if (params.documentId !== undefined && params.documentId !== null) {
    if (!isValidUUID(params.documentId)) {
      return {
        status: 'error',
        code: 'invalid_input',
        message: 'Invalid documentId: must be a valid UUID.',
      }
    }
    cleanDocId = params.documentId.trim()
  }

  // 5. Validate targetUserId if provided
  let cleanTargetUserId: string | null = null
  if (params.targetUserId !== undefined && params.targetUserId !== null) {
    if (!isValidUUID(params.targetUserId)) {
      return {
        status: 'error',
        code: 'invalid_input',
        message: 'Invalid targetUserId: must be a valid UUID.',
      }
    }
    cleanTargetUserId = params.targetUserId.trim()
  }

  // 6. Resolve server attestation token (fail closed if missing)
  const serverToken = options?.serverToken ?? process.env.AUDIT_SERVER_TOKEN
  if (!serverToken || !serverToken.trim()) {
    return {
      status: 'error',
      code: 'missing_token',
      message: 'Server configuration error: AUDIT_SERVER_TOKEN is not configured.',
    }
  }

  // 7. Sanitize details
  const cleanDetails = sanitizeAuditDetails(params.details)

  // 8. Initialize Supabase client
  let supabase: any
  try {
    supabase = options?.supabaseClient ?? (await createClient())
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Failed to initialize database client: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }

  // 9. Invoke PostgreSQL RPC record_audit_log
  try {
    const { data, error } = await supabase.rpc('record_audit_log', {
      p_action: params.action,
      p_outcome: params.outcome,
      p_document_id: cleanDocId,
      p_target_user_id: cleanTargetUserId,
      p_reason: params.reason ?? null,
      p_details: cleanDetails,
      p_server_token: serverToken.trim(),
    })

    if (error) {
      return {
        status: 'error',
        code: 'database_error',
        message: `Audit logging failed: ${error.message}`,
      }
    }

    if (!data) {
      return {
        status: 'error',
        code: 'database_error',
        message: 'Audit logging did not return a valid audit record ID.',
      }
    }

    return {
      status: 'success',
      auditId: data as string,
    }
  } catch (err) {
    return {
      status: 'error',
      code: 'database_error',
      message: `Audit logging exception: ${err instanceof Error ? err.message : 'unknown error'}`,
    }
  }
}
