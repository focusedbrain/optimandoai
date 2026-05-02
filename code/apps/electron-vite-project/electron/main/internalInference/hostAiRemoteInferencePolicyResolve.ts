/**
 * Single source of truth: whether this Host may expose/serve remote (sandbox) internal inference,
 * combining persisted choice with ledger + same-principal pairing gates.
 */

import { getLedgerDb } from '../handshake/ledger'
import { getInstanceId, getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import { getHostAiLedgerRoleSummaryFromDb } from './hostAiEffectiveRole'
import { hostHasActiveInternalLedgerHostPeerSandboxFromDb } from './hostAiInternalPairingLedger'
import {
  getHostInternalInferencePolicy,
  type RemoteHostInferenceUserChoice,
} from './hostInferencePolicyStore'

export type HostAiRemotePolicyResolution = {
  allowRemoteInference: boolean
  explicitUserDisabled: boolean
  denialReason?: string
  policySource:
    | 'explicit_user_deny'
    | 'explicit_user_allow'
    | 'default_internal_pairing_allow'
    | 'default_deny_no_ledger_host'
    | 'default_deny_no_pairing'
    | 'default_deny_ledger_unavailable'
  remoteChoice: RemoteHostInferenceUserChoice
}

export function resolveHostAiRemoteInferencePolicy(db: unknown): HostAiRemotePolicyResolution {
  const pol = getHostInternalInferencePolicy()
  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  const ledger = getHostAiLedgerRoleSummaryFromDb(db as any, localId, modeHint)
  const pairing = hostHasActiveInternalLedgerHostPeerSandboxFromDb(db)
  let choice: RemoteHostInferenceUserChoice
  if (pol.remoteHostInferenceUserChoice === 'deny') {
    choice = 'deny'
  } else if (pol.remoteHostInferenceUserChoice === 'allow') {
    choice = 'allow'
  } else if (pol.allowSandboxInference === true) {
    choice = 'allow'
  } else {
    choice = 'unset'
  }

  if (choice === 'deny') {
    return {
      allowRemoteInference: false,
      explicitUserDisabled: true,
      denialReason: 'explicit_user_disabled',
      policySource: 'explicit_user_deny',
      remoteChoice: 'deny',
    }
  }
  if (choice === 'allow') {
    return {
      allowRemoteInference: true,
      explicitUserDisabled: false,
      policySource: 'explicit_user_allow',
      remoteChoice: 'allow',
    }
  }

  if (ledger.effective_host_ai_role !== 'host' || ledger.can_publish_host_endpoint !== true) {
    return {
      allowRemoteInference: false,
      explicitUserDisabled: false,
      denialReason: 'not_ledger_eligible_host',
      policySource: 'default_deny_no_ledger_host',
      remoteChoice: 'unset',
    }
  }
  if (!pairing) {
    return {
      allowRemoteInference: false,
      explicitUserDisabled: false,
      denialReason: 'no_active_internal_sandbox_peer',
      policySource: 'default_deny_no_pairing',
      remoteChoice: 'unset',
    }
  }
  return {
    allowRemoteInference: true,
    explicitUserDisabled: false,
    policySource: 'default_internal_pairing_allow',
    remoteChoice: 'unset',
  }
}

/** Prefer `db`; fall back to sync `getLedgerDb()`; if still no DB, only explicit allow/deny applies. */
export function resolveHostAiRemoteInferencePolicyBestEffort(db?: unknown | null): HostAiRemotePolicyResolution {
  const chosenDb = db ?? getLedgerDb() ?? null
  if (chosenDb) {
    return resolveHostAiRemoteInferencePolicy(chosenDb)
  }
  const pol = getHostInternalInferencePolicy()
  let choice: RemoteHostInferenceUserChoice
  if (pol.remoteHostInferenceUserChoice === 'deny') {
    choice = 'deny'
  } else if (pol.remoteHostInferenceUserChoice === 'allow') {
    choice = 'allow'
  } else if (pol.allowSandboxInference === true) {
    choice = 'allow'
  } else {
    choice = 'unset'
  }
  if (choice === 'deny') {
    return {
      allowRemoteInference: false,
      explicitUserDisabled: true,
      denialReason: 'explicit_user_disabled',
      policySource: 'explicit_user_deny',
      remoteChoice: 'deny',
    }
  }
  if (choice === 'allow') {
    return {
      allowRemoteInference: true,
      explicitUserDisabled: false,
      policySource: 'explicit_user_allow',
      remoteChoice: 'allow',
    }
  }
  return {
    allowRemoteInference: false,
    explicitUserDisabled: false,
    denialReason: 'ledger_db_unavailable',
    policySource: 'default_deny_ledger_unavailable',
    remoteChoice: 'unset',
  }
}

/**
 * After a policy denial, republish timers should run only for recoverable states — never for explicit user disable.
 */
export function hostAiBeapAdPublishShouldRetryAfterPolicyDenial(res: HostAiRemotePolicyResolution): boolean {
  if (res.explicitUserDisabled) return false
  if (res.policySource === 'explicit_user_deny') return false
  return true
}

export function logHostAiRemotePolicyDecision(
  db: unknown | null,
  resolution: HostAiRemotePolicyResolution,
  extra?: Record<string, unknown>,
): void {
  const pol = getHostInternalInferencePolicy()
  const localId = getInstanceId().trim()
  const modeHint = String(getOrchestratorMode().mode)
  if (!db) {
    console.log(
      `[HOST_AI_REMOTE_POLICY_DECISION] ${JSON.stringify({
        effectiveHostAiRole: null,
        can_publish_host_endpoint: null,
        active_internal_ledger_host_peer_sandbox: null,
        samePrincipalPairing: null,
        internalIdentityComplete: null,
        endpointPresent: extra?.endpointPresent ?? null,
        modelsCount: extra?.modelsCount ?? null,
        explicitUserDisabled: resolution.explicitUserDisabled,
        policySource: resolution.policySource,
        policyDefault: resolution.remoteChoice === 'unset',
        allowRemoteInference: resolution.allowRemoteInference,
        denialReason: resolution.denialReason ?? null,
        storedAllowSandboxInference: pol.allowSandboxInference,
        remoteHostInferenceUserChoice: pol.remoteHostInferenceUserChoice,
        ...extra,
      })}`,
    )
    return
  }
  const ledger = getHostAiLedgerRoleSummaryFromDb(db as any, localId, modeHint)
  const pairing = hostHasActiveInternalLedgerHostPeerSandboxFromDb(db)
  console.log(
    `[HOST_AI_REMOTE_POLICY_DECISION] ${JSON.stringify({
      effectiveHostAiRole: ledger.effective_host_ai_role,
      can_publish_host_endpoint: ledger.can_publish_host_endpoint,
      active_internal_ledger_host_peer_sandbox: pairing,
      samePrincipalPairing: pairing,
      internalIdentityComplete: pairing,
      endpointPresent: extra?.endpointPresent ?? null,
      modelsCount: extra?.modelsCount ?? null,
      explicitUserDisabled: resolution.explicitUserDisabled,
      policySource: resolution.policySource,
      policyDefault: resolution.remoteChoice === 'unset',
      allowRemoteInference: resolution.allowRemoteInference,
      denialReason: resolution.denialReason ?? null,
      storedAllowSandboxInference: pol.allowSandboxInference,
      remoteHostInferenceUserChoice: pol.remoteHostInferenceUserChoice,
      ...extra,
    })}`,
  )
}
