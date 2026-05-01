import { describe, it, expect, vi } from 'vitest'
import {
  classifyInboxRowForAi,
  inboxRowIsClonedPlainEmail,
  logInboxReplyTransportResolution,
  resolveInboxReplyTransport,
  resolveInboxReplyTransportMeta,
} from '../inboxAiCloneClassification'

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

  describe('resolveInboxReplyTransport', () => {
    it('email_plain → email', () => {
      const row = {
        source_type: 'email_plain',
        handshake_id: null,
        depackaged_json: null,
        body_text: 'x',
        beap_package_json: null,
      }
      expect(resolveInboxReplyTransport(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('source_email_plain_or_depackaged_storage')
    })

    it('direct_beap + clone provenance original email_plain → email (sandbox P2P clone of plain mail)', () => {
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
      expect(resolveInboxReplyTransport(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('sandbox_p2p_clone_of_plain_email')
    })

    it('direct_beap without clone provenance → native_beap', () => {
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'hs1',
        depackaged_json: null,
        body_text: 'no clone markers',
        beap_package_json: null,
      }
      expect(resolveInboxReplyTransport(row)).toBe('native_beap')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('default_native_beap')
    })

    it('direct_beap with malformed / non-plain clone provenance → native_beap', () => {
      const dep = JSON.stringify({
        beap_sandbox_clone: { clone_reason: 'sandbox_test' },
      })
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'hs1',
        depackaged_json: dep,
        body_text: '',
        beap_package_json: null,
      }
      expect(inboxRowIsClonedPlainEmail(row)).toBe(false)
      expect(resolveInboxReplyTransport(row)).toBe('native_beap')
    })

    it('depackaged storage label → email (legacy ingest)', () => {
      const row = {
        source_type: 'depackaged',
        handshake_id: null,
        depackaged_json: null,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyTransport(row)).toBe('email')
    })

    it('email transport stays email when From is empty (UI must fail closed; no BEAP fallback)', () => {
      const row = {
        source_type: 'email_plain',
        handshake_id: null,
        depackaged_json: null,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyTransport(row)).toBe('email')
    })
  })

  describe('logInboxReplyTransportResolution', () => {
    it('logs structured payload without throwing', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'h',
        depackaged_json: JSON.stringify({
          beap_sandbox_clone: { original_inbox_source_type: 'email_plain', clone_reason: 't' },
        }),
        body_text: '',
        beap_package_json: null,
      }
      logInboxReplyTransportResolution(row, {
        messageId: 'mid-1',
        phase: 'send_draft',
        derivedMessageKind: 'depackaged',
        hasFromAddress: true,
        accountId: 'acc-1',
      })
      expect(spy).toHaveBeenCalled()
      const raw = String(spy.mock.calls[0]?.[0] ?? '')
      expect(raw).toContain('[INBOX_REPLY_TRANSPORT]')
      expect(raw).toContain('mid-1')
      expect(raw).toContain('email')
      expect(raw).not.toContain('@')
      spy.mockRestore()
    })
  })
})
