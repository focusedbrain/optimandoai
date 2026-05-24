/**
 * P2.6 — inboxAiProviderSetting unit tests.
 *
 * Tests:
 * - defaultProviderKindForTier: free vs paid tiers
 * - normalizeAiProviderSetting: validation of stored values
 * - resolveSecurityAiProvider:
 *   - 'default' + free tier → calls ollama resolver
 *   - 'default' + paid tier → calls cloud resolver
 *   - 'local_ollama' override → always calls ollama (ignores tier)
 *   - 'cloud' override → always calls cloud (ignores tier)
 *   - 'cloud' with model override → overrides model in returned context
 *   - unavailable provider → returns null
 *   - switching provider mid-session takes effect on next call (stateless)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  defaultProviderKindForTier,
  normalizeAiProviderSetting,
  resolveSecurityAiProvider,
  type AiProviderSetting,
  type SecurityProviderResolvers,
} from '../inboxAiProviderSetting'
import type { ResolvedLlmContext } from '../../inboxLlmChat'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ollamaCtx: ResolvedLlmContext = { model: 'gemma3:12b', provider: 'ollama' }
const cloudCtx: ResolvedLlmContext = { model: 'gpt-4o', provider: 'openai' }

function makeResolvers(
  opts: Partial<{ ollama: ResolvedLlmContext | null; cloud: ResolvedLlmContext | null }> = {},
): SecurityProviderResolvers {
  return {
    ollama: vi.fn().mockResolvedValue('ollama' in opts ? opts.ollama : ollamaCtx),
    cloud: vi.fn().mockResolvedValue('cloud' in opts ? opts.cloud : cloudCtx),
  }
}

// ── defaultProviderKindForTier ────────────────────────────────────────────────

describe('defaultProviderKindForTier', () => {
  it('returns local_ollama for free tier', () => {
    expect(defaultProviderKindForTier('free')).toBe('local_ollama')
  })

  it('returns local_ollama for unknown tier', () => {
    expect(defaultProviderKindForTier('unknown')).toBe('local_ollama')
  })

  it('returns local_ollama for empty string', () => {
    expect(defaultProviderKindForTier('')).toBe('local_ollama')
  })

  it('returns cloud for pro tier', () => {
    expect(defaultProviderKindForTier('pro')).toBe('cloud')
  })

  it('returns cloud for private tier', () => {
    expect(defaultProviderKindForTier('private')).toBe('cloud')
  })

  it('returns cloud for private_lifetime tier', () => {
    expect(defaultProviderKindForTier('private_lifetime')).toBe('cloud')
  })

  it('returns cloud for publisher tier', () => {
    expect(defaultProviderKindForTier('publisher')).toBe('cloud')
  })

  it('returns cloud for publisher_lifetime tier', () => {
    expect(defaultProviderKindForTier('publisher_lifetime')).toBe('cloud')
  })

  it('returns cloud for enterprise tier', () => {
    expect(defaultProviderKindForTier('enterprise')).toBe('cloud')
  })
})

// ── normalizeAiProviderSetting ────────────────────────────────────────────────

describe('normalizeAiProviderSetting', () => {
  it('returns default for null', () => {
    expect(normalizeAiProviderSetting(null)).toEqual({ kind: 'default' })
  })

  it('returns default for undefined', () => {
    expect(normalizeAiProviderSetting(undefined)).toEqual({ kind: 'default' })
  })

  it('returns default for invalid kind', () => {
    expect(normalizeAiProviderSetting({ kind: 'banana' })).toEqual({ kind: 'default' })
  })

  it('returns default for string input', () => {
    expect(normalizeAiProviderSetting('local_ollama')).toEqual({ kind: 'default' })
  })

  it('parses local_ollama', () => {
    expect(normalizeAiProviderSetting({ kind: 'local_ollama' })).toEqual({ kind: 'local_ollama' })
  })

  it('parses default', () => {
    expect(normalizeAiProviderSetting({ kind: 'default' })).toEqual({ kind: 'default' })
  })

  it('parses cloud with no sub-fields', () => {
    expect(normalizeAiProviderSetting({ kind: 'cloud' })).toEqual({ kind: 'cloud' })
  })

  it('parses cloud with model', () => {
    expect(normalizeAiProviderSetting({ kind: 'cloud', model: 'gpt-4o' })).toEqual({
      kind: 'cloud',
      model: 'gpt-4o',
    })
  })

  it('parses cloud with model and endpoint', () => {
    expect(
      normalizeAiProviderSetting({ kind: 'cloud', model: 'gpt-4o', endpoint: 'https://my.proxy/v1' }),
    ).toEqual({ kind: 'cloud', model: 'gpt-4o', endpoint: 'https://my.proxy/v1' })
  })

  it('strips blank model string', () => {
    expect(normalizeAiProviderSetting({ kind: 'cloud', model: '   ' })).toEqual({ kind: 'cloud' })
  })
})

// ── resolveSecurityAiProvider ─────────────────────────────────────────────────

describe('resolveSecurityAiProvider', () => {
  it('default + free tier → resolves to ollama', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'default' }, 'free', r)
    expect(result).toEqual(ollamaCtx)
    expect(r.ollama).toHaveBeenCalled()
    expect(r.cloud).not.toHaveBeenCalled()
  })

  it('default + pro tier → resolves to cloud', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'default' }, 'pro', r)
    expect(result).toEqual(cloudCtx)
    expect(r.cloud).toHaveBeenCalled()
    expect(r.ollama).not.toHaveBeenCalled()
  })

  it('default + unknown tier → resolves to ollama', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'default' }, 'unknown', r)
    expect(result).toEqual(ollamaCtx)
    expect(r.ollama).toHaveBeenCalled()
  })

  it('local_ollama override + paid tier → still resolves to ollama', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'local_ollama' }, 'enterprise', r)
    expect(result).toEqual(ollamaCtx)
    expect(r.ollama).toHaveBeenCalled()
    expect(r.cloud).not.toHaveBeenCalled()
  })

  it('cloud override + free tier → still resolves to cloud', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'cloud' }, 'free', r)
    expect(result).toEqual(cloudCtx)
    expect(r.cloud).toHaveBeenCalled()
    expect(r.ollama).not.toHaveBeenCalled()
  })

  it('cloud with model override → overrides model in context', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider(
      { kind: 'cloud', model: 'claude-3-5-sonnet-20241022' },
      'free',
      r,
    )
    expect(result?.model).toBe('claude-3-5-sonnet-20241022')
    expect(result?.provider).toBe('openai')
  })

  it('cloud with no model override → uses context model', async () => {
    const r = makeResolvers()
    const result = await resolveSecurityAiProvider({ kind: 'cloud' }, 'free', r)
    expect(result?.model).toBe('gpt-4o')
  })

  it('ollama unavailable → returns null', async () => {
    const r = makeResolvers({ ollama: null })
    const result = await resolveSecurityAiProvider({ kind: 'local_ollama' }, 'free', r)
    expect(result).toBeNull()
  })

  it('cloud unavailable → returns null', async () => {
    const r = makeResolvers({ cloud: null })
    const result = await resolveSecurityAiProvider({ kind: 'cloud' }, 'pro', r)
    expect(result).toBeNull()
  })

  it('default + paid tier, cloud unavailable → returns null (no failover)', async () => {
    const r = makeResolvers({ cloud: null })
    const result = await resolveSecurityAiProvider({ kind: 'default' }, 'pro', r)
    expect(result).toBeNull()
    expect(r.ollama).not.toHaveBeenCalled()
  })

  it('switching provider mid-session takes effect on next call (stateless resolver)', async () => {
    const r1 = makeResolvers()
    const r2 = makeResolvers()

    // First call: local_ollama
    const first = await resolveSecurityAiProvider({ kind: 'local_ollama' }, 'pro', r1)
    expect(first?.provider).toBe('ollama')

    // Second call with different setting: cloud
    const second = await resolveSecurityAiProvider({ kind: 'cloud' }, 'pro', r2)
    expect(second?.provider).toBe('openai')

    // First resolvers unchanged
    expect(r1.cloud).not.toHaveBeenCalled()
  })
})
