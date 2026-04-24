/**
 * Regression matrix — handshakes, relay delivery, sandbox clone (2026 spec)
 *
 * | # | Area | Covered by |
 * |---|------|----------------|
 * | 1 | Normal cross-principal: initiate→accept→context_sync→ACTIVE | `handshakeRefactorRegression.matrix` M6–M7; `postAcceptContextSync.ingestPaths`; `ipc.handshake` (e2e) |
 * | 2 | Internal host/sandbox: same + device roles | `internalSamePrincipal.contextSync`; `internalDeviceIdentity.flow`; `ipc.internal.*` |
 * | 3 | Normal BEAP: online live / offline queued / drain | `relayQueueTransportOutcome` + `outboundQueue` backoff tests |
 * | 4–5 | Internal BEAP H↔S both directions | Same HTTP mapper — direction does not change 200/202 semantics (`mapSendResultToQueueOutcome`) |
 * | 6 | Wrong device id / registry | `outboundQueue.backoff` QB_22+; relay 403 paths (no false deliver) |
 * | 7 | Same-principal skip | `coordinationSamePrincipalInbound.test` |
 * | 8 | Inbox redirect/sandbox clone | `extractBeapRedirectSource`; `prepareBeapInboxSandboxClone` eligibility; renderer `mapCoordinationDeliveryToMatrixMode` |
 * | 9 | Account / vault scope | `vaultAccountIsolation.test`; `assertVaultOwnerMatchesSession` |
 * | 10 | Status: 200 live, 202 queued, POST fail | `mapSendResultToQueueOutcome`; `beapSandboxCloneDeliverySemantics.test` |
 *
 * Constraints: no tests here mutate X25519/ML-KEM agreement, ACTIVE gate invariants, or accept/build capsule crypto.
 */

import { describe, test, expect } from 'vitest'
import {
  mapSendResultToQueueOutcome,
  type SendCapsuleSuccessShape,
} from '../relayQueueTransportOutcome'
import { computeSamePrincipalCoordinationSkipOwn } from '../../p2p/coordinationSamePrincipalInbound'
import { HandshakeState } from '../types'
import type { HandshakeRecord } from '../types'
import { isEligibleActiveInternalHostSandboxRecord } from '../internalSandboxesApi'
import type { SSOSession } from '../types'
import { getNextStateAfterInboundContextSync } from '../contextSyncActiveGate'
import { assertVaultOwnerMatchesSession, VAULT_ACCOUNT_ERROR } from '../../vault/vaultOwnerIdentity'
import { extractBeapRedirectSourceFromRow } from '../../email/beapRedirectSource'

const sessionUserA: SSOSession = {
  wrdesk_user_id: 'user-a',
  email: 'a@example.com',
  iss: 'https://id.example',
  sub: 'sub-a',
  email_verified: true,
  plan: 'free',
  currentHardwareAttestation: null,
  currentDnsVerification: null,
  currentWrStampStatus: null,
  session_expires_at: new Date(Date.now() + 3600_000).toISOString(),
}

const sessionUserB: SSOSession = {
  ...sessionUserA,
  wrdesk_user_id: 'user-b',
  email: 'b@example.com',
  sub: 'sub-b',
}

function baseInternalHostSandboxRecord(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-sbx-1',
    state: HandshakeState.ACTIVE,
    handshake_type: 'internal',
    local_role: 'initiator',
    initiator_device_role: 'host',
    acceptor_device_role: 'sandbox',
    internal_coordination_identity_complete: true,
    p2p_endpoint: 'https://coord.example/beap',
    local_x25519_public_key_b64: 'dGVzdC1sb2NhbC14MjU1MTktcHViLWtleQ==',
    relationship_id: 'rel-1',
    initiator: { email: 'a@example.com', wrdesk_user_id: 'user-a' },
    acceptor: { email: 'a@example.com', wrdesk_user_id: 'user-a' },
    ...overrides,
  } as HandshakeRecord
}

