/**
 * Step 5 — Generate identity and deploy.
 */

import { LiveLogPanel } from '../LiveLogPanel.js'
import type { LogEvent } from '../types.js'
import { btnPrimary } from '../styles.js'
import { StepErrorActions, StepLoading } from './StepCommon.js'

export interface StepGenerateAndDeployProps {
  replicaIndex: number
  totalReplicas: number
  deploying: boolean
  done: boolean
  error: string | null
  deployLogs: LogEvent[]
  onDeploy: () => void
  onContinue: () => void
  onCancelWizard: () => void
}

export function StepGenerateAndDeploy({
  replicaIndex,
  totalReplicas,
  deploying,
  done,
  error,
  deployLogs,
  onDeploy,
  onContinue,
  onCancelWizard,
}: StepGenerateAndDeployProps) {
  return (
    <div data-testid="wizard-step-deploy">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>
        Deploy edge pod
        <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 14 }}>
          {' '}
          — Replica {replicaIndex + 1} of {totalReplicas}
        </span>
      </h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        Generates an Ed25519 keypair locally, obtains SSO attestation, and deploys the REMOTE_EDGE
        pod over SSH. Your edge private key never touches the VM disk.
      </p>
      <StepErrorActions error={error} onRetry={onDeploy} onCancelWizard={onCancelWizard} />
      {!deploying && !done && (
        <button type="button" style={btnPrimary} onClick={onDeploy}>
          Start deploy
        </button>
      )}
      {deploying && (
        <>
          <StepLoading message="Deploying…" />
          <LiveLogPanel events={deployLogs} />
        </>
      )}
      {done && !deploying && (
        <button type="button" style={btnPrimary} data-testid="wizard-deploy-continue" onClick={onContinue}>
          Continue to verification
        </button>
      )}
    </div>
  )
}
