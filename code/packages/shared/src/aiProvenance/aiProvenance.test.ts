import { describe, expect, it } from 'vitest'
import { createProvenance } from './generate'
import {
  markEditorialResponsible,
  markHumanEdited,
  serializeForHtmlMeta,
  serializeForMime,
  shouldApplyMachineMarking,
  shouldApplyVisibleSendLabel,
  withVisibleAiLabel,
  decodeProvenancePayload,
} from './index'

describe('aiProvenance (Art. 50 Layer A core)', () => {
  it('createProvenance fills defaults and stable hash', () => {
    const p = createProvenance('hello world', { model_id: 'llama3', provider: 'local' })
    expect(p.synthetic).toBe(true)
    expect(p.modality).toBe('text')
    expect(p.marking_scheme).toBe('optirando-prov/1')
    expect(p.origin).toBe('ai')
    expect(p.human_edited).toBe(false)
    expect(p.editorial_responsible).toBe(false)
    expect(p.content_sha256).toHaveLength(64)
    expect(p.model_id).toBe('llama3')
    const p2 = createProvenance('hello world', { model_id: 'llama3', provider: 'local' })
    expect(p2.content_sha256).toBe(p.content_sha256)
  })

  it('serializeForMime / decode round-trip', () => {
    const p = createProvenance('body', { model_id: 'm', provider: 'cloud:openai' })
    const headers = serializeForMime(p)
    expect(headers['X-AI-Generated']).toBe('true')
    expect(headers['X-AI-Provenance']).toBeTruthy()
    const back = decodeProvenancePayload(headers['X-AI-Provenance']!)
    expect(back?.content_sha256).toBe(p.content_sha256)
    expect(back?.provider).toBe('cloud:openai')
  })

  it('serializeForHtmlMeta includes meta tags', () => {
    const p = createProvenance('x', { model_id: 'm', provider: 'host-ai' })
    const html = serializeForHtmlMeta(p)
    expect(html).toContain('name="ai-generated"')
    expect(html).toContain('name="ai-provenance"')
  })

  it('human edit → mixed; editorial responsibility toggles visible label', () => {
    const p = createProvenance('draft', { model_id: 'm', provider: 'local' })
    const edited = markHumanEdited(p, 'draft edited')
    expect(edited.origin).toBe('mixed')
    expect(edited.human_edited).toBe(true)
    expect(edited.content_sha256).not.toBe(p.content_sha256)
    expect(shouldApplyMachineMarking(edited)).toBe(true)
    expect(shouldApplyVisibleSendLabel(edited)).toBe(true)
    const ed = markEditorialResponsible(edited)
    expect(ed.editorial_responsible).toBe(true)
    expect(shouldApplyVisibleSendLabel(ed)).toBe(false)
    expect(shouldApplyMachineMarking(ed)).toBe(true)
  })

  it('withVisibleAiLabel prefixes once', () => {
    expect(withVisibleAiLabel('hi')).toBe('[AI-generated]\nhi')
    expect(withVisibleAiLabel('[AI-generated]\nhi')).toBe('[AI-generated]\nhi')
  })
})
