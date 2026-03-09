/**
 * Tests for buildInitiateContextOptions — shared payload builder for Initiate handshake.
 */

import { describe, it, expect } from 'vitest'
import { buildInitiateContextOptions } from '../buildInitiateContextOptions'

describe('buildInitiateContextOptions', () => {
  it('returns skipVaultContext and policy_selections in new enum format', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: true,
      policySelections: { cloud_ai: true, internal_ai: false },
      selectedProfileItems: [],
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.skipVaultContext).toBe(true)
    expect(opts.policy_selections).toEqual({ ai_processing_mode: 'internal_and_cloud' })
    expect(opts.profile_items).toBeUndefined()
    expect(opts.context_blocks).toBeUndefined()
  })

  it('returns policy_selections in new format when given new-format input', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      policySelections: { ai_processing_mode: 'local_only' },
      selectedProfileItems: [],
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.policy_selections).toEqual({ ai_processing_mode: 'local_only' })
  })

  it('defaults policy_selections to local_only when policySelections is undefined', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.policy_selections).toEqual({ ai_processing_mode: 'local_only' })
  })

  it('includes profile_items and profile_ids when profiles selected', async () => {
    const items = [
      { profile_id: 'prof-1', policy_mode: 'inherit' as const },
      { profile_id: 'prof-2', policy_mode: 'override' as const, policy: { ai_processing_mode: 'internal_and_cloud' as const } },
    ]
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: items,
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.profile_ids).toEqual(['prof-1', 'prof-2'])
    expect(opts.profile_items).toEqual(items)
  })

  it('profile items with inherit carry no policy override', async () => {
    const items = [{ profile_id: 'p1', policy_mode: 'inherit' as const }]
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: items,
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect((opts.profile_items as any[])[0].policy_mode).toBe('inherit')
    expect((opts.profile_items as any[])[0].policy).toBeUndefined()
  })

  it('profile items with override carry ai_processing_mode policy', async () => {
    const items = [
      { profile_id: 'p2', policy_mode: 'override' as const, policy: { ai_processing_mode: 'none' as const } },
    ]
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: items,
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect((opts.profile_items as any[])[0].policy).toEqual({ ai_processing_mode: 'none' })
  })

  it('includes context_blocks with policy_mode/policy when ad-hoc content present (override)', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      contextGraphText: 'adhoc content',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'override', policy: { ai_processing_mode: 'internal_and_cloud' } },
    })
    expect(opts.context_blocks).toBeDefined()
    expect(Array.isArray(opts.context_blocks)).toBe(true)
    expect((opts.context_blocks as any[]).length).toBe(1)
    const block = (opts.context_blocks as any[])[0]
    expect(block.content).toBe('adhoc content')
    expect(block.policy_mode).toBe('override')
    expect(block.policy).toEqual({ ai_processing_mode: 'internal_and_cloud' })
    expect(block.block_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('ad-hoc block with inherit policy carries no policy object', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      contextGraphText: 'some context',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    const block = (opts.context_blocks as any[])[0]
    expect(block.policy_mode).toBe('inherit')
    expect(block.policy).toBeUndefined()
  })

  it('combines messageText and contextGraphText', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      messageText: 'personal note',
      contextGraphText: 'context data',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect((opts.context_blocks as any[])[0].content).toBe('personal note\n\ncontext data')
  })

  it('legacy: no profile_items or context_blocks when empty', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.profile_ids).toBeUndefined()
    expect(opts.profile_items).toBeUndefined()
    expect(opts.context_blocks).toBeUndefined()
  })
})

