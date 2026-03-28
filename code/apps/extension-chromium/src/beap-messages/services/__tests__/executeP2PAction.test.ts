/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../handshake/handshakeRpc', () => ({
  sendBeapViaP2P: vi.fn(),
}))

import { sendBeapViaP2P } from '../../../handshake/handshakeRpc'
import { executeP2PAction } from '../BeapPackageBuilder'
import type { BeapPackage, BeapPackageConfig } from '../BeapPackageBuilder'

describe('executeP2PAction — REQUEST_INVALID + outbound_debug', () => {
  beforeEach(() => {
    vi.mocked(sendBeapViaP2P).mockReset()
  })

  it('passes p2pOutboundDebug on DeliveryResult when RPC returns outbound_debug', async () => {
    vi.mocked(sendBeapViaP2P).mockResolvedValue({
      success: false,
      error: 'HTTP 400 — {"error":"Bad request"}',
      queued: false,
      code: 'REQUEST_INVALID',
      http_status: 400,
      response_body_snippet: '{"error":"Bad request"}',
      failure_class: 'PAYLOAD_PERMANENT',
      healing_status: 'STOPPED_REQUIRES_FIX',
      outbound_debug: {
        route: 'direct',
        url: 'https://peer.example/beap',
        method: 'POST',
        content_type: 'application/json',
        content_length_bytes: 120,
        body_type: 'json_string',
        top_level_keys: ['header', 'metadata'],
        body_looks_double_encoded: false,
        request_shape: {
          value_kind: 'object',
          top_level_keys: [],
          has_top_level_handshake_id: false,
          has_capsule_type_key: false,
          looks_like_beap_message_package: true,
          looks_like_relay_capsule_envelope: false,
          has_message_header_receiver_binding_handshake_id: true,
        },
        http_status: 400,
        response_body_snippet: '{"error":"Bad request"}',
      },
    })

    const pkg = { header: {}, metadata: {}, envelope: {} } as unknown as BeapPackage
    const config = {
      recipientMode: 'private' as const,
      deliveryMethod: 'p2p' as const,
      selectedRecipient: {
        handshake_id: 'hs-1',
        p2pEndpoint: 'https://peer.example/beap',
        counterparty_email: 'a@b.com',
        counterparty_user_id: 'u',
        sharing_mode: 'reciprocal' as const,
        receiver_fingerprint_short: 'x',
        receiver_fingerprint_full: 'y',
        receiver_display_name: 'R',
        receiver_organization: '',
        receiver_email_list: ['a@b.com'],
      },
      senderFingerprint: 's',
      senderFingerprintShort: 'ss',
      emailTo: '',
      subject: '',
      messageBody: 'hi',
      attachments: [],
    } satisfies BeapPackageConfig

    const r = await executeP2PAction(pkg, config)
    expect(r.success).toBe(false)
    expect(r.code).toBe('REQUEST_INVALID')
    expect(r.queued).toBe(false)
    expect(r.p2pOutboundDebug?.url).toBe('https://peer.example/beap')
    expect(r.message).toContain('HTTP 400')
  })

  it('BACKOFF_WAIT does not imply retry countdown text for REQUEST_INVALID', async () => {
    vi.mocked(sendBeapViaP2P).mockResolvedValue({
      success: false,
      error: 'bad',
      code: 'REQUEST_INVALID',
      queued: false,
      http_status: 400,
    })
    const pkg = { header: {}, metadata: {}, envelope: {} } as unknown as BeapPackage
    const config = {
      recipientMode: 'private' as const,
      deliveryMethod: 'p2p' as const,
      selectedRecipient: {
        handshake_id: 'hs-1',
        p2pEndpoint: 'https://peer.example/beap',
        counterparty_email: 'a@b.com',
        counterparty_user_id: 'u',
        sharing_mode: 'reciprocal' as const,
        receiver_fingerprint_short: 'x',
        receiver_fingerprint_full: 'y',
        receiver_display_name: 'R',
        receiver_organization: '',
        receiver_email_list: ['a@b.com'],
      },
      senderFingerprint: 's',
      senderFingerprintShort: 'ss',
      emailTo: '',
      subject: '',
      messageBody: 'hi',
      attachments: [],
    } satisfies BeapPackageConfig
    const r = await executeP2PAction(pkg, config)
    expect(r.message?.includes('Retry available')).toBe(false)
    expect(r.p2pCooldownUntilMs).toBeUndefined()
  })

  it('sets p2pRelayAcceptedPendingIngest when relay succeeds without recipient ingest confirmation', async () => {
    vi.mocked(sendBeapViaP2P).mockResolvedValue({
      success: true,
      coordinationRelayDelivery: 'pushed_live',
      recipient_ingest_confirmed: false,
    })
    const pkg = { header: {}, metadata: {}, envelope: {} } as unknown as BeapPackage
    const config = {
      recipientMode: 'private' as const,
      deliveryMethod: 'p2p' as const,
      selectedRecipient: {
        handshake_id: 'hs-1',
        p2pEndpoint: 'https://peer.example/beap',
        counterparty_email: 'a@b.com',
        counterparty_user_id: 'u',
        sharing_mode: 'reciprocal' as const,
        receiver_fingerprint_short: 'x',
        receiver_fingerprint_full: 'y',
        receiver_display_name: 'R',
        receiver_organization: '',
        receiver_email_list: ['a@b.com'],
      },
      senderFingerprint: 's',
      senderFingerprintShort: 'ss',
      emailTo: '',
      subject: '',
      messageBody: 'hi',
      attachments: [],
    } satisfies BeapPackageConfig

    const r = await executeP2PAction(pkg, config)
    expect(r.success).toBe(true)
    expect(r.message).toBe('Message sent')
    expect(r.delivered).toBe(true)
    expect(r.recipientIngestConfirmed).toBe(false)
    expect(r.p2pRelayAcceptedPendingIngest).toBe(true)
    expect(r.coordinationRelayDelivery).toBe('pushed_live')
  })

  it('sets recipientIngestConfirmed when Electron reports recipient_ingest_confirmed', async () => {
    vi.mocked(sendBeapViaP2P).mockResolvedValue({
      success: true,
      coordinationRelayDelivery: 'pushed_live',
      recipient_ingest_confirmed: true,
    })
    const pkg = { header: {}, metadata: {}, envelope: {} } as unknown as BeapPackage
    const config = {
      recipientMode: 'private' as const,
      deliveryMethod: 'p2p' as const,
      selectedRecipient: {
        handshake_id: 'hs-1',
        p2pEndpoint: 'https://peer.example/beap',
        counterparty_email: 'a@b.com',
        counterparty_user_id: 'u',
        sharing_mode: 'reciprocal' as const,
        receiver_fingerprint_short: 'x',
        receiver_fingerprint_full: 'y',
        receiver_display_name: 'R',
        receiver_organization: '',
        receiver_email_list: ['a@b.com'],
      },
      senderFingerprint: 's',
      senderFingerprintShort: 'ss',
      emailTo: '',
      subject: '',
      messageBody: 'hi',
      attachments: [],
    } satisfies BeapPackageConfig

    const r = await executeP2PAction(pkg, config)
    expect(r.success).toBe(true)
    expect(r.message).toBe('Message sent')
    expect(r.delivered).toBe(true)
    expect(r.recipientIngestConfirmed).toBe(true)
    expect(r.p2pRelayAcceptedPendingIngest).toBeUndefined()
  })

  it('includes clientSendFailureDebug when transport fails without outbound_debug', async () => {
    vi.mocked(sendBeapViaP2P).mockResolvedValue({
      success: false,
      error: 'network down',
      queued: false,
    })
    const pkg = { header: {}, metadata: {}, envelope: {} } as unknown as BeapPackage
    const config = {
      recipientMode: 'private' as const,
      deliveryMethod: 'p2p' as const,
      selectedRecipient: {
        handshake_id: 'hs-1',
        p2pEndpoint: 'https://peer.example/beap',
        counterparty_email: 'a@b.com',
        counterparty_user_id: 'u',
        sharing_mode: 'reciprocal' as const,
        receiver_fingerprint_short: 'x',
        receiver_fingerprint_full: 'y',
        receiver_display_name: 'R',
        receiver_organization: '',
        receiver_email_list: ['a@b.com'],
      },
      senderFingerprint: 's',
      senderFingerprintShort: 'ss',
      emailTo: '',
      subject: '',
      messageBody: 'hi',
      attachments: [],
    } satisfies BeapPackageConfig
    const r = await executeP2PAction(pkg, config)
    expect(r.success).toBe(false)
    expect(r.clientSendFailureDebug?.kind).toBe('client_send_failure')
    expect(r.clientSendFailureDebug?.phase).toBe('p2p_transport')
  })
})
