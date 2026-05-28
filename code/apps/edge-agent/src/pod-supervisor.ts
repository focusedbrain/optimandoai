/**
 * Agent-local pod supervisor (Stream C — PR5), adapted from Stream A host supervisor.
 */

import type { AgentStorage } from './storage.js'
import {
  REMOTE_EDGE_SUPERVISOR_CONTAINERS,
  type RemoteEdgeContainerRole,
  type RemoteEdgeContainerSpec,
} from './pod-containers.js'
import { REMOTE_EDGE_POD_NAME } from './pod-deploy.js'
import {
  inspectContainerState,
  probeContainerHealthExec,
  probeIngestorHealthHost,
  restartContainer,
  runPodman,
} from './podman.js'
import { pickupQuarantineEntries, quarantineSigningSecretForStorage } from './quarantine-pickup.js'

import {
  AGENT_MAX_REPLACEMENTS,
  AGENT_REPLACEMENT_WINDOW_MS,
  checkReplacementAllowed,
  clearReplacementBudget,
  recordReplacement,
} from './pod-replacement-budget.js'
import { emitAgentLogEvent } from './log-stream/emit.js'

export { AGENT_MAX_REPLACEMENTS, AGENT_REPLACEMENT_WINDOW_MS }

export const AGENT_SUPERVISOR_PROBE_INTERVAL_MS = 5_000
export const AGENT_SUPERVISOR_PROBE_TIMEOUT_MS = 3_000
export const AGENT_SUPERVISOR_STUCK_THRESHOLD = 3

export type AgentSupervisorState = 'healthy' | 'replacement_exhausted' | 'halted_by_anomaly'

function isEscalationReportFilename(filename: string): boolean {
  return filename.startsWith('escalation-') && filename.endsWith('.json')
}

const consecutiveFailures = new Map<string, number>()
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _replacing = new Set<string>()
let _supervisorState: AgentSupervisorState = 'healthy'
let _haltReason: string | null = null

let _onTeardown: ((kind: AgentSupervisorState, reason: string) => Promise<void>) | null = null
let _storage: AgentStorage | null = null

function probeKey(role: RemoteEdgeContainerRole): string {
  return `${REMOTE_EDGE_POD_NAME}:${role}`
}

function emit(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'info', source: 'pod-supervisor', event, ...fields }))
}

export function getAgentSupervisorState(): AgentSupervisorState {
  return _supervisorState
}

export function getAgentSupervisorHaltReason(): string | null {
  return _haltReason
}

export function clearAgentSupervisorForRetry(): void {
  _supervisorState = 'healthy'
  _haltReason = null
  clearReplacementBudget()
  consecutiveFailures.clear()
}

export { clearReplacementBudget } from './pod-replacement-budget.js'

function recordProbeOutcome(role: RemoteEdgeContainerRole, healthy: boolean): boolean {
  const key = probeKey(role)
  if (healthy) {
    consecutiveFailures.delete(key)
    return false
  }
  const next = (consecutiveFailures.get(key) ?? 0) + 1
  consecutiveFailures.set(key, next)
  return next >= AGENT_SUPERVISOR_STUCK_THRESHOLD
}

/** Test hook: stuck-health counter without podman. */
export function recordProbeOutcomeForTest(
  role: RemoteEdgeContainerRole,
  healthy: boolean,
): boolean {
  return recordProbeOutcome(role, healthy)
}

async function probeSpec(spec: RemoteEdgeContainerSpec): Promise<boolean> {
  if (spec.hostLoopback) {
    return probeIngestorHealthHost(spec.port, AGENT_SUPERVISOR_PROBE_TIMEOUT_MS)
  }
  return probeContainerHealthExec(spec.containerName, spec.port, AGENT_SUPERVISOR_PROBE_TIMEOUT_MS)
}

async function listEscalationReports(containerName: string): Promise<string[]> {
  const result = await runPodman([
    'exec',
    containerName,
    'sh',
    '-c',
    'ls /tmp/diagnostic-reports/escalation-*.json 2>/dev/null || true',
  ])
  if (result.code !== 0) return []
  return result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((n) => n && isEscalationReportFilename(n.split('/').pop() ?? n))
}

async function readEscalationReport(containerName: string, filename: string): Promise<string | null> {
  const result = await runPodman([
    'exec',
    containerName,
    'cat',
    `/tmp/diagnostic-reports/${filename}`,
  ])
  if (result.code !== 0) return null
  return result.stdout
}

export function startAgentPodSupervisor(
  storage: AgentStorage,
  onTeardown: (kind: AgentSupervisorState, reason: string) => Promise<void>,
): void {
  stopAgentPodSupervisor()
  _storage = storage
  _onTeardown = onTeardown
  _supervisorState = 'healthy'
  _haltReason = null
  emit('supervisor_started', { pod: REMOTE_EDGE_POD_NAME })

  void pollOnce()
  _pollTimer = setInterval(() => void pollOnce(), AGENT_SUPERVISOR_PROBE_INTERVAL_MS)
  _pollTimer.unref?.()
}

export function stopAgentPodSupervisor(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
  _replacing.clear()
  _storage = null
  _onTeardown = null
}

