import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  logAuditEvent,
  isValidAuditAction,
  isValidAuditOutcome,
  isValidUUID,
  sanitizeAuditDetails,
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  type RecordAuditLogParams,
} from '../lib/audit/audit-logger'

// ---------------------------------------------------------------------------
// Mock Supabase RPC Factory
// ---------------------------------------------------------------------------

interface RpcCall {
  procedure: string
  params: Record<string, any>
}

function createMockRpcClient(options?: {
  returnValue?: string | null
  error?: Error | null
  throwError?: boolean
}) {
  const rpcCalls: RpcCall[] = []

  return {
    _rpcCalls: rpcCalls,
    rpc: async (procedure: string, params: Record<string, any>) => {
      rpcCalls.push({ procedure, params })
      if (options?.throwError) {
        throw new Error('RPC network connection lost')
      }
      if (options?.error) {
        return { data: null, error: options.error }
      }
      return { data: options?.returnValue ?? '00000000-0000-0000-0000-000000000001', error: null }
    },
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_DOC_ID = '11111111-1111-1111-1111-111111111111'
const VALID_TARGET_USER_ID = '22222222-2222-2222-2222-222222222222'
const TEST_TOKEN = 'test-server-secret-token-12345'

// ---------------------------------------------------------------------------
// Tests: Validators & Sanitization Unit Tests
// ---------------------------------------------------------------------------

describe('Audit Logger - Validators and Helpers', () => {
  it('accepts all canonical audit actions', () => {
    for (const action of AUDIT_ACTIONS) {
      assert.equal(isValidAuditAction(action), true, `action ${action} should be valid`)
    }
  })

  it('rejects unrecognized audit actions', () => {
    assert.equal(isValidAuditAction('document.read'), false)
    assert.equal(isValidAuditAction('user.login'), false)
    assert.equal(isValidAuditAction(''), false)
    assert.equal(isValidAuditAction(null), false)
  })

  it('accepts all canonical audit outcomes', () => {
    for (const outcome of AUDIT_OUTCOMES) {
      assert.equal(isValidAuditOutcome(outcome), true, `outcome ${outcome} should be valid`)
    }
  })

  it('rejects unrecognized audit outcomes', () => {
    assert.equal(isValidAuditOutcome('success'), false)
    assert.equal(isValidAuditOutcome('pending'), false)
    assert.equal(isValidAuditOutcome(123), false)
  })

  it('validates UUIDs properly', () => {
    assert.equal(isValidUUID(VALID_DOC_ID), true)
    assert.equal(isValidUUID('invalid-uuid'), false)
    assert.equal(isValidUUID(''), false)
    assert.equal(isValidUUID(null), false)
  })

  it('sanitizes details by removing sensitive keys and buffers', () => {
    const rawDetails = {
      storage_path: 'user-id/secret-doc.pdf',
      storagePath: 'user-id/secret-doc.pdf',
      password: 'super-secret-password',
      token: 'bearer-token-123',
      secret: 'api-secret',
      fileBuffer: Buffer.from('binary-data'),
      filename: 'report.pdf',
      fileSize: 1024,
      category: 'finance',
    }

    const clean = sanitizeAuditDetails(rawDetails)
    assert.equal(clean.filename, 'report.pdf')
    assert.equal(clean.fileSize, 1024)
    assert.equal(clean.category, 'finance')
    assert.equal(clean.storage_path, undefined)
    assert.equal(clean.storagePath, undefined)
    assert.equal(clean.password, undefined)
    assert.equal(clean.token, undefined)
    assert.equal(clean.secret, undefined)
    assert.equal(clean.fileBuffer, undefined)
  })

  it('handles empty or non-object details safely', () => {
    assert.deepEqual(sanitizeAuditDetails(undefined), {})
    assert.deepEqual(sanitizeAuditDetails(null as any), {})
    assert.deepEqual(sanitizeAuditDetails([] as any), {})
  })
})

// ---------------------------------------------------------------------------
// Tests: logAuditEvent Core Logic
// ---------------------------------------------------------------------------

describe('Audit Logger - logAuditEvent', () => {
  it('successfully logs an allowed document.download event', async () => {
    const client = createMockRpcClient({ returnValue: 'audit-id-100' })
    const params: RecordAuditLogParams = {
      action: 'document.download',
      outcome: 'allowed',
      documentId: VALID_DOC_ID,
      details: { filename: 'statement.pdf' },
    }

    const result = await logAuditEvent(params, {
      supabaseClient: client,
      serverToken: TEST_TOKEN,
    })

    assert.equal(result.status, 'success')
    if (result.status === 'success') {
      assert.equal(result.auditId, 'audit-id-100')
    }

    assert.equal(client._rpcCalls.length, 1)
    const call = client._rpcCalls[0]
    assert.equal(call.procedure, 'record_audit_log')
    assert.equal(call.params.p_action, 'document.download')
    assert.equal(call.params.p_outcome, 'allowed')
    assert.equal(call.params.p_document_id, VALID_DOC_ID)
    assert.equal(call.params.p_target_user_id, null)
    assert.equal(call.params.p_server_token, TEST_TOKEN)
    assert.deepEqual(call.params.p_details, { filename: 'statement.pdf' })
  })

  it('successfully logs a denied permission.grant event with target user', async () => {
    const client = createMockRpcClient({ returnValue: 'audit-id-200' })
    const params: RecordAuditLogParams = {
      action: 'permission.grant',
      outcome: 'denied',
      documentId: VALID_DOC_ID,
      targetUserId: VALID_TARGET_USER_ID,
      reason: 'viewer_cannot_grant',
    }

    const result = await logAuditEvent(params, {
      supabaseClient: client,
      serverToken: TEST_TOKEN,
    })

    assert.equal(result.status, 'success')
    assert.equal(client._rpcCalls.length, 1)
    const call = client._rpcCalls[0]
    assert.equal(call.params.p_action, 'permission.grant')
    assert.equal(call.params.p_outcome, 'denied')
    assert.equal(call.params.p_document_id, VALID_DOC_ID)
    assert.equal(call.params.p_target_user_id, VALID_TARGET_USER_ID)
    assert.equal(call.params.p_reason, 'viewer_cannot_grant')
  })

  it('fails closed when server token is missing', async () => {
    const originalToken = process.env.AUDIT_SERVER_TOKEN
    delete process.env.AUDIT_SERVER_TOKEN

    try {
      const client = createMockRpcClient()
      const result = await logAuditEvent(
        { action: 'document.upload', outcome: 'allowed' },
        { supabaseClient: client, serverToken: '' } // empty token
      )

      assert.equal(result.status, 'error')
      if (result.status === 'error') {
        assert.equal(result.code, 'missing_token')
        assert.ok(result.message.includes('AUDIT_SERVER_TOKEN'))
      }
      assert.equal(client._rpcCalls.length, 0, 'must not invoke RPC when token is missing')
    } finally {
      if (originalToken !== undefined) {
        process.env.AUDIT_SERVER_TOKEN = originalToken
      }
    }
  })

  it('fails closed when action is invalid', async () => {
    const client = createMockRpcClient()
    const result = await logAuditEvent(
      { action: 'invalid.action' as any, outcome: 'allowed' },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.includes('Invalid audit action'))
    }
    assert.equal(client._rpcCalls.length, 0)
  })

  it('fails closed when outcome is invalid', async () => {
    const client = createMockRpcClient()
    const result = await logAuditEvent(
      { action: 'document.upload', outcome: 'invalid-outcome' as any },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.includes('Invalid audit outcome'))
    }
    assert.equal(client._rpcCalls.length, 0)
  })

  it('fails closed when documentId is not a valid UUID', async () => {
    const client = createMockRpcClient()
    const result = await logAuditEvent(
      { action: 'document.upload', outcome: 'allowed', documentId: 'not-a-uuid' },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.includes('documentId'))
    }
    assert.equal(client._rpcCalls.length, 0)
  })

  it('fails closed when targetUserId is not a valid UUID', async () => {
    const client = createMockRpcClient()
    const result = await logAuditEvent(
      { action: 'permission.grant', outcome: 'allowed', targetUserId: 'bad-user' },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'invalid_input')
      assert.ok(result.message.includes('targetUserId'))
    }
    assert.equal(client._rpcCalls.length, 0)
  })

  it('returns database_error when RPC returns an error', async () => {
    const client = createMockRpcClient({
      error: new Error('Forbidden: invalid server attestation token.'),
    })

    const result = await logAuditEvent(
      { action: 'document.upload', outcome: 'allowed' },
      { supabaseClient: client, serverToken: 'wrong-token' }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'database_error')
      assert.ok(result.message.includes('Forbidden'))
    }
  })

  it('returns database_error when RPC throws an exception', async () => {
    const client = createMockRpcClient({ throwError: true })

    const result = await logAuditEvent(
      { action: 'document.upload', outcome: 'allowed' },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(result.status, 'error')
    if (result.status === 'error') {
      assert.equal(result.code, 'database_error')
      assert.ok(result.message.includes('connection lost'))
    }
  })

  it('sanitizes storage_path before passing details to RPC', async () => {
    const client = createMockRpcClient()
    await logAuditEvent(
      {
        action: 'document.upload',
        outcome: 'allowed',
        documentId: VALID_DOC_ID,
        details: {
          storage_path: 'private/bucket/secret.pdf',
          name: 'safe-file.pdf',
        },
      },
      { supabaseClient: client, serverToken: TEST_TOKEN }
    )

    assert.equal(client._rpcCalls.length, 1)
    const passedDetails = client._rpcCalls[0].params.p_details
    assert.equal(passedDetails.storage_path, undefined)
    assert.equal(passedDetails.name, 'safe-file.pdf')
  })
})