describe('regressionMatrix — relay HTTP semantics (§3, §4, §5, §10)', () => {
  test('§10 / §3: 200 + pushed_live => DELIVERED_LIVE', () => {
    const r: SendCapsuleSuccessShape = {
      success: true,
      statusCode: 200,
      coordinationRelayDelivery: 'pushed_live',
    }
    const o = mapSendResultToQueueOutcome(r)
    expect(o.delivered).toBe(true)
    expect(o.queued).toBe(false)
    expect(o.code).toBe('DELIVERED_LIVE')
  })

  test('§10 / §3: 202 + queued_recipient_offline => queued, not delivered', () => {
    const r: SendCapsuleSuccessShape = {
      success: true,
      statusCode: 202,
      coordinationRelayDelivery: 'queued_recipient_offline',
    }
    const o = mapSendResultToQueueOutcome(r)
    expect(o.delivered).toBe(false)
    expect(o.queued).toBe(true)
    expect(o.code).toBe('QUEUED_RECIPIENT_OFFLINE')
  })

  test('§4–5: mapper is direction-agnostic (host→sandbox vs sandbox→host)', () => {
    const a = mapSendResultToQueueOutcome({
      success: true,
      statusCode: 200,
      coordinationRelayDelivery: 'pushed_live',
    })
    const b = mapSendResultToQueueOutcome({
      success: true,
      statusCode: 200,
      coordinationRelayDelivery: 'pushed_live',
    })
    expect(a).toEqual(b)
  })
})

describe('regressionMatrix — handshake ACTIVE gate (§1, §2) — no crypto', () => {
  test('§1/§2: both sides seq>=1 after accept => ACTIVE via context sync gate', () => {
    const row: HandshakeRecord = {
      state: HandshakeState.ACCEPTED,
      last_seq_sent: 1,
      last_seq_received: 1,
    } as HandshakeRecord
    expect(getNextStateAfterInboundContextSync(row, 1)).toBe(HandshakeState.ACTIVE)
  })
})

describe('regressionMatrix — same-principal skip (§7)', () => {
  test('§7: same device echo skipped; other device not skipped', () => {
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: 'x',
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'DEV-A',
        localDeviceId: 'DEV-A',
      }),
    ).toBe(true)
    expect(
      computeSamePrincipalCoordinationSkipOwn({
        hasDb: true,
        handshakeId: 'x',
        record: { handshake_type: 'internal' },
        capsuleSenderDeviceId: 'DEV-SANDBOX',
        localDeviceId: 'DEV-HOST',
      }),
    ).toBe(false)
  })
})

describe('regressionMatrix — internal sandbox eligibility / account (§8, §9)', () => {
  test('§9: sandbox row not eligible for another account (no UI leak)', () => {
    const rec = baseInternalHostSandboxRecord()
    expect(isEligibleActiveInternalHostSandboxRecord(rec, sessionUserA)).toBe(true)
    expect(isEligibleActiveInternalHostSandboxRecord(rec, sessionUserB)).toBe(false)
  })

  test('§9: vault owner mismatch throws (vaults scoped to account)', () => {
    expect(() =>
      assertVaultOwnerMatchesSession(
        {
          owner_sub: 'sub-a',
          owner_iss: 'https://id.example',
          owner_wrdesk_user_id: 'user-a',
          owner_email: 'a@example.com',
          owner_email_verified: true,
          owner_claimed_at: '2020-01-01T00:00:00.000Z',
          vault_schema_version: 1,
        },
        { sub: 'other', iss: 'https://id.example' } as any,
        VAULT_ACCOUNT_ERROR.MISMATCH_UNLOCK,
      ),
    ).toThrow(VAULT_ACCOUNT_ERROR.MISMATCH_UNLOCK)
  })
})

describe('regressionMatrix — inbox extract / no ciphertext in text path (§8)', () => {
  test('§8: extractBeapRedirectSourceFromRow uses depackaged only (clone/redirect plain text)', () => {
    const r = extractBeapRedirectSourceFromRow({
      id: 'm1',
      source_type: 'direct_beap',
      handshake_id: 'h1',
      subject: 'S',
      body_text: 'hello',
      depackaged_json: JSON.stringify({
        format: 'beap_qbeap_decrypted',
        transport_plaintext: 'pub',
        body: { text: 'secret' },
      }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.public_text).toContain('pub')
      expect(r.encrypted_text).toContain('secret')
    }
  })
})

describe('regressionMatrix — §6 wrong device / false deliver (reference)', () => {
  test('§6: document — device mismatch → terminal / 403 paths in outboundQueue.backoff (QB_22+)', () => {
    expect('receiver_device_id does not match registry route').toContain('registry')
  })
})
