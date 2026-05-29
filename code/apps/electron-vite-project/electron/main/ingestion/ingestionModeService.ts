/**
 * Runtime ingestion mode service — gathers probe inputs and resolves mode.
 */

import { EventEmitter } from 'node:events'

import { loadEdgeTierSettings, type EdgeTierSettings } from '../edge-tier/settings.js'
import { isPodmanVerifiedReady } from '../local-pod/podStatus.js'
import {
  resolveIngestionMode,
  resolveHostPodVariant,
  resolveIngestionBlockedReason,
  shouldWaitForHostPod,
  isBlockedWithoutGeneralConnectivity,
  type IngestionMode,
  type IngestionBlockedReason,
  type HostPodModeVariant,
  type ResolverInputs,
} from './modeResolver.js'
import { isSessionHostFallbackAuthorized } from './sessionHostFallback.js'
import { getProbeSnapshot, runAllProbes, type ProbeSnapshot } from './edgeProbe.js'
import { holdQueueSize } from './holdQueue.js'

export interface IngestionModeSnapshot {
  mode: IngestionMode
  blockedReason: IngestionBlockedReason
  hostPodVariant: HostPodModeVariant | null
  hostPodSupervisorState: 'healthy' | 'replacement_exhausted' | 'halted_by_anomaly'
  hostPodHaltReason: string | null
  waitForHostPod: boolean
  blockedWithoutConnectivity: boolean
  settings: EdgeTierSettings
  probes: ProbeSnapshot
  holdQueue: { count: number; bytes: number }
  sessionHostFallbackAuthorized: boolean
}

const _emitter = new EventEmitter()
let _cachedSnapshot: IngestionModeSnapshot | null = null
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _resolverInputsOverride: Partial<ResolverInputs> | null = null

/** Tests: force resolver inputs (skips live probes for overridden fields). */
export function _setResolverInputsOverrideForTest(
  override: Partial<ResolverInputs> | null,
): void {
  _resolverInputsOverride = override
  _cachedSnapshot = null
}

/** Isolated-suite canary: undefined when global test/setup.ts probe defaults are not applied. */
export function getResolverProbeOverrides(): Partial<ResolverInputs> | undefined {
  return _resolverInputsOverride ?? undefined
}

export function onIngestionModeChange(listener: (snap: IngestionModeSnapshot) => void): () => void {
  _emitter.on('change', listener)
  return () => _emitter.off('change', listener)
}

function buildResolverInputs(probes: ProbeSnapshot): ResolverInputs {
  return {
    settings: loadEdgeTierSettings(),
    edgeReachable: probes.edgeReachable,
    generalConnectivity: probes.generalConnectivity,
    hostPodReady: probes.hostPodReady,
    podmanAvailable: isPodmanVerifiedReady(),
    sessionHostFallbackAuthorized: isSessionHostFallbackAuthorized(),
  }
}

export async function refreshIngestionMode(forceProbe = false): Promise<IngestionModeSnapshot> {
  const probes = await runAllProbes(forceProbe)
  const inputs: ResolverInputs = {
    ...buildResolverInputs(probes),
    ...(_resolverInputsOverride ?? {}),
  }
  const mode = resolveIngestionMode(inputs)
  let hostPodSupervisorState: IngestionModeSnapshot['hostPodSupervisorState'] = 'healthy'
  let hostPodHaltReason: string | null = null
  try {
    const stateMod = await import('../local-pod/supervisor/hostPodState.js')
    hostPodSupervisorState = stateMod.getHostPodSupervisorState()
    hostPodHaltReason = stateMod.getHostPodHaltReason()
  } catch {
    /* optional */
  }
  const hostPodHalted = hostPodSupervisorState !== 'healthy'
  const holdQueue = await holdQueueSize()
  const snap: IngestionModeSnapshot = {
    mode,
    blockedReason: resolveIngestionBlockedReason(inputs, mode),
    hostPodVariant: resolveHostPodVariant(inputs, mode, hostPodHalted),
    hostPodSupervisorState,
    hostPodHaltReason,
    waitForHostPod: shouldWaitForHostPod(inputs, mode),
    blockedWithoutConnectivity: isBlockedWithoutGeneralConnectivity(inputs, mode),
    settings: inputs.settings,
    probes,
    holdQueue,
    sessionHostFallbackAuthorized: inputs.sessionHostFallbackAuthorized,
  }
  const prev = _cachedSnapshot
  _cachedSnapshot = snap
  const changed =
    !prev ||
    prev.mode !== snap.mode ||
    prev.hostPodVariant !== snap.hostPodVariant ||
    prev.hostPodSupervisorState !== snap.hostPodSupervisorState
  if (changed) {
    _emitter.emit('change', snap)
  }
  return snap
}

export function getIngestionModeSnapshot(): IngestionModeSnapshot | null {
  return _cachedSnapshot
}

export async function getCurrentIngestionMode(): Promise<IngestionModeSnapshot> {
  if (_cachedSnapshot) return _cachedSnapshot
  return refreshIngestionMode()
}

export function startIngestionModePolling(intervalMs = 15_000): void {
  if (_pollTimer) return
  void refreshIngestionMode(true)
  _pollTimer = setInterval(() => {
    void refreshIngestionMode(false)
  }, intervalMs)
}

export function stopIngestionModePolling(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
}

export function _resetIngestionModeServiceForTest(): void {
  stopIngestionModePolling()
  _cachedSnapshot = null
  _resolverInputsOverride = null
  _emitter.removeAllListeners('change')
}
