/**
 * Edge tier wizard shell — six-step flow (P4.5).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LOCAL_POD_REQUIRED_MESSAGE, STEP_LABELS, WIZARD_TITLE } from './copy.js'
import type { LogEvent, WizardPublicState } from './types.js'
import {
  btnDanger,
  btnSecondary,
  wizardCardStyle,
  wizardOverlayStyle,
  wizardPanelStyle,
} from './styles.js'
import { StepAuthenticate } from './steps/StepAuthenticate.js'
import { StepProvideVm, type StepProvideVmFormValues } from './steps/StepProvideVm.js'
import { StepProbeAndPrepare } from './steps/StepProbeAndPrepare.js'
import { StepReplicaCount } from './steps/StepReplicaCount.js'
import { StepGenerateAndDeploy } from './steps/StepGenerateAndDeploy.js'
import { StepVerifyAndSwitch } from './steps/StepVerifyAndSwitch.js'

export interface WizardShellProps {
  onClose: () => void
  /** Injectable bridge for tests. */
  wizard?: WizardBridgeLike
  localPodOk?: boolean
  localPodMessage?: string | null
}

export interface WizardBridgeLike {
  getState: () => Promise<WizardPublicState>
  reset: () => Promise<WizardPublicState>
  authenticate: () => Promise<{ ok: boolean; plan?: string; sub?: string; error?: string; state: WizardPublicState }>
  setVmCredentials: (input: {
    host: string
    port?: number
    user: string
    key: string
    passphrase?: string
  }) => Promise<{ state: WizardPublicState }>
  setReplicaCount: (count: number) => Promise<{ state: WizardPublicState }>
  probe: () => Promise<{ probe: Record<string, unknown>; state: WizardPublicState }>
  installPodman: (input: {
    operationId: string
    probe: Record<string, unknown>
  }) => Promise<{ ok: boolean; state: WizardPublicState }>
  generateAndDeploy: (input: {
    operationId: string
    replicaIndex: number
    totalReplicas: number
  }) => Promise<{ ok: boolean; state: WizardPublicState }>
  verifyAndSwitch: (input: { replicaIndex: number }) => Promise<{
    verified: boolean
    reason?: string
    state: WizardPublicState
  }>
  cancel: (operationId: string) => Promise<{ cancelled: boolean }>
  getLocalPodRequirement?: () => Promise<{ ok: boolean; message: string | null }>
  onInstallPodmanProgress?: (handler: (payload: { operationId: string; event: LogEvent }) => void) => () => void
  onGenerateAndDeployProgress?: (handler: (payload: { operationId: string; event: LogEvent }) => void) => () => void
}

type ShellMode = 'running' | 'cancelled' | 'complete' | 'blocked'

function stepIndex(step: WizardPublicState['step']): number {
  const order: WizardPublicState['step'][] = [
    'authenticate',
    'provide_vm',
    'probe_and_prepare',
    'replica_count',
    'generate_and_deploy',
    'verify_and_switch',
    'complete',
  ]
  const idx = order.indexOf(step)
  return idx >= 0 ? idx : 0
}

function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `op-${Date.now()}`
}

