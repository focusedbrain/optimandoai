/**
 * Wizard IPC-safe types — Phase 4 (P4.4).
 *
 * Types crossing the renderer boundary must never include SSH private keys.
 */

import type { TargetProbe } from '../edge-tier/ssh/types.js'
import type { InstallEvent } from '../edge-tier/ssh/install-podman.js'
import type { DeployEvent } from '../edge-tier/ssh/deploy.js'

export type WizardStep =
  | 'explainer'
  | 'authenticate'
  | 'provide_vm'
  | 'probe_and_prepare'
  | 'replica_count'
  | 'generate_and_deploy'
  | 'verify_and_switch'
  | 'finale'
  | 'complete'

/** VM connection info safe to expose to the renderer. */
export interface WizardVmCredentialsPublic {
  readonly host: string
  readonly port: number
  readonly username: string
}

export interface WizardAuthenticateResult {
  readonly ok: true
  readonly plan: string
  readonly sub: string
}

export interface WizardAuthenticateError {
  readonly ok: false
  readonly error: string
}

export type WizardAuthenticateResponse = WizardAuthenticateResult | WizardAuthenticateError

export interface WizardProbeInput {
  readonly host: string
  readonly port?: number
  readonly user: string
  readonly keyFilePath: string
  readonly passphrase?: Buffer
}

export interface WizardGenerateDeployInput {
  readonly replicaIndex: number
  readonly totalReplicas: number
  readonly operationId: string
}

export interface WizardVerifyInput {
  readonly replicaIndex: number
  readonly nativeBeapRouting?: 'require_edge' | 'direct'
  readonly totalReplicas?: number
}

export interface WizardVerifyResult {
  readonly verified: boolean
  readonly reason?: string
}

export interface WizardDeployedReplicaPublic {
  readonly host: string
  readonly port: number
  readonly podId: string
  readonly publicKey: string
}

export interface WizardState {
  readonly step: WizardStep
  readonly replicaIndex: number
  readonly totalReplicas: number
  readonly authenticate?: { readonly plan: string; readonly sub: string }
  readonly vmCredentials?: WizardVmCredentialsPublic
  readonly probe?: TargetProbe
  readonly podmanReady?: boolean
  readonly deployedReplicas: readonly WizardDeployedReplicaPublic[]
  readonly lastVerify?: WizardVerifyResult
  readonly error?: { readonly step: WizardStep; readonly message: string }
}

export type WizardPublicState = WizardState

export type InstallProgressPayload = {
  readonly operationId: string
  readonly event: InstallEvent
}

export type DeployProgressPayload = {
  readonly operationId: string
  readonly event: DeployEvent
}

/** Main-process only — never sent to renderer. */
export interface WizardVmCredentialsSecret extends WizardVmCredentialsPublic {
  readonly privateKey: Buffer
  readonly passphrase?: Buffer
}
