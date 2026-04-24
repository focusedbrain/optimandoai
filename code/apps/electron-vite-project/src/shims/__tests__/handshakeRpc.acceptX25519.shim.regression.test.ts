/**
 * Electron dashboard shim: normal handshake.accept X25519 from `window.beap.getDevicePublicKey`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { acceptHandshake } from '../handshakeRpc'

vi.mock('@ext/beap-messages/services/beapCrypto', () => ({
  pqKemSupportedAsync: vi.fn(() => Promise.resolve(false)),
  pqKemGenerateKeyPair: vi.fn(),
}))

const MOCK_X25519_B64 = 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='

describe('handshakeRpc shim acceptHandshake — normal X25519', () => {
  const acceptFn = vi.fn()

  beforeEach(() => {
    acceptFn.mockResolvedValue({ success: true, type: 'handshake-accept-result' })
    vi.stubGlobal('window', {
      handshakeView: { acceptHandshake: acceptFn },
      beap: { getDevicePublicKey: vi.fn() },
    } as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('T1_normal_accept_forwards_senderX25519PublicKeyB64_when_getDevicePublicKey_returns_object_envelope', async () => {
    const getDevicePublicKey = vi.fn().mockResolvedValue({ success: true, publicKey: MOCK_X25519_B64 })
    ;(globalThis.window as any).beap = { getDevicePublicKey }

    await acceptHandshake('hs-1', 'reciprocal', '', { policy_selections: { cloud_ai: false, internal_ai: false } })

    expect(getDevicePublicKey).toHaveBeenCalledTimes(1)
    expect(acceptFn).toHaveBeenCalledTimes(1)
    const opts = acceptFn.mock.calls[0][3] as Record<string, unknown>
    expect(opts.senderX25519PublicKeyB64).toBe(MOCK_X25519_B64)
  })

  it('T2_normal_accept_forwards_senderX25519PublicKeyB64_when_getDevicePublicKey_returns_raw_string', async () => {
    const getDevicePublicKey = vi.fn().mockResolvedValue(`  ${MOCK_X25519_B64}  `)
    ;(globalThis.window as any).beap = { getDevicePublicKey }

    await acceptHandshake('hs-2', 'reciprocal', '', undefined)

    expect(acceptFn).toHaveBeenCalledTimes(1)
    const opts = acceptFn.mock.calls[0][3] as Record<string, unknown>
    expect(opts.senderX25519PublicKeyB64).toBe(MOCK_X25519_B64)
  })

  it('T3a_normal_accept_returns_ERR_before_handshakeView_when_getDevicePublicKey_returns_success_false', async () => {
    const getDevicePublicKey = vi.fn().mockResolvedValue({ success: false, error: 'DEVICE_KEY_NOT_FOUND' })
    ;(globalThis.window as any).beap = { getDevicePublicKey }

    const res = await acceptHandshake('hs-3a', 'reciprocal', '', { policy_selections: { cloud_ai: false, internal_ai: false } })

    expect(acceptFn).not.toHaveBeenCalled()
    expect(res.success).toBe(false)
    expect(res.code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })

  it('T3b_normal_accept_returns_ERR_before_handshakeView_when_publicKey_missing_or_blank', async () => {
    const getDevicePublicKey = vi.fn().mockResolvedValue({ success: true, publicKey: '   ' })
    ;(globalThis.window as any).beap = { getDevicePublicKey }

    const res = await acceptHandshake('hs-3b', 'reciprocal', '', undefined)

    expect(acceptFn).not.toHaveBeenCalled()
    expect(res.code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })

  it('T4_internal_accept_still_calls_handshakeView_when_beap_returns_no_key', async () => {
    const getDevicePublicKey = vi.fn().mockResolvedValue({ success: false })
    ;(globalThis.window as any).beap = { getDevicePublicKey }

    await acceptHandshake('hs-int', 'reciprocal', '', { device_role: 'sandbox' })

    expect(acceptFn).toHaveBeenCalledTimes(1)
    const opts = acceptFn.mock.calls[0][3] as Record<string, unknown>
    expect(opts.device_role).toBe('sandbox')
    expect(opts.senderX25519PublicKeyB64).toBeUndefined()
  })
})
