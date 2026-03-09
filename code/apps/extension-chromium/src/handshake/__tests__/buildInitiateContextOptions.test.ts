/**
 * Tests for buildInitiateContextOptions — shared payload builder for Initiate handshake.
 */

import { describe, it, expect } from 'vitest'
import { buildInitiateContextOptions } from '../buildInitiateContextOptions'

describe('buildInitiateContextOptions', () => {
  it('returns skipVaultContext and policy_selections', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: true,
      policySelections: { cloud_ai: true, internal_ai: false },
      selectedProfileItems: [],
      contextGraphText: '',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'inherit' },
    })
    expect(opts.skipVaultContext).toBe(true)
    expect(opts.policy_selections).toEqual({ cloud_ai: true, internal_ai: false })
    expect(opts.profile_items).toBeUndefined()
    expect(opts.context_blocks).toBeUndefined()
  })

  it('includes profile_items and profile_ids when profiles selected', async () => {
    const items = [
      { profile_id: 'prof-1', policy_mode: 'inherit' as const },
      { profile_id: 'prof-2', policy_mode: 'override' as const, policy: { cloud_ai: true, internal_ai: false } },
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

  it('includes context_blocks with policy_mode/policy when ad-hoc content present', async () => {
    const opts = await buildInitiateContextOptions({
      skipVaultContext: false,
      selectedProfileItems: [],
      contextGraphText: 'adhoc content',
      contextGraphType: 'text',
      adhocBlockPolicy: { policy_mode: 'override', policy: { cloud_ai: false, internal_ai: true } },
    })
    expect(opts.context_blocks).toBeDefined()
    expect(Array.isArray(opts.context_blocks)).toBe(true)
    expect((opts.context_blocks as any[]).length).toBe(1)
    const block = (opts.context_blocks as any[])[0]
    expect(block.content).toBe('adhoc content')
    expect(block.policy_mode).toBe('override')
    expect(block.policy).toEqual({ cloud_ai: false, internal_ai: true })
    expect(block.block_hash).toMatch(/^[a-f0-9]{64}$/)
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
