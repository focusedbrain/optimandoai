import { describe, it, expect, vi } from 'vitest'
import {
  classifyInboxRowForAi,
  inboxRowIsClonedPlainEmail,
  logInboxReplyTransportDecision,
  resolveInboxReplyMode,
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
    expect(resolveInboxReplyMode(row)).toBe('email')
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
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('source_type_email_plain')
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
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('original_source_type_email_plain')
    })

    it('direct_beap + depackaged_json inbox_sandbox_clone_provenance original_source_type email_plain → email', () => {
      const dep = JSON.stringify({
        inbox_sandbox_clone_provenance: { original_source_type: 'email_plain' },
      })
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'hs1',
        depackaged_json: dep,
        body_text: '',
        beap_package_json: null,
      }
      expect(inboxRowIsClonedPlainEmail(row)).toBe(true)
      expect(resolveInboxReplyTransport(row)).toBe('email')
    })

    it('direct_beap + provenance original_response_path email → email', () => {
      const dep = JSON.stringify({
        inbox_sandbox_clone_provenance: {
          original_source_type: 'direct_beap',
          original_response_path: 'email',
        },
      })
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'hs1',
        depackaged_json: dep,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyMode(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('original_response_path_email')
    })

    it('direct_beap + provenance reply_transport email → email', () => {
      const dep = JSON.stringify({
        inbox_sandbox_clone_provenance: {
          original_source_type: 'direct_beap',
          reply_transport: 'email',
        },
      })
      const row = {
        source_type: 'direct_beap',
        handshake_id: 'hs1',
        depackaged_json: dep,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyMode(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('reply_transport_email')
    })

    it('direct_beap + handshake_id + top-level sandbox original_source_type email_plain → email', () => {
      const row = {
        source_type: 'direct_beap',
        sandbox_clone: true,
        original_source_type: 'email_plain',
        handshake_id: 'hs1',
        depackaged_json: null,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyMode(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('original_source_type_email_plain')
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

    it('unknown source_type without native BEAP signals → email', () => {
      const row = {
        source_type: 'depackaged',
        handshake_id: null,
        depackaged_json: null,
        body_text: '',
        beap_package_json: null,
      }
      expect(resolveInboxReplyMode(row)).toBe('email')
      expect(resolveInboxReplyTransport(row)).toBe('email')
      expect(resolveInboxReplyTransportMeta(row).routerReason).toBe('not_native_beap')
    })

    it('email_plain keeps email transport when From is empty (UI fail-closed; resolver unchanged)', () => {
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

  describe('logInboxReplyTransportDecision', () => {
    it('logs messageId, source_type, clone flag, transport, selectedPath (no bodies)', () => {
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
      logInboxReplyTransportDecision(row, {
        messageId: 'mid-1',
        phase: 'send_draft',
        selectedPath: 'email_send',
      })
      expect(spy).toHaveBeenCalled()
      const raw = String(spy.mock.calls[0]?.[0] ?? '')
      const idx = raw.indexOf('{')
      expect(idx).toBeGreaterThan(-1)
      const o = JSON.parse(raw.slice(idx)) as Record<string, unknown>
      expect(o.messageId).toBe('mid-1')
      expect(o.source_type).toBe('direct_beap')
      expect(o.sandboxClone).toBe(true)
      expect(o.original_source_type).toBe('email_plain')
      expect(o.inboxRowIsClonedPlainEmail).toBe(true)
      expect(o.resolvedResponsePath).toBe('email')
      expect(o.selectedPath).toBe('email_send')
      expect(o.phase).toBe('send_draft')
      spy.mockRestore()
    })
  })
})
