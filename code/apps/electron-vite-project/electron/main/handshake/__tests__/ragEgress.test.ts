/**
 * Roadmap item 0.13: one egress check before every model call of
 * `handshake:chatWithContextRag`. Locality comes from the provider instance;
 * a remote provider never receives a block whose governance denies cloud AI,
 * on any of the four paths (structured, selected document, hybrid structured,
 * semantic). A source guard keeps every model call in the handler behind the check.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getProvider, OllamaProvider, type AIProvider } from '../aiProviders'
import {
  assertRagEgressCleared,
  clearBlocksForModel,
  providerLocality,
  type RagEgressBlockRow,
  type RagEgressLookup,
} from '../ragEgress'
import type { HandshakeRecord } from '../types'

function mockRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: { email: 'a@test.com', wrdesk_user_id: 'u1', iss: 'iss', sub: 'sub' },
    acceptor: null,
    local_role: 'initiator',
    sharing_mode: null,
    reciprocal_allowed: true,
    tier_snapshot: {} as any,
    current_tier_signals: {} as any,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: { allowsCloudEscalation: true, allowsExport: false },
    external_processing: 'none',
    created_at: new Date().toISOString(),
    activated_at: null,
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
    p2p_endpoint: null,
    counterparty_p2p_token: null,
    local_public_key: null,
    local_private_key: null,
    counterparty_public_key: null,
    receiver_email: null,
    policy_selections: { ai_processing_mode: 'internal_and_cloud' },
    ...overrides,
  }
}

function governance(usage: { cloud_ai_allowed?: boolean; sensitive?: boolean }): string {
  return JSON.stringify({
    origin: 'remote_peer',
    content_type: 'plaintext',
    sensitivity: 'internal',
    contains_pii: false,
    contains_credentials: false,
    contains_signature_material: false,
    usage_policy: {
      searchable: true,
      local_ai_allowed: true,
      cloud_ai_allowed: true,
      auto_reply_allowed: false,
      export_allowed: false,
      transmit_to_peer_allowed: true,
      ...usage,
    },
    verification: { hash_present: true, signature_present: false, commitment_linked: true },
    provenance: { publisher_id: 'u1', sender_wrdesk_user_id: 'u1' },
  })
}

const row = (governance_json: string | null): RagEgressBlockRow => ({
  governance_json,
  type: 'plaintext',
  data_classification: 'public',
  scope_id: null,
  sender_wrdesk_user_id: 'u1',
  source: 'received',
})

/** blk-open allows cloud; blk-denied has cloud_ai_allowed:false; blk-sensitive has sensitive:true. */
function lookup(rowsById: Record<string, RagEgressBlockRow[]>, records: Record<string, HandshakeRecord> = { 'hs-1': mockRecord() }): RagEgressLookup {
  return {
    record: (id) => records[id] ?? null,
    rows: (ref) => rowsById[ref.block_id] ?? [],
  }
}

const standardLookup = lookup({
  'blk-open': [row(governance({ cloud_ai_allowed: true }))],
  'blk-denied': [row(governance({ cloud_ai_allowed: false }))],
  'blk-sensitive': [row(governance({ cloud_ai_allowed: true, sensitive: true }))],
})

const local: AIProvider = new OllamaProvider({})
const remotes: Array<[string, AIProvider]> = ['openai', 'anthropic', 'google', 'xai', 'cloudai'].map((id) => [
  id,
  getProvider({ provider: id } as any, () => 'test-key'),
])

describe('ragEgress — locality from the provider instance', () => {
  it('OllamaProvider is local', () => {
    expect(providerLocality(local)).toBe('local')
  })

  it.each(remotes)('%s is remote (including cloudai)', (_id, provider) => {
    expect(providerLocality(provider)).toBe('remote')
  })

  it('an unknown provider object is remote (deny unless local)', () => {
    const unknown: AIProvider = { id: 'ollama', generateEmbedding: async () => [], generateChat: async () => '' }
    expect(providerLocality(unknown)).toBe('remote')
  })
})

