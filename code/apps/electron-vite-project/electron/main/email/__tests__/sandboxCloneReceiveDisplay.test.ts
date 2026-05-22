import { describe, expect, it } from 'vitest'
import {
  applyDecryptedQBeapToInboxPreview,
  buildEmailStyleDepackagedJsonFromDecrypt,
  stripSandboxCloneLeadInBodyText,
} from '../beapEmailIngestion'

describe('sandbox clone receive display', () => {
  it('applyDecryptedQBeapToInboxPreview replaces encrypted placeholder body', () => {
    const preview = {
      subject: 'BEAP message (encrypted)',
      body_text: '(Encrypted qBEAP — open in extension for full content)',
      from_address: null,
    }
    const out = applyDecryptedQBeapToInboxPreview(
      preview,
      {
        subject: 'Newsletter',
        body: 'Real clone body text',
        transport_plaintext: 'Real clone body text',
        attachments: [],
      },
      { stripCloneLeadIn: true },
    )
    expect(out.subject).toBe('Newsletter')
    expect(out.body_text).toContain('Real clone body text')
    expect(out.body_text).not.toContain('open in extension')
  })

  it('buildEmailStyleDepackagedJsonFromDecrypt includes format and body', () => {
    const json = buildEmailStyleDepackagedJsonFromDecrypt({
      subject: 'S',
      body: 'Body only',
      transport_plaintext: '',
      attachments: [],
    })
    const d = JSON.parse(json) as { format?: string; body?: string }
    expect(d.format).toBe('beap_qbeap_decrypted')
    expect(d.body).toBe('Body only')
  })

  it('stripSandboxCloneLeadInBodyText removes synthetic banner', () => {
    const raw = '[BEAP sandbox clone — sent by you]\n\nHello world'
    expect(stripSandboxCloneLeadInBodyText(raw).trim()).toBe('Hello world')
  })
})
