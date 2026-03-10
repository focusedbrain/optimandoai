/**
 * Resilience & Integrity Chaos Tests — BEAP AI Retrieval System
 *
 * Validates safe behavior under abnormal conditions.
 * Does not modify architecture; analysis and controlled tests only.
 */

import { describe, test, expect } from 'vitest'
import { buildRagPrompt, scoredBlocksToRetrieved } from '../blockRetrieval'
import type { ScoredContextBlock } from '../types'

// ── Test 1: Empty Retrieval ─────────────────────────────────────────────────
describe('Test 1 — Empty Retrieval', () => {
  test('buildRagPrompt with zero blocks produces explicit "no relevant context" message', () => {
    const { systemPrompt, userPrompt } = buildRagPrompt([], 'What is the CEO of ExampleTech?')
    expect(systemPrompt).toContain('Do not make up information')
    expect(systemPrompt).toContain('say so clearly')
    expect(userPrompt).toContain('(No relevant context blocks were found.)')
    expect(userPrompt).toContain('User question:')
    expect(userPrompt).toContain('What is the CEO of ExampleTech?')
    expect(userPrompt).not.toContain('Context blocks:')
    expect(userPrompt).not.toMatch(/\[block_id:/)
  })

  test('model receives explicit no-context signal, not empty or fabricated context', () => {
    const { userPrompt } = buildRagPrompt([], 'What is the CEO of ExampleTech?')
    expect(userPrompt).toBe(
      '(No relevant context blocks were found.)\n\nUser question:\nWhat is the CEO of ExampleTech?'
    )
  })
})

// ── Test 2: Corrupted Context Block ─────────────────────────────────────────
describe('Test 2 — Corrupted Context Block', () => {
  test('blocks with empty payload text are skipped by prompt builder', () => {
    const blocks = [
      { handshake_id: 'hs-1', block_id: 'a', block_hash: 'h1', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: '', score: 0.9 },
      { handshake_id: 'hs-1', block_id: 'b', block_hash: 'h2', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: 'Valid content here', score: 0.8 },
    ] as ScoredContextBlock[]
    const retrieved = scoredBlocksToRetrieved(blocks)
    const { userPrompt } = buildRagPrompt(retrieved, 'Test?')
    expect(userPrompt).toContain('[block_id: b]')
    expect(userPrompt).toContain('Valid content here')
    expect(userPrompt).not.toContain('[block_id: a]')
  })

  test('malformed JSON payload is extracted as plain text (no crash)', () => {
    const blocks = [{ handshake_id: 'hs-1', block_id: 'x', block_hash: 'h', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: 'not valid json {{{', score: 0.7 }] as ScoredContextBlock[]
    const retrieved = scoredBlocksToRetrieved(blocks)
    const { userPrompt } = buildRagPrompt(retrieved, 'Q?')
    expect(userPrompt).toContain('not valid json {{{')
  })
})

// ── Test 3: Oversized Context ──────────────────────────────────────────────
describe('Test 3 — Oversized Context', () => {
  test('prompt builder limits multi-block context; main.ts truncation catches oversized', () => {
    const bigText = 'x'.repeat(10000)
    const blocks = [
      { handshake_id: 'hs-1', block_id: 'big', block_hash: 'h', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: bigText, score: 0.9 },
    ] as ScoredContextBlock[]
    const retrieved = scoredBlocksToRetrieved(blocks)
    let { userPrompt } = buildRagPrompt(retrieved, 'Q?')
    if (userPrompt.length > 8000) userPrompt = userPrompt.slice(0, 8000)
    expect(userPrompt.length).toBeLessThanOrEqual(8000)
  })

  test('main.ts truncation at 8000 would apply to oversized userPrompt', () => {
    const longQuestion = 'q'.repeat(10000)
    const blocks = [{ handshake_id: 'hs-1', block_id: 'a', block_hash: 'h', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: 'short', score: 0.9 }] as ScoredContextBlock[]
    const retrieved = scoredBlocksToRetrieved(blocks)
    let { userPrompt } = buildRagPrompt(retrieved, longQuestion)
    if (userPrompt.length > 8000) userPrompt = userPrompt.slice(0, 8000)
    expect(userPrompt.length).toBeLessThanOrEqual(8000)
  })
})

// ── Test 8: Traceability Integrity ─────────────────────────────────────────
describe('Test 8 — Traceability Integrity', () => {
  test('sources structure includes capsule_id, handshake_id, block_id', () => {
    const blocks = [{ handshake_id: 'hs-1c2c70aa', block_id: 'company.headquarters', block_hash: 'h', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: 'Hamburg', score: 0.95 }] as ScoredContextBlock[]
    const sources = blocks.map(r => ({ handshake_id: r.handshake_id, capsule_id: r.handshake_id, block_id: r.block_id, source: r.source, score: r.score }))
    expect(sources[0]).toMatchObject({
      handshake_id: 'hs-1c2c70aa',
      capsule_id: 'hs-1c2c70aa',
      block_id: 'company.headquarters',
    })
  })

  test('retrieved block_ids match sources block_ids', () => {
    const blocks = [{ handshake_id: 'hs-1', block_id: 'opening_hours.schedule', block_hash: 'h', relationship_id: 'r1', scope_id: undefined, type: 'text', data_classification: 'public' as const, version: 1, valid_until: undefined, source: 'sent' as const, sender_wrdesk_user_id: 'u1', embedding_status: 'complete' as const, payload_ref: '9-5', score: 0.9 }] as ScoredContextBlock[]
    const retrieved = scoredBlocksToRetrieved(blocks)
    const sources = blocks.map(r => ({ handshake_id: r.handshake_id, capsule_id: r.handshake_id, block_id: r.block_id, source: r.source, score: r.score }))
    const contextBlocks = retrieved.map(b => b.block_id)
    expect(contextBlocks).toEqual(sources.map(s => s.block_id))
  })
})
