import { describe, test, expect } from 'vitest'
import { extractBeapRedirectSourceFromRow, isReceivedBeapInboxSourceType } from '../beapRedirectSource'

describe('beapRedirectSource (redirect + sandbox clone extraction)', () => {
  test('isReceivedBeapInboxSourceType identifies P2P and email-carried BEAP', () => {
    expect(isReceivedBeapInboxSourceType('direct_beap')).toBe(true)
    expect(isReceivedBeapInboxSourceType('email_beap')).toBe(true)
    expect(isReceivedBeapInboxSourceType('email_plain')).toBe(false)
    expect(isReceivedBeapInboxSourceType('')).toBe(false)
    expect(isReceivedBeapInboxSourceType(null)).toBe(false)
  })

  test('extract fails clearly when there is no body or depackaged text', () => {
    const r = extractBeapRedirectSourceFromRow({
      id: 'msg-empty',
      source_type: 'email_beap',
      body_text: '',
      depackaged_json: null,
      subject: 'S',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.length).toBeGreaterThan(20)
      expect(r.error.toLowerCase()).toMatch(/extract|decrypt|pending|content/)
    }
  })

  test('extract succeeds for depackaged email_beap qBEAP decrypted format', () => {
    const dep = JSON.stringify({
      format: 'beap_qbeap_decrypted',
      transport_plaintext: 'Public line',
      body: 'Secret line',
    })
    const r = extractBeapRedirectSourceFromRow({
      id: 'm1',
      source_type: 'email_beap',
      body_text: '',
      depackaged_json: dep,
      handshake_id: 'hs-1',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.public_text).toContain('Public')
      expect(r.encrypted_text).toContain('Secret')
    }
  })
})
