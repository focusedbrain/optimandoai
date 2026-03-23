/**
 * Handshake Refresh Tests
 *
 * Tests context block construction and the sendViaHandshakeRefresh flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock chrome.runtime
const mockSendMessage = vi.fn()
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null,
  },
})

// Mock crypto.subtle for SHA-256 (Node.js polyfill)
vi.stubGlobal('crypto', {
  ...globalThis.crypto,
  randomUUID: () => '00000000-0000-0000-0000-000000000000',
  subtle: {
    digest: async (_algo: string, data: ArrayBuffer) => {
      const { createHash } = await import('crypto')
      const hash = createHash('sha256')
      hash.update(Buffer.from(data))
      return hash.digest().buffer
    },
  },
})

import { buildContextBlocks, sendViaHandshakeRefresh } from '../handshakeRefresh'

describe('buildContextBlocks', () => {
  it('T8: constructs correct block from user message', async () => {
    const message = { text: 'Hello, world!', type: 'text' }
    const blocks = await buildContextBlocks(message)

    expect(blocks).toHaveLength(1)
    expect(blocks[0].block_id).toMatch(/^blk_/)
    expect(blocks[0].block_type).toBe('text')
    expect(blocks[0].content).toBe('Hello, world!')
    expect(blocks[0].version).toBe(1)
    expect(blocks[0].block_hash).toHaveLength(64)
    expect(blocks[0].block_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses SHA-256 for block hash', async () => {
    const blocks = await buildContextBlocks({ text: 'test' })
    // SHA-256 of "test" is well-known
    expect(blocks[0].block_hash).toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    )
  })

  it('defaults block_type to text', async () => {
    const blocks = await buildContextBlocks({ text: 'hello' })
    expect(blocks[0].block_type).toBe('text')
  })

  it('preserves scope_id when provided', async () => {
    const blocks = await buildContextBlocks({ text: 'hello', scope_id: 'scope-1' })
    expect(blocks[0].scope_id).toBe('scope-1')
  })
})

describe('sendViaHandshakeRefresh', () => {
  beforeEach(() => {
    mockSendMessage.mockReset()
  })

  it('returns success when RPC succeeds', async () => {
    mockSendMessage.mockImplementation((_msg: any, cb: (res: any) => void) => {
      cb({ handshake_id: 'hs-001', capsule_hash: 'abc123', status: 'ACTIVE' })
    })

    const result = await sendViaHandshakeRefresh('hs-001', { text: 'Hello' }, 'acct-1')

    expect(result.success).toBe(true)
    expect(result.handshake_id).toBe('hs-001')
    expect(result.capsule_hash).toBe('abc123')
  })

  it('returns error when RPC fails', async () => {
    mockSendMessage.mockImplementation((_msg: any, cb: (res: any) => void) => {
      cb({ error: 'Handshake not found' })
    })

    const result = await sendViaHandshakeRefresh('hs-bad', { text: 'Hello' }, 'acct-1')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Handshake not found')
  })

  it('sends context blocks via handshake.refresh RPC', async () => {
    mockSendMessage.mockImplementation((_msg: any, cb: (res: any) => void) => {
      cb({ handshake_id: 'hs-001', capsule_hash: 'def456', status: 'ACTIVE' })
    })

    await sendViaHandshakeRefresh('hs-001', { text: 'Test message' }, 'acct-1')

    const call = mockSendMessage.mock.calls[0][0]
    expect(call.method).toBe('handshake.refresh')
    expect(call.params.handshake_id).toBe('hs-001')
    expect(call.params.context_blocks).toHaveLength(1)
    expect(call.params.context_blocks[0].content).toBe('Test message')
  })
})
