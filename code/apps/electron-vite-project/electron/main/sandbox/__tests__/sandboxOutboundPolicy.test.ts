/**
 * Sandbox outbound data-egress policy — allowlist / deny-by-default proofs (P1).
 *
 * Invariants under test:
 *   - control-plane / plumbing types are PERMITTED from a sandbox (handshake
 *     lifecycle, Host AI inference, sandbox_email_delivery, p2p_signal);
 *   - every human-messaging operation is DENIED regardless of payload;
 *   - data-bearing capsule types (message_package, internal_draft, unknown,
 *     missing) are DENIED — deny-by-default;
 *   - the effective-sandbox signal is ledger-authoritative (mode==='sandbox' OR
 *     ledger-proves-sandbox), NOT mode alone.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const getOrchestratorMode = vi.fn(() => ({ mode: 'host' as string }))
const ledgerProvesLocalSandboxToHostFromDb = vi.fn((_db: unknown) => false)

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getOrchestratorMode: () => getOrchestratorMode(),
}))
vi.mock('../../internalInference/hostAiInternalPairingLedger', () => ({
  ledgerProvesLocalSandboxToHostFromDb: (db: unknown) => ledgerProvesLocalSandboxToHostFromDb(db),
}))

import {
  SANDBOX_OUTBOUND_ALLOWED_TYPES,
  SANDBOX_DATA_EGRESS_FORBIDDEN,
  assertSandboxDataEgressAllowed,
  assertSandboxMaySealServiceRpcInnerType,
  assertSandboxMayReceiveSealedServiceRpcInnerType,
  deriveOutboundCapsuleType,
  isEffectiveSandboxNode,
} from '../sandboxOutboundPolicy'

beforeEach(() => {
  getOrchestratorMode.mockReturnValue({ mode: 'host' })
  ledgerProvesLocalSandboxToHostFromDb.mockReturnValue(false)
})

describe('allowlist (capsule_enqueue) — permitted control-plane / plumbing types', () => {
  const allowed = [
    'initiate',
    'accept',
    'refresh',
    'revoke',
    'context_sync',
    'internal_inference_request',
    'internal_inference_result',
    'internal_inference_error',
    'internal_inference_cancel',
    'internal_inference_capabilities_request',
    'sandbox_email_delivery',
    'p2p_signal',
    'sealed_service_rpc_v1',
  ]
  test.each(allowed)('permits %s', (capsuleType) => {
    expect(assertSandboxDataEgressAllowed({ operation: 'capsule_enqueue', capsuleType }).ok).toBe(true)
  })

  test('allowlist set matches the enumerated system flows exactly', () => {
    expect([...SANDBOX_OUTBOUND_ALLOWED_TYPES].sort()).toEqual([...allowed].sort())
  })
})

describe('deny-by-default (capsule_enqueue) — data-bearing / unknown / missing', () => {
  const denied = [
    'message_package',
    'internal_draft',
    'sandbox_clone',
    'sandbox_clone_quarantine',
    'context_delivery',
    'some_future_unknown_type',
  ]
  test.each(denied)('denies %s', (capsuleType) => {
    const v = assertSandboxDataEgressAllowed({ operation: 'capsule_enqueue', capsuleType })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })

  test('denies a missing / empty capsule type', () => {
    expect(assertSandboxDataEgressAllowed({ operation: 'capsule_enqueue' }).ok).toBe(false)
    expect(assertSandboxDataEgressAllowed({ operation: 'capsule_enqueue', capsuleType: '' }).ok).toBe(false)
    expect(assertSandboxDataEgressAllowed({ operation: 'capsule_enqueue', capsuleType: null }).ok).toBe(false)
  })
})

describe('messaging operations are always denied (regardless of payload)', () => {
  const ops = ['beap_send', 'beap_reply', 'email_send', 'email_reply', 'email_beap_send'] as const
  test.each(ops)('denies %s', (operation) => {
    const v = assertSandboxDataEgressAllowed({ operation })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.code).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
      expect(v.message).toMatch(/disabled on the sandbox/i)
    }
  })

  test('a messaging op is denied even if a lifecycle capsuleType is forged into the request', () => {
    // operation is the authority — a forged allowlisted capsuleType cannot launder an email send.
    const v = assertSandboxDataEgressAllowed({ operation: 'email_send', capsuleType: 'context_sync' })
    expect(v.ok).toBe(false)
  })
})

describe('sealed service-RPC inner type gate (construction-time egress)', () => {
  test('sandbox may seal ingestion_poll_result and ingestion_poll_error', () => {
    expect(assertSandboxMaySealServiceRpcInnerType('ingestion_poll_result').ok).toBe(true)
    expect(assertSandboxMaySealServiceRpcInnerType('ingestion_poll_error').ok).toBe(true)
  })

  test('sandbox may NOT seal ingestion_poll_request (host-only trigger)', () => {
    const v = assertSandboxMaySealServiceRpcInnerType('ingestion_poll_request')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe(SANDBOX_DATA_EGRESS_FORBIDDEN)
  })

  test('opaque sealed capsule_type is allowlisted on capsule_enqueue', () => {
    expect(
      assertSandboxDataEgressAllowed({
        operation: 'capsule_enqueue',
        capsuleType: 'sealed_service_rpc_v1',
      }).ok,
    ).toBe(true)
  })
})

describe('sealed service-RPC inbound inner type gate (A4 receive)', () => {
  test('sandbox may receive host-originated ingestion_poll_request', () => {
    expect(assertSandboxMayReceiveSealedServiceRpcInnerType('ingestion_poll_request').ok).toBe(true)
  })

  test('sandbox rejects inbound result/error inner types (wrong direction)', () => {
    expect(assertSandboxMayReceiveSealedServiceRpcInnerType('ingestion_poll_result').ok).toBe(false)
    expect(assertSandboxMayReceiveSealedServiceRpcInnerType('ingestion_poll_error').ok).toBe(false)
  })
})

describe('deriveOutboundCapsuleType', () => {
  test('reads capsule_type', () => {
    expect(deriveOutboundCapsuleType({ capsule_type: 'context_sync' })).toBe('context_sync')
  })
  test('reads service-message type', () => {
    expect(deriveOutboundCapsuleType({ type: 'sandbox_email_delivery' })).toBe('sandbox_email_delivery')
  })
  test('native BEAP message package (no top-level type) → message_package', () => {
    expect(deriveOutboundCapsuleType({ header: {}, payloadEnc: 'x' })).toBe('message_package')
    expect(deriveOutboundCapsuleType({ envelope: {} })).toBe('message_package')
  })
  test('null for non-objects / empty', () => {
    expect(deriveOutboundCapsuleType(null)).toBeNull()
    expect(deriveOutboundCapsuleType('x')).toBeNull()
    expect(deriveOutboundCapsuleType({})).toBeNull()
  })
})

describe('isEffectiveSandboxNode — ledger-authoritative, not mode-only', () => {
  test('mode === "sandbox" → true (no db needed)', () => {
    getOrchestratorMode.mockReturnValue({ mode: 'sandbox' })
    expect(isEffectiveSandboxNode(null)).toBe(true)
  })

  test('mode === "host" + ledger proves sandbox → true (file=host but ledger authoritative)', () => {
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    ledgerProvesLocalSandboxToHostFromDb.mockReturnValue(true)
    expect(isEffectiveSandboxNode({})).toBe(true)
  })

  test('mode === "host" + ledger false → false (host / single-machine unaffected)', () => {
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    ledgerProvesLocalSandboxToHostFromDb.mockReturnValue(false)
    expect(isEffectiveSandboxNode({})).toBe(false)
  })

  test('no db and mode host → false (cannot read ledger)', () => {
    getOrchestratorMode.mockReturnValue({ mode: 'host' })
    expect(isEffectiveSandboxNode(null)).toBe(false)
  })
})