export function WizardShell({
  onClose,
  wizard: wizardProp,
  localPodOk,
  localPodMessage,
}: WizardShellProps) {
  const wizard = wizardProp ?? (typeof window !== 'undefined' ? window.wizard : undefined)

  const [mode, setMode] = useState<ShellMode>('running')
  const [state, setState] = useState<WizardPublicState | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [probing, setProbing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployDone, setDeployDone] = useState(false)
  const [installLogs, setInstallLogs] = useState<LogEvent[]>([])
  const [deployLogs, setDeployLogs] = useState<LogEvent[]>([])
  const [replicaCountDraft, setReplicaCountDraft] = useState(2)
  const [verifyConfirmed, setVerifyConfirmed] = useState(false)
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null)
  const [verifyReason, setVerifyReason] = useState<string | undefined>()

  const operationIdRef = useRef<string | null>(null)
  const deployAttemptedRef = useRef(false)

  const syncState = useCallback((next: WizardPublicState) => {
    setState(next)
    if (next.step === 'complete') setMode('complete')
  }, [])

  const ensureWizard = useCallback(() => {
    if (!wizard) throw new Error('Wizard IPC unavailable')
    return wizard
  }, [wizard])

  useEffect(() => {
    if (!wizard) {
      setLocalError('Wizard IPC unavailable')
      setMode('blocked')
      return
    }
    void (async () => {
      if (localPodOk === false) {
        setMode('blocked')
        setLocalError(localPodMessage ?? LOCAL_POD_REQUIRED_MESSAGE)
        return
      }
      if (localPodOk === undefined && wizard.getLocalPodRequirement) {
        const req = await wizard.getLocalPodRequirement()
        if (!req.ok) {
          setMode('blocked')
          setLocalError(req.message ?? LOCAL_POD_REQUIRED_MESSAGE)
          return
        }
      }
      const s = await wizard.getState()
      syncState(s)
    })().catch((err) => {
      setLocalError(err instanceof Error ? err.message : String(err))
      setMode('blocked')
    })
  }, [wizard, localPodOk, localPodMessage, syncState])

  useEffect(() => {
    if (!wizard?.onInstallPodmanProgress) return
    return wizard.onInstallPodmanProgress(({ event }) => {
      setInstallLogs((prev) => [...prev, event])
    })
  }, [wizard])

  useEffect(() => {
    if (!wizard?.onGenerateAndDeployProgress) return
    return wizard.onGenerateAndDeployProgress(({ event }) => {
      setDeployLogs((prev) => [...prev, event])
      if (event.kind === 'done') setDeployDone(true)
    })
  }, [wizard])

  const handleCancelOperation = useCallback(async () => {
    const op = operationIdRef.current
    if (op && wizard?.cancel) await wizard.cancel(op)
    operationIdRef.current = null
    setInstalling(false)
    setDeploying(false)
    setMode('cancelled')
  }, [wizard])

  const handleStartOver = useCallback(async () => {
    if (!wizard) return
    setInstallLogs([])
    setDeployLogs([])
    setDeployDone(false)
    setVerifyResult(null)
    setVerifyReason(undefined)
    setVerifyConfirmed(false)
    setLocalError(null)
    const s = await wizard.reset()
    syncState(s)
    setMode('running')
  }, [wizard, syncState])

  const handleAuthenticate = useCallback(async () => {
    try {
      const w = ensureWizard()
      setLoading(true)
      setLocalError(null)
      const result = await w.authenticate()
      if (!result.ok) {
        setLocalError(result.error ?? 'Authentication failed')
      } else {
        syncState(result.state)
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [ensureWizard, syncState])

  const handleVmSubmit = useCallback(
    async (values: StepProvideVmFormValues) => {
      try {
        const w = ensureWizard()
        setLoading(true)
        setLocalError(null)
        const port = Number(values.port)
        const { state: next } = await w.setVmCredentials({
          host: values.host.trim(),
          port: Number.isFinite(port) ? port : 22,
          user: values.username.trim(),
          key: values.key,
          passphrase: values.passphrase || undefined,
        })
        syncState(next)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [ensureWizard, syncState],
  )

  const handleProbe = useCallback(async () => {
    try {
      const w = ensureWizard()
      setProbing(true)
      setLocalError(null)
      const { state: next } = await w.probe()
      syncState(next)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setProbing(false)
    }
  }, [ensureWizard, syncState])

  useEffect(() => {
    if (state?.step === 'probe_and_prepare' && !state.probe && !probing) {
      void handleProbe()
    }
  }, [state?.step, state?.probe, probing, handleProbe])

  const handleInstallPodman = useCallback(async () => {
    if (!state?.probe) return
    try {
      const w = ensureWizard()
      const operationId = newOperationId()
      operationIdRef.current = operationId
      setInstalling(true)
      setInstallLogs([])
      setLocalError(null)
      const { state: next } = await w.installPodman({ operationId, probe: state.probe })
      syncState(next)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(false)
      operationIdRef.current = null
    }
  }, [ensureWizard, state?.probe, syncState])

  const handleReplicaSubmit = useCallback(async () => {
    try {
      const w = ensureWizard()
      setLoading(true)
      setLocalError(null)
      const { state: next } = await w.setReplicaCount(replicaCountDraft)
      syncState(next)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [ensureWizard, replicaCountDraft, syncState])

  const handleDeploy = useCallback(async () => {
    if (!state) return
    try {
      const w = ensureWizard()
      const operationId = newOperationId()
      operationIdRef.current = operationId
      setDeploying(true)
      setDeployDone(false)
      setDeployLogs([])
      setLocalError(null)
      const { state: next } = await w.generateAndDeploy({
        operationId,
        replicaIndex: state.replicaIndex,
        totalReplicas: state.totalReplicas,
      })
      syncState(next)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeploying(false)
      operationIdRef.current = null
    }
  }, [ensureWizard, state, syncState])

  useEffect(() => {
    if (state?.step !== 'generate_and_deploy') {
      deployAttemptedRef.current = false
      return
    }
    if (deployAttemptedRef.current || deploying || deployDone) return
    deployAttemptedRef.current = true
    void handleDeploy()
  }, [state?.step, deploying, deployDone, handleDeploy])

  useEffect(() => {
    setDeployDone(false)
    setDeployLogs([])
    setVerifyResult(null)
    setVerifyReason(undefined)
    setVerifyConfirmed(false)
  }, [state?.replicaIndex])

  const handleVerify = useCallback(async () => {
    if (!state) return
    try {
      const w = ensureWizard()
      setLoading(true)
      setLocalError(null)
      const result = await w.verifyAndSwitch({ replicaIndex: state.replicaIndex })
      setVerifyResult(result.verified)
      setVerifyReason(result.reason)
      syncState(result.state)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
      setVerifyResult(false)
    } finally {
      setLoading(false)
    }
  }, [ensureWizard, state, syncState])

  const showCancel =
    mode === 'running' &&
    state?.step !== 'complete' &&
    !(state?.step === 'verify_and_switch' && verifyResult === true)

  const progressIdx = useMemo(() => (state ? stepIndex(state.step) : 0), [state])

  const stepError = localError ?? state?.error?.message ?? null

  return (
    <div style={wizardOverlayStyle} data-testid="edge-tier-wizard">
      <div style={{ ...wizardCardStyle, ...wizardPanelStyle }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>{WIZARD_TITLE}</h1>
          <button type="button" style={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>

        {mode === 'blocked' && (
          <div data-testid="wizard-blocked">
            <p style={{ color: '#fecaca' }}>{localError ?? LOCAL_POD_REQUIRED_MESSAGE}</p>
            <button type="button" style={btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {mode === 'cancelled' && (
          <div data-testid="wizard-cancelled">
            <h2 style={{ fontSize: 16 }}>Wizard cancelled</h2>
            <p style={{ color: '#94a3b8' }}>The current operation was stopped.</p>
            <button type="button" style={btnSecondary} onClick={() => void handleStartOver()}>
              Start over
            </button>
          </div>
        )}

        {mode === 'complete' && (
          <div data-testid="wizard-complete">
            <h2 style={{ fontSize: 16 }}>Edge tier is ready</h2>
            <p style={{ color: '#94a3b8' }}>
              All replicas are deployed and verified. You can manage them from the edge tier panel.
            </p>
            <button type="button" style={btnSecondary} onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {mode === 'running' && state && (
          <>
            <div
              data-testid="wizard-progress"
              style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}
            >
              {STEP_LABELS.map((label, i) => (
                <div
                  key={label}
                  style={{
                    fontSize: 11,
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: i <= progressIdx ? '#312e81' : '#1e293b',
                    color: i <= progressIdx ? '#e0e7ff' : '#64748b',
                    border: '1px solid #334155',
                  }}
                >
                  {i + 1}. {label}
                </div>
              ))}
            </div>

            {state.step === 'authenticate' && (
              <StepAuthenticate
                loading={loading}
                error={stepError}
                plan={state.authenticate?.plan}
                sub={state.authenticate?.sub}
                onAuthenticate={() => void handleAuthenticate()}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {state.step === 'provide_vm' && (
              <StepProvideVm
                replicaIndex={state.replicaIndex}
                totalReplicas={state.totalReplicas}
                error={stepError}
                loading={loading}
                initial={state.vmCredentials ? {
                  host: state.vmCredentials.host,
                  port: String(state.vmCredentials.port),
                  username: state.vmCredentials.username,
                } : undefined}
                onSubmit={(v) => void handleVmSubmit(v)}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {state.step === 'probe_and_prepare' && (
              <StepProbeAndPrepare
                loading={loading}
                probing={probing}
                installing={installing}
                error={stepError}
                probe={state.probe ?? null}
                podmanReady={state.podmanReady === true}
                installLogs={installLogs}
                onRunProbe={() => void handleProbe()}
                onInstallPodman={() => void handleInstallPodman()}
                onContinue={() => {
                  /* state machine advances via IPC after podman ready */
                }}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {state.step === 'replica_count' && (
              <StepReplicaCount
                value={replicaCountDraft}
                error={stepError}
                loading={loading}
                onChange={setReplicaCountDraft}
                onSubmit={() => void handleReplicaSubmit()}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {state.step === 'generate_and_deploy' && (
              <StepGenerateAndDeploy
                replicaIndex={state.replicaIndex}
                totalReplicas={state.totalReplicas}
                deploying={deploying}
                done={deployDone || state.deployedReplicas.length > state.replicaIndex}
                error={stepError}
                deployLogs={deployLogs}
                onDeploy={() => void handleDeploy()}
                onContinue={() => syncState({ ...state, step: 'verify_and_switch' })}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {state.step === 'verify_and_switch' && (
              <StepVerifyAndSwitch
                loading={loading}
                error={stepError}
                verified={verifyResult}
                reason={verifyReason}
                confirmed={verifyConfirmed}
                onConfirmUnderstand={() => setVerifyConfirmed((v) => !v)}
                onVerify={() => void handleVerify()}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {showCancel && (
              <div style={{ marginTop: 20, borderTop: '1px solid #334155', paddingTop: 12 }}>
                <button type="button" style={btnDanger} onClick={() => void handleCancelOperation()}>
                  Cancel current operation
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function EdgeTierWizardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <WizardShell onClose={onClose} />
}
