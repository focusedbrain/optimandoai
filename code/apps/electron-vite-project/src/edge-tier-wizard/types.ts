/**
 * Renderer-side wizard types (mirrors main-process public state).
 */

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

export interface WizardVmCredentialsPublic {
  host: string
  port: number
  username: string
}

export interface WizardDeployedReplicaPublic {
  host: string
  port: number
  podId: string
  publicKey: string
}

export interface WizardPublicState {
  step: WizardStep
  replicaIndex: number
  totalReplicas: number
  authenticate?: { plan: string; sub: string }
  vmCredentials?: WizardVmCredentialsPublic
  probe?: Record<string, unknown>
  podmanReady?: boolean
  deployedReplicas: WizardDeployedReplicaPublic[]
  lastVerify?: { verified: boolean; reason?: string }
  error?: { step: WizardStep; message: string }
}

export type LogEventKind = 'log' | 'stage' | 'done' | 'error'

export interface LogEvent {
  kind: LogEventKind
  message: string
  stage_name?: string
}
