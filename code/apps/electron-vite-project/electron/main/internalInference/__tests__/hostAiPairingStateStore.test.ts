import { afterEach, describe, expect, it, vi } from 'vitest'
import { InternalInferenceErrorCode } from '../errors'
import {
  _resetHostAiPairingStateStoreForTests,
  hostAiPairingListBlock,
  recordHostAiLedgerAsymmetric,
  recordHostAiReciprocalCapabilitiesSuccess,
} from '../hostAiPairingStateStore'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/host-ai-pairing-test' } }))

describe('hostAiPairingStateStore', () => {
  afterEach(() => {
    _resetHostAiPairingStateStoreForTests()
  })

  it('B: after ledger asymmetric, list gate blocks (no re-probe until re-pair / clear store)', () => {
    const hid = 'hs-asy'
    const host = 'host-device-1'
    recordHostAiLedgerAsymmetric(hid, host)
    const b = hostAiPairingListBlock(hid, host)
    expect(b.block).toBe(true)
    if (b.block) {
      expect(b.code).toBe(InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC)
    }
  })

  it('reciprocal success clears terminal', () => {
    const hid = 'hs-ok'
    const host = 'host-device-2'
    recordHostAiLedgerAsymmetric(hid, host)
    expect(hostAiPairingListBlock(hid, host).block).toBe(true)
    recordHostAiReciprocalCapabilitiesSuccess(hid, host)
    expect(hostAiPairingListBlock(hid, host).block).toBe(false)
  })
})
