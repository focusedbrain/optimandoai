/**
 * Tests for resolveHostAiRemoteInferencePolicy (Host-only remote inference gate).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../handshake/ledger', () => ({
  getLedgerDb: () => null,
}))

const getPolicy = vi.hoisted(() => vi.fn())
const ledgerPairing = vi.hoisted(() => vi.fn())
const ledgerSummary = vi.hoisted(() =>
  vi.fn(() => ({
    effective_host_ai_role: 'host' as const,
    can_publish_host_endpoint: true,
    can_probe_host_endpoint: false,
    any_orchestrator_mismatch: false,
  })),
)

vi.mock('../hostInferencePolicyStore', () => ({
  getHostInternalInferencePolicy: () => getPolicy(),
}))

vi.mock('../hostAiInternalPairingLedger', () => ({
  hostHasActiveInternalLedgerHostPeerSandboxFromDb: (db: unknown) => ledgerPairing(db),
}))

vi.mock('../hostAiEffectiveRole', () => ({
  getHostAiLedgerRoleSummaryFromDb: (_db: unknown, _id: string, _m: string) => ledgerSummary(),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  getInstanceId: () => 'dev-host-x',
  getOrchestratorMode: () => ({ mode: 'host' }),
}))

describe('resolveHostAiRemoteInferencePolicy', () => {
  beforeEach(() => {
    ledgerSummary.mockImplementation(() => ({
      effective_host_ai_role: 'host' as const,
      can_publish_host_endpoint: true,
      can_probe_host_endpoint: false,
      any_orchestrator_mismatch: false,
    }))
    ledgerPairing.mockReturnValue(true)
  })

  it('allows when ledger host + pairing + user choice unset + stored allowSandbox false', async () => {
    getPolicy.mockReturnValue({
      allowSandboxInference: false,
      remoteHostInferenceUserChoice: 'unset',
    })
    const { resolveHostAiRemoteInferencePolicy } = await import('../hostAiRemoteInferencePolicyResolve')
    const r = resolveHostAiRemoteInferencePolicy({})
    expect(r.allowRemoteInference).toBe(true)
    expect(r.policySource).toBe('default_internal_pairing_allow')
  })

  it('explicit user deny → false', async () => {
    getPolicy.mockReturnValue({
      allowSandboxInference: false,
      remoteHostInferenceUserChoice: 'deny',
    })
    const { resolveHostAiRemoteInferencePolicy } = await import('../hostAiRemoteInferencePolicyResolve')
    const r = resolveHostAiRemoteInferencePolicy({})
    expect(r.allowRemoteInference).toBe(false)
    expect(r.explicitUserDisabled).toBe(true)
    expect(r.denialReason).toBe('explicit_user_disabled')
  })

  it('no internal sandbox peer → false', async () => {
    getPolicy.mockReturnValue({
      allowSandboxInference: false,
      remoteHostInferenceUserChoice: 'unset',
    })
    ledgerPairing.mockReturnValue(false)
    const { resolveHostAiRemoteInferencePolicy } = await import('../hostAiRemoteInferencePolicyResolve')
    const r = resolveHostAiRemoteInferencePolicy({})
    expect(r.allowRemoteInference).toBe(false)
    expect(r.policySource).toBe('default_deny_no_pairing')
  })

  it('not host ledger → false', async () => {
    getPolicy.mockReturnValue({
      allowSandboxInference: false,
      remoteHostInferenceUserChoice: 'unset',
    })
    ledgerSummary.mockReturnValue({
      effective_host_ai_role: 'sandbox' as const,
      can_publish_host_endpoint: false,
      can_probe_host_endpoint: true,
      any_orchestrator_mismatch: false,
    })
    const { resolveHostAiRemoteInferencePolicy } = await import('../hostAiRemoteInferencePolicyResolve')
    const r = resolveHostAiRemoteInferencePolicy({})
    expect(r.allowRemoteInference).toBe(false)
    expect(r.policySource).toBe('default_deny_no_ledger_host')
  })

  it('hostAiBeapAdPublishShouldRetryAfterPolicyDenial is false for explicit deny', async () => {
    const { hostAiBeapAdPublishShouldRetryAfterPolicyDenial } = await import('../hostAiRemoteInferencePolicyResolve')
    expect(
      hostAiBeapAdPublishShouldRetryAfterPolicyDenial({
        allowRemoteInference: false,
        explicitUserDisabled: true,
        denialReason: 'explicit_user_disabled',
        policySource: 'explicit_user_deny',
        remoteChoice: 'deny',
      }),
    ).toBe(false)
  })

  it('hostAiBeapAdPublishShouldRetryAfterPolicyDenial is true for ledger pairing denial', async () => {
    const { hostAiBeapAdPublishShouldRetryAfterPolicyDenial } = await import('../hostAiRemoteInferencePolicyResolve')
    expect(
      hostAiBeapAdPublishShouldRetryAfterPolicyDenial({
        allowRemoteInference: false,
        explicitUserDisabled: false,
        denialReason: 'no_active_internal_sandbox_peer',
        policySource: 'default_deny_no_pairing',
        remoteChoice: 'unset',
      }),
    ).toBe(true)
  })
})

