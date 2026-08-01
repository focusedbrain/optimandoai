/**
 * WP9 — lightweight Art. 50 verification checks (headless).
 */
import { describe, expect, it } from 'vitest'
import {
  AI_DISCLOSURE_ACK_KEY_EXTENSION,
  AI_DISCLOSURE_ACK_KEY_MAIN,
  AI_VISIBLE_LABEL_LINE,
  buildClipboardHtml,
  createProvenance,
  markEditorialResponsible,
  markHumanEdited,
  serializeForHtmlMeta,
  serializeForMime,
  shouldApplyMachineMarking,
  shouldApplyVisibleSendLabel,
  withVisibleAiLabel,
  decodeProvenancePayload,
  isAiProvenance,
} from './index'

describe('WP9 Art. 50 verification', () => {
  it('(a) generation point emits provenance with optirando-prov/1', () => {
    const p = createProvenance('model output text', {
      model_id: 'llama3',
      provider: 'local',
    })
    expect(isAiProvenance(p)).toBe(true)
    expect(p.synthetic).toBe(true)
    expect(p.marking_scheme).toBe('optirando-prov/1')
    expect(p.content_sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('(b) MIME headers present for AI-origin send', () => {
    const p = createProvenance('draft body', { model_id: 'm', provider: 'local' })
    expect(shouldApplyMachineMarking(p)).toBe(true)
    const headers = serializeForMime(p)
    expect(headers['X-AI-Generated']).toBe('true')
    expect(headers['X-AI-Provenance']).toBeTruthy()
    const round = decodeProvenancePayload(headers['X-AI-Provenance']!)
    expect(round?.content_sha256).toBe(p.content_sha256)
    // Editorial responsibility does NOT remove machine marking
    const ed = markEditorialResponsible(p)
    expect(shouldApplyMachineMarking(ed)).toBe(true)
    expect(shouldApplyVisibleSendLabel(ed)).toBe(false)
  })

  it('(c) BEAP content_provenance round-trip shape', () => {
    const p = createProvenance('capsule body', { model_id: 'm', provider: 'host-ai' })
    const capsulePayload = {
      body: 'capsule body',
      content_provenance: p,
    }
    const json = JSON.stringify(capsulePayload)
    const parsed = JSON.parse(json) as { content_provenance?: unknown }
    expect(isAiProvenance(parsed.content_provenance)).toBe(true)
    expect((parsed.content_provenance as { provider: string }).provider).toBe('host-ai')
  })

  it('(d) clipboard HTML flavor contains meta tags', () => {
    const p = createProvenance('copied', { model_id: 'm', provider: 'cloud:openai' })
    const html = buildClipboardHtml('copied', p)
    expect(html).toContain('name="ai-generated"')
    expect(html).toContain('name="ai-provenance"')
    expect(html).toContain(AI_VISIBLE_LABEL_LINE)
    expect(serializeForHtmlMeta(p)).toContain('ai-provenance')
    expect(withVisibleAiLabel('x').startsWith(AI_VISIBLE_LABEL_LINE)).toBe(true)
  })

  it('(e) first-run disclosure ack keys are stable', () => {
    expect(AI_DISCLOSURE_ACK_KEY_MAIN).toBe('art50.aiDisclosure.acknowledgedAt')
    expect(AI_DISCLOSURE_ACK_KEY_EXTENSION).toBe('art50_ai_disclosure_acknowledged_at')
    // Simulate ack persistence contract (localStorage / chrome.storage value = ISO string)
    const ackAt = new Date().toISOString()
    expect(Date.parse(ackAt)).not.toBeNaN()
  })

  it('human edit transitions origin to mixed', () => {
    const p = createProvenance('a', { model_id: 'm', provider: 'local' })
    const edited = markHumanEdited(p, 'a edited')
    expect(edited.origin).toBe('mixed')
    expect(edited.human_edited).toBe(true)
    expect(shouldApplyVisibleSendLabel(edited)).toBe(true)
  })
})