describe('ragEgress — a remote provider never receives a denied block', () => {
  const remote = remotes[4][1]

  it('structured path: denied and sensitive candidates are removed before the lookup', () => {
    const blocks = [
      { handshake_id: 'hs-1', block_id: 'blk-denied', block_hash: 'h1' },
      { handshake_id: 'hs-1', block_id: 'blk-open', block_hash: 'h2' },
      { handshake_id: 'hs-1', block_id: 'blk-sensitive', block_hash: 'h3' },
    ]
    const c = clearBlocksForModel(remote, blocks, standardLookup)
    expect(c.allowed.map((b) => b.block_id)).toEqual(['blk-open'])
    expect(c.excludedCount).toBe(2)
    expect(c.governanceNote).toMatch(/2 context block\(s\) were excluded/)
  })

  it('selected-document path: a denied document yields nothing to send', () => {
    const c = clearBlocksForModel(remote, [{ handshake_id: 'hs-1', block_id: 'blk-denied' }], standardLookup)
    expect(c.allowed).toHaveLength(0)
    expect(() => assertRagEgressCleared(c, [{ handshake_id: 'hs-1', block_id: 'blk-denied' }])).toThrow(/rag_egress_refused/)
  })

  it('selected-document path without a hash: one denying row of the block id denies it', () => {
    const l = lookup({ 'blk-mixed': [row(governance({ cloud_ai_allowed: true })), row(governance({ cloud_ai_allowed: false }))] })
    const c = clearBlocksForModel(remote, [{ handshake_id: 'hs-1', block_id: 'blk-mixed' }], l)
    expect(c.allowed).toHaveLength(0)
  })

  it('hybrid structured path: a denied source is not cleared', () => {
    const c = clearBlocksForModel(remote, [{ handshake_id: 'hs-1', block_id: 'blk-sensitive', source: 'received' }], standardLookup)
    expect(c.allowed).toHaveLength(0)
  })

  it('semantic path: only cleared blocks remain, and the assertion accepts exactly them', () => {
    const blocks = [
      { handshake_id: 'hs-1', block_id: 'blk-open', block_hash: 'h2', score: 0.9 },
      { handshake_id: 'hs-1', block_id: 'blk-denied', block_hash: 'h1', score: 0.8 },
    ]
    const c = clearBlocksForModel(remote, blocks, standardLookup)
    expect(c.allowed.map((b) => b.block_id)).toEqual(['blk-open'])
    expect(() => assertRagEgressCleared(c, c.allowed)).not.toThrow()
    expect(() => assertRagEgressCleared(c, blocks)).toThrow(/blk-denied/)
  })

  it('a block without a handshake record or without a visible row is excluded', () => {
    const c = clearBlocksForModel(
      remote,
      [
        { handshake_id: 'hs-unknown', block_id: 'blk-open' },
        { handshake_id: 'hs-1', block_id: 'blk-hidden' },
      ],
      standardLookup,
    )
    expect(c.allowed).toHaveLength(0)
  })

  it('legacy blocks without governance follow the handshake AI policy (local_only denies cloud)', () => {
    const l = lookup({ 'blk-legacy': [row(null)] }, { 'hs-1': mockRecord({ policy_selections: { ai_processing_mode: 'local_only' } }) })
    expect(clearBlocksForModel(remote, [{ handshake_id: 'hs-1', block_id: 'blk-legacy' }], l).allowed).toHaveLength(0)
  })
})

describe('ragEgress — a local provider is unchanged', () => {
  it('keeps every block and asserts nothing', () => {
    const blocks = [
      { handshake_id: 'hs-1', block_id: 'blk-denied' },
      { handshake_id: 'hs-1', block_id: 'blk-sensitive' },
    ]
    const c = clearBlocksForModel(local, blocks, standardLookup)
    expect(c.allowed).toHaveLength(2)
    expect(c.governanceNote).toBeNull()
    expect(() => assertRagEgressCleared(c, blocks)).not.toThrow()
  })
})

describe('ragEgress — source guard over handshake:chatWithContextRag', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const mainSource = readFileSync(join(here, '..', '..', '..', 'main.ts'), 'utf8')
  const start = mainSource.indexOf("'handshake:chatWithContextRag'")
  const end = mainSource.indexOf('ipcMain.handle(', start + 1)
  const handler = mainSource.slice(start, end)

  it('locates the handler', () => {
    expect(start).toBeGreaterThan(0)
    expect(handler.length).toBeGreaterThan(1000)
  })

  it('every model call sits in a try block that asserts the egress clearance first', () => {
    const calls = [...handler.matchAll(/runOllamaGenerateChatWithSandboxRouting\(/g)].map((m) => m.index ?? 0)
    expect(calls.length).toBeGreaterThanOrEqual(4)
    expect(handler.indexOf('clearBlocksForModel(')).toBeLessThan(calls[0])
    for (const idx of calls) {
      const tryStart = handler.lastIndexOf('try {', idx)
      expect(tryStart, `model call at handler offset ${idx}`).toBeGreaterThan(0)
      expect(handler.slice(tryStart, idx), `model call at handler offset ${idx}`).toMatch(/assertRagEgressCleared\(/)
    }
  })

  it('has no provider-name cloud list and no silent fallback scope', () => {
    expect(handler).not.toMatch(/\['openai', 'anthropic', 'google', 'xai'\]\.includes/)
    expect(handler).not.toMatch(/using fallback handshake/)
    expect(handler).toMatch(/context_selection_required/)
  })
})
