import { describe, it, expect } from 'vitest'
import { classifyInboxRowForAi, inboxRowIsClonedPlainEmail } from '../inboxAiCloneClassification'

describe('inboxAiCloneClassification', () => {
  it('classifyInboxRowForAi: direct_beap + provenance original email_plain → not native', () => {
    const dep = JSON.stringify({
      format: 'beap_qbeap_decrypted',
      body: 'hello',
      beap_sandbox_clone: { original_inbox_source_type: 'email_plain', clone_reason: 'sandbox_test' },
    })
    const row = {
      source_type: 'direct_beap',
      handshake_id: 'hs1',
      depackaged_json: dep,
      body_text: '',
      beap_package_json: null,
    }
    expect(inboxRowIsClonedPlainEmail(row)).toBe(true)
    expect(classifyInboxRowForAi(row).isNativeBeap).toBe(false)
  })

  it('classifyInboxRowForAi: direct_beap without clone provenance → native', () => {
    const row = {
      source_type: 'direct_beap',
      handshake_id: 'hs1',
      depackaged_json: null,
      body_text: 'no clone markers',
      beap_package_json: null,
    }
    expect(classifyInboxRowForAi(row).isNativeBeap).toBe(true)
  })

  it('classifyInboxRowForAi: email_plain + handshake_id → not native (aligned with IPC)', () => {
    const row = {
      source_type: 'email_plain',
      handshake_id: 'hs1',
      depackaged_json: null,
      body_text: 'x',
      beap_package_json: null,
    }
    expect(classifyInboxRowForAi(row).isNativeBeap).toBe(false)
  })

  it('inbox_sandbox_clone_provenance.original_source_type email_plain marks clone plain', () => {
    const body =
      'tail\n\n---\n' + JSON.stringify({ inbox_sandbox_clone_provenance: { original_source_type: 'email_plain' } })
    const row = {
      source_type: 'direct_beap',
      handshake_id: 'hs',
      body_text: body,
      depackaged_json: null,
      beap_package_json: null,
    }
    expect(inboxRowIsClonedPlainEmail(row)).toBe(true)
  })
})
