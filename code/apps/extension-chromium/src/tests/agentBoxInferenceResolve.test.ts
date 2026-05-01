import { describe, it, expect } from 'vitest'
import { resolveAgentBoxModelIds, resolveAgentBoxInference } from '../services/processFlow'

describe('resolveAgentBoxModelIds', () => {
  it('fixed agent model wins over WR Chat and user selected', () => {
    const r = resolveAgentBoxModelIds({
      agentBoxProvider: 'openai',
      agentBoxModel: 'gpt-4o',
      agentBoxUserSelectedInferenceModel: 'llama2',
      wrchatModelId: 'mistral',
      defaultModelId: 'tiny',
    })
    expect(r.modelSource).toBe('agent_fixed')
    expect(r.resolvedModelId).toBe('gpt-4o')
  })

  it('uses user-selected box model when no fixed model', () => {
    const r = resolveAgentBoxModelIds({
      agentBoxProvider: '',
      agentBoxModel: '',
      agentBoxUserSelectedInferenceModel: 'phi3',
      wrchatModelId: 'mistral',
      defaultModelId: 'tiny',
    })
    expect(r.modelSource).toBe('agent_user_selected')
    expect(r.resolvedModelId).toBe('phi3')
  })

  it('uses WR Chat when no fixed or user model', () => {
    const r = resolveAgentBoxModelIds({
      agentBoxProvider: '',
      agentBoxModel: '',
      agentBoxUserSelectedInferenceModel: '',
      wrchatModelId: 'mistral',
      defaultModelId: 'tiny',
    })
    expect(r.modelSource).toBe('wrchat_inherited')
    expect(r.resolvedModelId).toBe('mistral')
  })

  it('uses default only when nothing else exists', () => {
    const r = resolveAgentBoxModelIds({
      agentBoxProvider: '',
      agentBoxModel: '',
      wrchatModelId: '',
      defaultModelId: 'tiny',
    })
    expect(r.modelSource).toBe('default')
    expect(r.resolvedModelId).toBe('tiny')
  })
})

describe('resolveAgentBoxInference', () => {
  it('buildLlm-ready brain uses fixed cloud model', () => {
    const inf = resolveAgentBoxInference({
      agentBoxProvider: 'OpenAI',
      agentBoxModel: 'gpt-4o-mini',
      wrchatModelId: 'mistral',
      defaultModelId: 'fallback',
    })
    expect(inf.brain.ok).toBe(true)
    if (inf.brain.ok) {
      expect(inf.brain.isLocal).toBe(false)
      expect(inf.brain.model).toContain('gpt')
    }
  })

  it('falls back to wrchat in brain when inherit chain', () => {
    const inf = resolveAgentBoxInference({
      wrchatModelId: 'mistral-7b',
      defaultModelId: 'z',
    })
    expect(inf.modelSource).toBe('wrchat_inherited')
    expect(inf.brain.ok).toBe(true)
    if (inf.brain.ok) expect(inf.brain.model).toBe('mistral-7b')
  })
})
