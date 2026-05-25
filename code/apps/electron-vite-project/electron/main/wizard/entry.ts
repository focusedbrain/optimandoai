/**
 * Wizard entry guard — resume / start-over / add-replica based on edge configuration state.
 */

import {
  clearEdgeTierConfigurationLocally,
  deriveEdgeConfigurationState,
  loadEdgeTierSettings,
  type EdgeConfigurationState,
} from '../edge-tier/settings.js'
import { applyEdgeTierSettingsAndRestartPod, type EdgeTierPodVault } from '../edge-tier/podLifecycle.js'
import { INITIAL_WIZARD_STATE, wizardReducer, type WizardEvent } from './stateMachine.js'
import type { WizardPublicState, WizardState } from './types.js'

export interface WizardEntryContext {
  readonly configurationState: EdgeConfigurationState
  readonly primaryHost: string | null
  readonly replicaCount: number
  readonly wizardStep: WizardPublicState['step']
}

export function buildWizardEntryContext(wizardState: WizardState): WizardEntryContext {
  const settings = loadEdgeTierSettings()
  const configurationState = deriveEdgeConfigurationState(settings)
  const primaryHost = settings.replicas[0]?.host ?? null
  return {
    configurationState,
    primaryHost,
    replicaCount: settings.replicas.length,
    wizardStep: wizardState.step,
  }
}

export function resumeWizardSetup(wizardState: WizardState): WizardState {
  const settings = loadEdgeTierSettings()
  if (settings.replicas.length === 0) {
    return wizardState
  }
  const replicaIndex = Math.max(0, settings.replicas.length - 1)
  return wizardReducer(wizardState, { type: 'RESUME_AT_VERIFY', replicaIndex })
}

export function resumeWizardAddReplica(wizardState: WizardState): WizardState {
  const settings = loadEdgeTierSettings()
  const replicaIndex = settings.replicas.length
  const totalReplicas = replicaIndex + 1
  return wizardReducer(wizardState, {
    type: 'RESUME_ADD_REPLICA',
    replicaIndex,
    totalReplicas,
  })
}

export function resumeWizardReconfigure(wizardState: WizardState): WizardState {
  return wizardReducer(wizardState, { type: 'RESUME_RECONFIGURE' })
}

export async function startOverEdgeSetupLocally(vault: EdgeTierPodVault): Promise<void> {
  const next = clearEdgeTierConfigurationLocally()
  await applyEdgeTierSettingsAndRestartPod(vault, next)
}

export function resetWizardState(): WizardState {
  return { ...INITIAL_WIZARD_STATE }
}
