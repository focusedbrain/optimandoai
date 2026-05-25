/**
 * Runtime ingestion mode service — gathers probe inputs and resolves mode.
 */

import { EventEmitter } from 'node:events'

import { loadEdgeTierSettings, type EdgeTierSettings } from '../edge-tier/settings.js'
import { getLocalPodSetupError } from '../local-pod/index.js'
import {
  resolveIngestionMode,
  resolveHostPodVariant,
  shouldWaitForHostPod,
  isBlockedWithoutGeneralConnectivity,
  type IngestionMode,
  type HostPodModeVariant,
  type ResolverInputs,
} from './modeResolver.js'
import { isSessionHostFallbackAuthorized } from './sessionHostFallback.js'
import { getProbeSnapshot, runAllProbes, type ProbeSnapshot } from './edgeProbe.js'
import { holdQueueSize } from './holdQueue.js'

export interface IngestionModeSnapshot {
  mode: IngestionMode
  hostPodVariant: HostPodModeVariant | null
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
    podmanAvailable: getLocalPodSetupError() == null,
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
  const holdQueue = await holdQueueSize()
  const snap: IngestionModeSnapshot = {
    mode,
    hostPodVariant: resolveHostPodVariant(inputs, mode),
    waitForHostPod: shouldWaitForHostPod(inputs, mode),
    blockedWithoutConnectivity: isBlockedWithoutGeneralConnectivity(inputs, mode),
    settings: inputs.settings,
    probes,
    holdQueue,
    sessionHostFallbackAuthorized: inputs.sessionHostFallbackAuthorized,
  }
  const prevMode = _cachedSnapshot?.mode
  _cachedSnapshot = snap
  if (prevMode !== mode) {
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