async function pollOnce(): Promise<void> {
  if (_supervisorState !== 'healthy' || !_storage) return
  const nowMs = Date.now()

  for (const spec of REMOTE_EDGE_SUPERVISOR_CONTAINERS) {
    await pollContainer(spec, nowMs)
  }

  const dep = REMOTE_EDGE_SUPERVISOR_CONTAINERS.find((s) => s.role === 'depackager')
  if (dep) {
    try {
      const secret = await quarantineSigningSecretForStorage(_storage)
      const n = await pickupQuarantineEntries(_storage, dep.containerName, secret)
      if (n > 0) emit('quarantine_pickup', { count: n })
    } catch {
      /* non-fatal */
    }
  }
}

async function pollContainer(spec: RemoteEdgeContainerSpec, nowMs: number): Promise<void> {
  if (_supervisorState !== 'healthy') return
  const lockKey = probeKey(spec.role)
  if (_replacing.has(lockKey)) return

  const state = await inspectContainerState(spec.containerName)
  if (state === 'running') {
    const healthy = await probeSpec(spec)
    if (recordProbeOutcome(spec.role, healthy)) {
      emit('stuck_health', { role: spec.role })
      emitAgentLogEvent({
        level: 'warn',
        source: 'supervisor',
        event_code: 'container_health_failed',
        message: 'Container health probe failed repeatedly.',
        fields: { role: spec.role },
      })
      await replaceContainer(spec, nowMs, 'stuck_health')
    }
    return
  }

  if (state === 'exited' || state === 'missing') {
    emit('container_not_running', { role: spec.role, state })
    emitAgentLogEvent({
      level: 'warn',
      source: 'supervisor',
      event_code: 'container_health_failed',
      message: 'Container is not running.',
      fields: { role: spec.role, state },
    })
    await replaceContainer(spec, nowMs, state)
  }
}

async function replaceContainer(
  spec: RemoteEdgeContainerSpec,
  nowMs: number,
  reason: string,
): Promise<void> {
  const lockKey = probeKey(spec.role)
  if (_replacing.has(lockKey)) return

  const allowance = checkReplacementAllowed(spec.role, nowMs)
  if (!allowance.allowed) {
    if (allowance.newlyExhausted) {
      emitAgentLogEvent({
        level: 'error',
        source: 'supervisor',
        event_code: 'replacement_budget_consumed',
        message: 'Container replacement budget was consumed.',
        fields: { role: spec.role, count: AGENT_MAX_REPLACEMENTS },
      })
      emitAgentLogEvent({
        level: 'critical',
        source: 'supervisor',
        event_code: 'replacement_exhausted',
        message: 'Verification pod recovery is paused until user action.',
        fields: { role: spec.role },
      })
      await teardown('replacement_exhausted', `Recovery paused after ${AGENT_MAX_REPLACEMENTS} replacements for ${spec.role}.`)
    }
    return
  }

  _replacing.add(lockKey)
  try {
    const names = await listEscalationReports(spec.containerName)
    for (const name of names) {
      await readEscalationReport(spec.containerName, name)
      emitAgentLogEvent({
        level: 'critical',
        source: 'supervisor',
        event_code: 'escalation_received',
        message: 'Serious verification anomaly reported by a pod container.',
        fields: { report_id: name, role: spec.role },
      })
      emitAgentLogEvent({
        level: 'critical',
        source: 'supervisor',
        event_code: 'pod_halted_by_anomaly',
        message: 'Verification pod halted due to a serious anomaly.',
        fields: { report_id: name, role: spec.role },
      })
      await teardown(
        'halted_by_anomaly',
        `Serious anomaly during verification (${name}).`,
      )
      return
    }

    const ok = await restartContainer(spec.containerName)
    if (ok) {
      recordReplacement(spec.role, nowMs)
      consecutiveFailures.delete(lockKey)
      emit('container_replaced', { role: spec.role, reason })
      emitAgentLogEvent({
        level: 'info',
        source: 'supervisor',
        event_code: 'container_replaced',
        message: 'A pod container was replaced after a health failure.',
        fields: { role: spec.role, reason },
      })
    } else {
      emit('replace_failed', { role: spec.role, reason })
    }
  } finally {
    _replacing.delete(lockKey)
  }
}

async function teardown(kind: AgentSupervisorState, reason: string): Promise<void> {
  emit('teardown', { kind, reason })
  _supervisorState = kind
  _haltReason = reason
  const storage = _storage
  const onTeardown = _onTeardown
  stopAgentPodSupervisor()

  if (storage) {
    const state = await storage.loadState()
    await storage.saveState({
      ...state,
      haltedByAnomaly: kind === 'halted_by_anomaly',
      haltReason: reason,
    })
  }

  if (onTeardown) {
    await onTeardown(kind, reason)
  }
}

/** Test hook: one supervisor poll cycle without starting the interval timer. */
export async function pollAgentPodSupervisorOnceForTest(
  storage: AgentStorage,
  onTeardown: (kind: AgentSupervisorState, reason: string) => Promise<void>,
): Promise<void> {
  _storage = storage
  _onTeardown = onTeardown
  _supervisorState = 'healthy'
  await pollOnce()
}

export function _resetAgentSupervisorForTest(): void {
  stopAgentPodSupervisor()
  clearAgentSupervisorForRetry()
  consecutiveFailures.clear()
}
