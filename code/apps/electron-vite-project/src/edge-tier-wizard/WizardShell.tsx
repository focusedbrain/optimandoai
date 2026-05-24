/**
 * Edge tier wizard shell — eight-step flow (P4.5.9).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { LOCAL_POD_REQUIRED_MESSAGE, STEP_LABELS, WIZARD_TITLE, WIZARD_UPGRADE_URL } from './copy.js'
import { openAppExternalUrl } from '../lib/openAppExternalUrl.js'
import { WRDESK_OPEN_EMAIL_ACCOUNTS_SETTINGS } from '../lib/wrdeskUiEvents.js'
import type { LogEvent, WizardPublicState } from './types.js'
import {
  btnDanger,
  btnSecondary,
  wizardCardStyle,
  wizardOverlayStyle,
  wizardPanelStyle,
} from './styles.js'
import { StepExplainer } from './steps/StepExplainer.js'
import { StepAuthenticate } from './steps/StepAuthenticate.js'
import { StepProvideVm, type StepProvideVmFormValues } from './steps/StepProvideVm.js'
import { StepProbeAndPrepare } from './steps/StepProbeAndPrepare.js'
import { StepReplicaCount } from './steps/StepReplicaCount.js'
import { StepGenerateAndDeploy } from './steps/StepGenerateAndDeploy.js'
import { StepVerifyAndSwitch } from './steps/StepVerifyAndSwitch.js'
import type { NativeBeapRoutingOption } from './copy/nativeBeapRoutingCopy.js'
import { StepFinale } from './steps/StepFinale.js'
import { HostKeyMismatchModal } from '../edge-tier-dashboard/HostKeyMismatchModal.js'
import { extractHostKeyMismatch, type HostKeyMismatchPayload } from '../edge-tier-dashboard/hostKeyMismatchTypes.js'

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
  refreshTier: () => Promise<{ tier: string; isPaidTier: boolean }>
  continueFromExplainer: () => Promise<{ state: WizardPublicState }>
  authenticate: () => Promise<{ ok: boolean; plan?: string; sub?: string; error?: string; state: WizardPublicState }>
  setVmCredentials: (input: {
    host: string
    port?: number
    user: string
    keyFilePath: string
    passphrase?: string
  }) => Promise<{ state: WizardPublicState }>
  pickSshKeyFile: () => Promise<{ canceled: boolean; filePath?: string }>
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
  verifyAndSwitch: (input: {
    replicaIndex: number
    nativeBeapRouting?: 'require_edge' | 'direct'
  }) => Promise<{
    verified: boolean
    reason?: string
    state: WizardPublicState
  }>
  cancel: (operationId: string) => Promise<{ cancelled: boolean }>
  getLocalPodRequirement?: () => Promise<{ ok: boolean; message: string | null }>
  onInstallPodmanProgress?: (handler: (payload: { operationId: string; event: LogEvent }) => void) => () => void
  onGenerateAndDeployProgress?: (handler: (payload: { operationId: string; event: LogEvent }) => void) => () => void
}

type ShellMode = 'running' | 'cancelled' | 'blocked'

function stepIndex(step: WizardPublicState['step']): number {
  const order: WizardPublicState['step'][] = [
    'explainer',
    'authenticate',
    'provide_vm',
    'probe_and_prepare',
    'replica_count',
    'generate_and_deploy',
    'verify_and_switch',
    'finale',
    'complete',
  ]
  if (step === 'complete') return order.indexOf('finale')
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
  const [nativeBeapRouting, setNativeBeapRouting] = useState<NativeBeapRoutingOption>('direct')
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null)
  const [verifyReason, setVerifyReason] = useState<string | undefined>()
  const [currentTier, setCurrentTier] = useState<string>('free')
  const [hostKeyMismatch, setHostKeyMismatch] = useState<{
    payload: HostKeyMismatchPayload
    retry: () => Promise<void>
  } | null>(null)
  const [hostKeyTrustBusy, setHostKeyTrustBusy] = useState(false)
  const [waitingForUpgrade, setWaitingForUpgrade] = useState(false)

  const operationIdRef = useRef<string | null>(null)
  const deployAttemptedRef = useRef(false)

  const syncState = useCallback((next: WizardPublicState) => {
    setState(next)
  }, [])

  const ensureWizard = useCallback(() => {
    if (!wizard) throw new Error('Wizard IPC unavailable')
    return wizard
  }, [wizard])

  const loadAuthTier = useCallback(async () => {
    if (typeof window === 'undefined' || !window.auth?.getStatus) return
    try {
      const status = await window.auth.getStatus()
      if (status?.tier) setCurrentTier(String(status.tier))
    } catch {
      /* keep last known tier */
    }
  }, [])

  useEffect(() => {
    void loadAuthTier()
  }, [loadAuthTier])

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
    setWaitingForUpgrade(false)
    void loadAuthTier()
    const s = await wizard.reset()
    syncState(s)
    setMode('running')
  }, [wizard, syncState, loadAuthTier])

  const handleContinueFromExplainer = useCallback(async () => {
    try {
      const w = ensureWizard()
      setLocalError(null)
      const { state: next } = await w.continueFromExplainer()
      syncState(next)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    }
  }, [ensureWizard, syncState])

  const handleUpgradeNow = useCallback(async () => {
    setWaitingForUpgrade(true)
    setLocalError(null)
    await openAppExternalUrl(WIZARD_UPGRADE_URL)
  }, [])

  const handleRefreshTier = useCallback(async (): Promise<{ tier: string }> => {
    try {
      const w = ensureWizard()
      setLocalError(null)
      const result = await w.refreshTier()
      setCurrentTier(result.tier)
      if (result.isPaidTier) {
        setWaitingForUpgrade(false)
        const { state: next } = await w.continueFromExplainer()
        syncState(next)
      }
      return { tier: result.tier }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [ensureWizard, syncState])

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
      const w = ensureWizard()
      setLoading(true)
      setLocalError(null)
      try {
        const port = Number(values.port)
        const { state: next } = await w.setVmCredentials({
          host: values.host.trim(),
          port: Number.isFinite(port) ? port : 22,
          user: values.username.trim(),
          keyFilePath: values.keyFilePath,
          passphrase: values.passphrase || undefined,
        })
        syncState(next)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : String(err))
        throw err
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
      const result = await w.probe()
      const mismatch = extractHostKeyMismatch(result)
      if (mismatch) {
        setHostKeyMismatch({
          payload: mismatch,
          retry: handleProbe,
        })
        if (result.state) syncState(result.state as WizardPublicState)
        return
      }
      if (result.state) syncState(result.state as WizardPublicState)
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
      const result = await w.verifyAndSwitch({
        replicaIndex: state.replicaIndex,
        nativeBeapRouting,
      })
      setVerifyResult(result.verified)
      setVerifyReason(result.reason)
      syncState(result.state)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
      setVerifyResult(false)
    } finally {
      setLoading(false)
    }
  }, [ensureWizard, state, syncState, nativeBeapRouting])

  const handleOpenEmailAccounts = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WRDESK_OPEN_EMAIL_ACCOUNTS_SETTINGS))
    }
    onClose()
  }, [onClose])

  const showCancel =
    mode === 'running' &&
    state?.step !== 'finale' &&
    state?.step !== 'complete' &&
    !(state?.step === 'verify_and_switch' && verifyResult === true)

  const progressIdx = useMemo(() => (state ? stepIndex(state.step) : 0), [state])

  const stepError = localError ?? state?.error?.message ?? null

  const handleTrustHostKey = useCallback(async () => {
    if (!hostKeyMismatch) return
    setHostKeyTrustBusy(true)
    try {
      await window.edgeTier.removeKnownHost({
        host: hostKeyMismatch.payload.host,
        port: hostKeyMismatch.payload.port,
      })
      const retry = hostKeyMismatch.retry
      setHostKeyMismatch(null)
      await retry()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err))
    } finally {
      setHostKeyTrustBusy(false)
    }
  }, [hostKeyMismatch])

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

            {state.step === 'explainer' && (
              <StepExplainer
                tier={currentTier}
                waitingForUpgrade={waitingForUpgrade}
                onContinue={() => void handleContinueFromExplainer()}
                onUpgrade={() => void handleUpgradeNow()}
                onRefreshTier={handleRefreshTier}
              />
            )}

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
                onPickKeyFile={() => ensureWizard().pickSshKeyFile()}
                onSubmit={(v) => handleVmSubmit(v)}
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
                nativeBeapRouting={nativeBeapRouting}
                onNativeBeapRoutingChange={setNativeBeapRouting}
                onConfirmUnderstand={() => setVerifyConfirmed((v) => !v)}
                onVerify={() => void handleVerify()}
                onCancelWizard={() => void handleCancelOperation()}
              />
            )}

            {(state.step === 'finale' || state.step === 'complete') && (
              <StepFinale
                totalReplicas={state.totalReplicas}
                onOpenEmailAccounts={handleOpenEmailAccounts}
                onLater={onClose}
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
      {hostKeyMismatch && (
        <HostKeyMismatchModal
          payload={hostKeyMismatch.payload}
          busy={hostKeyTrustBusy}
          onTrustNewKey={() => void handleTrustHostKey()}
          onCancel={() => setHostKeyMismatch(null)}
        />
      )}
    </div>
  )
}

export function EdgeTierWizardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <WizardShell onClose={onClose} />
}
