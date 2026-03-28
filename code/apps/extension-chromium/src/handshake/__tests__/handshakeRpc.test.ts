/**
 * Handshake RPC Client Tests
 *
 * Tests the handshake RPC client layer that sends messages
 * through chrome.runtime.sendMessage → background → WebSocket → Electron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../beap-messages/services/x25519KeyAgreement', () => ({
  getDeviceX25519PublicKey: vi.fn().mockResolvedValue('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
}))

vi.mock('../../beap-messages/services/beapCrypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../beap-messages/services/beapCrypto')>()
  return {
    ...actual,
    pqKemSupportedAsync: vi.fn().mockResolvedValue(false),
  }
})

// Mock chrome.runtime.sendMessage
const mockSendMessage = vi.fn()
const mockChrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null as any,
  },
}

vi.stubGlobal('chrome', mockChrome)

import {
  listHandshakes,
  getHandshake,
  initiateHandshake,
  acceptHandshake,
  refreshHandshake,
  revokeHandshake,
  sendBeapViaP2P,
} from '../handshakeRpc'
import type { HandshakeRecord } from '../rpcTypes'

function mockRpcResponse(response: any) {
  mockSendMessage.mockImplementation((_msg: any, cb: (res: any) => void) => {
    cb(response)
  })
}

function mockRpcError(errorMsg: string) {
  mockSendMessage.mockImplementation((_msg: any, cb: (res: any) => void) => {
    cb({ error: errorMsg })
  })
}

const MOCK_RECORD: any = {
  handshake_id: 'hs-001',
  state: 'ACTIVE',
  local_role: 'initiator',
  relationship_id: 'rel-001',
  sharing_mode: 'reciprocal',
  created_at: '2025-01-01T00:00:00Z',
  activated_at: '2025-01-02T00:00:00Z',
  initiator: { email: 'me@test.com', wrdesk_user_id: 'u-me' },
  acceptor: { email: 'them@test.com', wrdesk_user_id: 'u-them' },
}

describe('listHandshakes', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('T1: returns backend data with active filter', async () => {
    mockRpcResponse({
      type: 'handshake-list',
      records: [MOCK_RECORD],
    })

    const result = await listHandshakes('active')

    expect(result).toHaveLength(1)
    expect(result[0].handshake_id).toBe('hs-001')
    expect(result[0].counterparty_email).toBe('them@test.com')
    expect(result[0].state).toBe('ACTIVE')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.type).toBe('VAULT_RPC')
    expect(call.method).toBe('handshake.list')
  })

  it('T2: returns pending handshakes only', async () => {
    const pendingRecord = { ...MOCK_RECORD, state: 'PENDING_ACCEPT' }
    mockRpcResponse({ type: 'handshake-list', records: [pendingRecord] })

    const result = await listHandshakes('pending')

    expect(result).toHaveLength(1)
    expect(result[0].state).toBe('PENDING_ACCEPT')
  })

  it('returns empty array when no records', async () => {
    mockRpcResponse({ type: 'handshake-list', records: [] })

    const result = await listHandshakes('all')
    expect(result).toEqual([])
  })

  it('rejects on RPC error', async () => {
    mockRpcError('Not connected to Electron app')

    await expect(listHandshakes('all')).rejects.toThrow('Not connected to Electron app')
  })
})

describe('RecipientHandshakeSelect integration', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('T3: active handshakes filter to ACTIVE state', async () => {
    const records = [
      { ...MOCK_RECORD, state: 'ACTIVE' },
      { ...MOCK_RECORD, handshake_id: 'hs-002', state: 'PENDING_ACCEPT' },
      { ...MOCK_RECORD, handshake_id: 'hs-003', state: 'REVOKED' },
    ]
    mockRpcResponse({ type: 'handshake-list', records })

    const result = await listHandshakes('all')
    const activeOnly = result.filter((h) => h.state === 'ACTIVE')

    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0].handshake_id).toBe('hs-001')
  })

  it('T4: select handshake populates builder with handshake_id', async () => {
    mockRpcResponse({ type: 'handshake-list', records: [MOCK_RECORD] })

    const result = await listHandshakes('active')
    const selected = result[0]

    expect(selected.handshake_id).toBe('hs-001')
    expect(selected.counterparty_email).toBe('them@test.com')
    expect(selected.counterparty_user_id).toBe('u-them')
  })

  it('T5: peer keys flow from backend through normalizeRecord to HandshakeRecord', async () => {
    const recordWithKeys = {
      ...MOCK_RECORD,
      state: 'ACTIVE',
      peer_x25519_public_key_b64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      peer_mlkem768_public_key_b64: 'dGVzdC1tbC1rZW0tNzY4LXB1YmxpYy1rZXktYmFzZTY0',
    }
    mockRpcResponse({ type: 'handshake-list', records: [recordWithKeys] })

    const result = await listHandshakes('active')
    const selected = result[0]

    expect(selected.peerX25519PublicKey).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    expect(selected.peerPQPublicKey).toBe('dGVzdC1tbC1rZW0tNzY4LXB1YmxpYy1rZXktYmFzZTY0')
  })
})

describe('acceptHandshake', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('T5: calls handshake.accept RPC with correct params', async () => {
    mockRpcResponse({ handshake_id: 'hs-001', status: 'ACTIVE' })

    const result = await acceptHandshake('hs-001', 'reciprocal', 'acct-1')

    expect(result.handshake_id).toBe('hs-001')
    expect(result.status).toBe('ACTIVE')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.method).toBe('handshake.accept')
    expect(call.params.handshake_id).toBe('hs-001')
    expect(call.params.sharing_mode).toBe('reciprocal')
    expect(call.params.fromAccountId).toBe('acct-1')
  })

  it('T6: accept passes sharing_mode from user selection', async () => {
    mockRpcResponse({ handshake_id: 'hs-001', status: 'ACTIVE' })

    await acceptHandshake('hs-001', 'receive-only', 'acct-1')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.params.sharing_mode).toBe('receive-only')
  })
})

describe('refreshHandshake', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('T7: calls handshake.refresh RPC with context_block_proofs', async () => {
    mockRpcResponse({ handshake_id: 'hs-001', capsule_hash: 'abc123', status: 'ACTIVE' })

    const proofs = [{ block_id: 'blk-001', block_hash: 'deadbeef' }]

    const result = await refreshHandshake('hs-001', 'acct-1', proofs)

    expect(result.handshake_id).toBe('hs-001')
    expect(result.capsule_hash).toBe('abc123')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.method).toBe('handshake.refresh')
    expect(call.params.handshake_id).toBe('hs-001')
    expect(call.params.context_block_proofs).toEqual(proofs)
  })
})

describe('initiateHandshake', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('T9: calls handshake.initiate RPC with correct params', async () => {
    mockRpcResponse({ handshake_id: 'hs-new', status: 'PENDING_ACCEPT' })

    const result = await initiateHandshake('u-receiver', 'receiver@test.com', 'acct-1')

    expect(result.handshake_id).toBe('hs-new')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.method).toBe('handshake.initiate')
    expect(call.params.receiverEmail).toBe('receiver@test.com')
    expect(call.params.fromAccountId).toBe('acct-1')
  })

  it('initiate passes profile_items, context_blocks, policy_selections when provided', async () => {
    mockRpcResponse({ handshake_id: 'hs-new', status: 'PENDING_ACCEPT' })

    await initiateHandshake('u-receiver', 'receiver@test.com', 'acct-1', {
      profile_items: [
        { profile_id: 'prof-1', policy_mode: 'inherit' },
        { profile_id: 'prof-2', policy_mode: 'override', policy: { cloud_ai: true, internal_ai: false } },
      ],
      context_blocks: [{
        block_id: 'ctx-msg-pending',
        block_hash: 'a'.repeat(64),
        type: 'plaintext',
        content: 'adhoc',
        scope_id: 'initiator',
        policy_mode: 'override',
        policy: { cloud_ai: false, internal_ai: true },
      }],
      policy_selections: { cloud_ai: false, internal_ai: true },
    })

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.params.profile_items).toHaveLength(2)
    expect(call.params.profile_items[0]).toEqual({ profile_id: 'prof-1', policy_mode: 'inherit' })
    expect(call.params.profile_items[1].policy_mode).toBe('override')
    expect(call.params.profile_items[1].policy).toEqual({ cloud_ai: true, internal_ai: false })
    expect(call.params.context_blocks).toHaveLength(1)
    expect(call.params.context_blocks[0].policy_mode).toBe('override')
    expect(call.params.context_blocks[0].policy).toEqual({ cloud_ai: false, internal_ai: true })
    expect(call.params.policy_selections).toEqual({ cloud_ai: false, internal_ai: true })
  })
})

describe('revokeHandshake', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('calls handshake.initiateRevocation RPC', async () => {
    mockRpcResponse({ status: 'REVOKED' })

    const result = await revokeHandshake('hs-001')

    expect(result.status).toBe('REVOKED')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.method).toBe('handshake.initiateRevocation')
  })
})

describe('sendBeapViaP2P', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
    mockChrome.runtime.lastError = null
  })

  it('resolves when success:false and error set (BACKOFF_WAIT), preserving last_queue_error', async () => {
    mockRpcResponse({
      success: false,
      error: 'Delivery is waiting before retry — try again shortly',
      queued: true,
      code: 'BACKOFF_WAIT',
      last_queue_error: 'P2P delivery failed: HTTP 500',
      retry_count: 1,
      max_retries: 10,
      remaining_ms: 4200,
    })
    const r = await sendBeapViaP2P('hs-1', '{}')
    expect(r.success).toBe(false)
    expect(r.code).toBe('BACKOFF_WAIT')
    expect(r.last_queue_error).toBe('P2P delivery failed: HTTP 500')
    expect(r.remaining_ms).toBe(4200)
    expect(mockSendMessage.mock.calls[0][0].method).toBe('handshake.sendBeapViaP2P')
  })
})
