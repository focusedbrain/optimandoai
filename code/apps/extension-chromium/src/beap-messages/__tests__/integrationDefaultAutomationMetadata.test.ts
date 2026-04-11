import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  beapIntegrationIdentityFromMessage,
  beapIntegrationStableKey,
  validateBeapIntegrationIdentity,
  parseBeapIntegrationDefaultAutomationRoot,
  serializeBeapIntegrationDefaultAutomationRoot,
  emptyBeapIntegrationDefaultAutomationRoot,
  upsertBeapIntegrationDefaultAutomationEntry,
  BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY,
  type BeapIntegrationDefaultAutomationEntryV1,
} from '../integrationDefaultAutomationMetadata'
import type { BeapMessage } from '../beapInboxTypes'

function msg(partial: Partial<BeapMessage>): Pick<BeapMessage, 'senderFingerprint' | 'handshakeId'> {
  return {
    senderFingerprint: partial.senderFingerprint ?? 'ABCD',
    handshakeId: partial.handshakeId ?? null,
  }
}

describe('integrationDefaultAutomationMetadata', () => {
  it('builds stable key with handshake + fingerprint', () => {
    const id = beapIntegrationIdentityFromMessage(msg({ senderFingerprint: 'Aa01', handshakeId: 'hs-1' }))
    expect(beapIntegrationStableKey(id)).toBe('v1|hs:hs-1|fp:aa01')
  })

  it('builds stable key fingerprint-only when no handshake', () => {
    const id = beapIntegrationIdentityFromMessage(msg({ senderFingerprint: '  Xy99 ', handshakeId: null }))
    expect(beapIntegrationStableKey(id)).toBe('v1|fp:xy99')
  })

  it('parseRoot returns empty for garbage', () => {
    expect(parseBeapIntegrationDefaultAutomationRoot(undefined)).toEqual(emptyBeapIntegrationDefaultAutomationRoot())
    expect(parseBeapIntegrationDefaultAutomationRoot({})).toEqual(emptyBeapIntegrationDefaultAutomationRoot())
    expect(parseBeapIntegrationDefaultAutomationRoot({ schemaVersion: 2 })).toEqual(
      emptyBeapIntegrationDefaultAutomationRoot(),
    )
  })

  it('validateBeapIntegrationIdentity rejects empty fingerprint', () => {
    const id = beapIntegrationIdentityFromMessage(msg({ senderFingerprint: '  ' }))
    const v = validateBeapIntegrationIdentity(id)
    expect(v.ok).toBe(false)
  })

  it('beapIntegrationStableKey throws when fingerprint is empty', () => {
    expect(() =>
      beapIntegrationStableKey({
        schemaVersion: 1,
        senderFingerprint: '',
        handshakeId: null,
      }),
    ).toThrow()
  })

  it('serialize + parse round-trips', () => {
    const entry: BeapIntegrationDefaultAutomationEntryV1 = {
      schemaVersion: 1,
      integrationKey: 'v1|fp:aa',
      identity: { schemaVersion: 1, senderFingerprint: 'aa', handshakeId: null },
      defaultSessionKey: 'session_123',
      defaultAutomationLabel: 'My flow',
      defaultAutomationIcon: '\u2699',
      updatedAt: 42,
    }
    const root = { schemaVersion: 1 as const, byIntegrationKey: { 'v1|fp:aa': entry } }
    const back = parseBeapIntegrationDefaultAutomationRoot(
      JSON.parse(serializeBeapIntegrationDefaultAutomationRoot(root)),
    )
    expect(back.byIntegrationKey['v1|fp:aa']?.defaultSessionKey).toBe('session_123')
    expect(back.byIntegrationKey['v1|fp:aa']?.defaultAutomationIcon).toBe('\u2699')
  })

  describe('chrome.storage persistence (mocked)', () => {
    let mem: unknown

    beforeEach(() => {
      mem = undefined
      vi.stubGlobal('chrome', {
        storage: {
          local: {
            get: vi.fn((_keys: string[], cb: (items: Record<string, unknown>) => void) => {
              cb({ [BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY]: mem })
            }),
            set: vi.fn((items: Record<string, unknown>, cb: () => void) => {
              mem = items[BEAP_INTEGRATION_DEFAULT_AUTOMATION_STORAGE_KEY]
              cb()
            }),
          },
        },
        runtime: { lastError: undefined as string | undefined },
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('upsert persists entry under canonical integrationKey', async () => {
      const identity = beapIntegrationIdentityFromMessage(msg({ senderFingerprint: 'Zz9', handshakeId: null }))
      const integrationKey = beapIntegrationStableKey(identity)
      await upsertBeapIntegrationDefaultAutomationEntry({
        integrationKey,
        identity,
        defaultSessionKey: 'session_wr_1',
        defaultAutomationLabel: 'Inbox flow',
        defaultAutomationIcon: '\u2699',
      })
      const root = parseBeapIntegrationDefaultAutomationRoot(mem)
      expect(root.byIntegrationKey[integrationKey]?.defaultSessionKey).toBe('session_wr_1')
      expect(root.byIntegrationKey[integrationKey]?.defaultAutomationLabel).toBe('Inbox flow')
    })

    it('upsert rejects integrationKey mismatch', async () => {
      const identity = beapIntegrationIdentityFromMessage(msg({ senderFingerprint: 'Aa', handshakeId: null }))
      await expect(
        upsertBeapIntegrationDefaultAutomationEntry({
          integrationKey: 'wrong-key',
          identity,
          defaultSessionKey: 's',
          defaultAutomationLabel: null,
          defaultAutomationIcon: null,
        }),
      ).rejects.toThrow(/integrationKey/)
    })
  })
})
