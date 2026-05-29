/**
 * In-flight one-click Podman setup progress (main process).
 */

export type PodmanSetupRunStep =
  | 'idle'
  | 'installing'
  | 'creating_environment'
  | 'starting'
  | 'verifying'
  | 'failed'
  | 'complete'

export interface PodmanSetupFailure {
  message: string
  detail?: string
}

export interface PodmanSetupRunSnapshot {
  setupRunning: boolean
  setupStep: PodmanSetupRunStep
  setupStepLabel: string
  setupFailure: PodmanSetupFailure | null
}

const STEP_LABELS: Record<Exclude<PodmanSetupRunStep, 'idle' | 'failed' | 'complete'>, string> = {
  installing: 'Installing Podman…',
  creating_environment: 'Setting up container environment…',
  starting: 'Starting Podman…',
  verifying: 'Verifying secure isolation…',
}

let _running = false
let _step: PodmanSetupRunStep = 'idle'
let _failure: PodmanSetupFailure | null = null

export function isPodmanSetupRunActive(): boolean {
  return _running
}

export function beginPodmanSetupRun(): boolean {
  if (_running) return false
  _running = true
  _failure = null
  _step = 'installing'
  return true
}

export function setPodmanSetupRunStep(
  step: Exclude<PodmanSetupRunStep, 'idle' | 'failed' | 'complete'>,
): void {
  if (!_running) return
  _step = step
}

export function failPodmanSetupRun(failure: PodmanSetupFailure): void {
  _failure = failure
  _step = 'failed'
  _running = false
}

export function completePodmanSetupRun(): void {
  _failure = null
  _step = 'complete'
  _running = false
}

export function resetPodmanSetupRunIdle(): void {
  _running = false
  _step = 'idle'
  _failure = null
}

export function getPodmanSetupRunSnapshot(): PodmanSetupRunSnapshot {
  const setupStep = _step
  let setupStepLabel = ''
  if (setupStep === 'installing') setupStepLabel = STEP_LABELS.installing
  else if (setupStep === 'creating_environment') setupStepLabel = STEP_LABELS.creating_environment
  else if (setupStep === 'starting') setupStepLabel = STEP_LABELS.starting
  else if (setupStep === 'verifying') setupStepLabel = STEP_LABELS.verifying
  else if (setupStep === 'failed' && _failure) setupStepLabel = _failure.message
  else if (setupStep === 'complete') setupStepLabel = 'Podman is ready'

  return {
    setupRunning: _running,
    setupStep,
    setupStepLabel,
    setupFailure: _failure,
  }
}

export function setupStepLabelFor(step: Exclude<PodmanSetupRunStep, 'idle' | 'failed' | 'complete'>): string {
  return STEP_LABELS[step]
}
