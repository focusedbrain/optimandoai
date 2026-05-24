/**
 * Edge deployment wizard state machine — Phase 4 (P4.4).
 */

import type { TargetProbe } from '../edge-tier/ssh/types.js'
import type {
  WizardState,
  WizardStep,
  WizardVmCredentialsPublic,
  WizardDeployedReplicaPublic,
  WizardVerifyResult,
} from './types.js'

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 'authenticate',
  replicaIndex: 0,
  totalReplicas: 1,
  deployedReplicas: [],
}

export type WizardEvent =
  | { readonly type: 'RESET' }
  | { readonly type: 'AUTH_SUCCESS'; readonly plan: string; readonly sub: string }
  | { readonly type: 'AUTH_FAILED'; readonly message: string }
  | { readonly type: 'VM_CREDENTIALS_SET'; readonly credentials: WizardVmCredentialsPublic }
  | { readonly type: 'PROBE_SUCCESS'; readonly probe: TargetProbe }
  | { readonly type: 'PROBE_FAILED'; readonly message: string }
  | { readonly type: 'PODMAN_READY' }
  | { readonly type: 'PODMAN_INSTALL_FAILED'; readonly message: string }
  | { readonly type: 'REPLICA_COUNT_SET'; readonly count: number }
  | { readonly type: 'DEPLOY_SUCCESS'; readonly replica: WizardDeployedReplicaPublic }
  | { readonly type: 'DEPLOY_FAILED'; readonly message: string }
  | { readonly type: 'VERIFY_SUCCESS' }
  | { readonly type: 'VERIFY_FAILED'; readonly message: string }

function withError(state: WizardState, step: WizardStep, message: string): WizardState {
  return { ...state, error: { step, message } }
}

function clearError(state: WizardState): WizardState {
  const { error: _removed, ...rest } = state
  return rest
}

export function wizardReducer(state: WizardState, event: WizardEvent): WizardState {
  switch (event.type) {
    case 'RESET':
      return { ...INITIAL_WIZARD_STATE }

    case 'AUTH_SUCCESS':
      return clearError({
        ...state,
        step: 'provide_vm',
        authenticate: { plan: event.plan, sub: event.sub },
      })

    case 'AUTH_FAILED':
      return withError(state, 'authenticate', event.message)

    case 'VM_CREDENTIALS_SET':
      return clearError({
        ...state,
        step: 'probe_and_prepare',
        vmCredentials: event.credentials,
        probe: undefined,
        podmanReady: undefined,
      })

    case 'PROBE_SUCCESS': {
      const podmanReady =
        event.probe.podman_installed && event.probe.verdict.ok
          ? true
          : state.podmanReady
      return clearError({
        ...state,
        step: 'probe_and_prepare',
        probe: event.probe,
        podmanReady,
      })
    }

    case 'PROBE_FAILED':
      return withError(state, 'probe_and_prepare', event.message)

    case 'PODMAN_READY': {
      const next = clearError({ ...state, podmanReady: true })
      if (state.replicaIndex === 0) {
        return { ...next, step: 'replica_count' }
      }
      return { ...next, step: 'generate_and_deploy' }
    }

    case 'PODMAN_INSTALL_FAILED':
      return withError(state, 'probe_and_prepare', event.message)

    case 'REPLICA_COUNT_SET':
      return clearError({
        ...state,
        totalReplicas: event.count,
        step: 'generate_and_deploy',
      })

    case 'DEPLOY_SUCCESS':
      return clearError({
        ...state,
        step: 'verify_and_switch',
        deployedReplicas: [...state.deployedReplicas, event.replica],
      })

    case 'DEPLOY_FAILED':
      return withError(state, 'generate_and_deploy', event.message)

    case 'VERIFY_SUCCESS': {
      const verified: WizardVerifyResult = { verified: true }
      const nextIndex = state.replicaIndex + 1
      if (nextIndex < state.totalReplicas) {
        return clearError({
          ...state,
          replicaIndex: nextIndex,
          step: 'provide_vm',
          vmCredentials: undefined,
          probe: undefined,
          podmanReady: undefined,
          lastVerify: verified,
        })
      }
      return clearError({
        ...state,
        step: 'complete',
        lastVerify: verified,
      })
    }

    case 'VERIFY_FAILED':
      return {
        ...withError(state, 'verify_and_switch', event.message),
        lastVerify: { verified: false, reason: event.message },
      }

    default:
      return state
  }
}
