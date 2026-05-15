/**
 * Single choke-point for enforcing GPU-backed Ollama inference (thermal safety).
 *
 * Development-only escape hatch — **never** set in clinical / hospital deployments:
 * `WRDESK_ALLOW_CPU_INFERENCE=1` bypasses the throw so engineers can iterate on CPUs;
 * inference still computes full diagnostics; console warns on each bypass.
 */

import type { GpuUnavailableReason } from './gpuStatus'
import { getGpuStatus, getGpuInferenceStatusRemote } from './gpuStatus'

export class InferenceUnavailableError extends Error {
  readonly reason: GpuUnavailableReason
  readonly userMessage: string

  constructor(params: { reason: GpuUnavailableReason; userMessage: string }) {
    super(params.userMessage)
    this.name = 'InferenceUnavailableError'
    this.reason = params.reason
    this.userMessage = params.userMessage
  }
}

function allowCpuInferenceDevOverride(): boolean {
  const v = (process.env.WRDESK_ALLOW_CPU_INFERENCE ?? '').trim()
  return v === '1' || /^true$/i.test(v)
}

function logDevBypass(): void {
  console.warn(
    '[INFERENCE_GATE] WRDESK_ALLOW_CPU_INFERENCE is set — allowing Ollama calls without GPU verification ' +
      '(development only; unset for production / hospital rollout).',
  )
}

export function isLikelyLoopbackOrigin(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`)
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1'
  } catch {
    return false
  }
}

export async function assertGpuInferenceAvailable(): Promise<void> {
  if (allowCpuInferenceDevOverride()) {
    logDevBypass()
    return
  }
  const s = await getGpuStatus()
  if (s.available) return
  const r = (s.reason ?? 'UNKNOWN') as GpuUnavailableReason
  throw new InferenceUnavailableError({
    reason: r,
    userMessage: s.userMessage,
  })
}

/**
 * For Sandbox → Host LAN Ollama: probe offload at the advertised origin (skip local NVIDIA-SMI).
 */
export async function assertGpuInferenceAvailableForRemoteOllama(
  ollamaOrigin: string,
  modelBareHint: string,
): Promise<void> {
  if (allowCpuInferenceDevOverride()) {
    logDevBypass()
    return
  }
  const s = await getGpuInferenceStatusRemote(ollamaOrigin, modelBareHint)
  if (s.available) return
  const r = (s.reason ?? 'UNKNOWN') as GpuUnavailableReason
  throw new InferenceUnavailableError({
    reason: r,
    userMessage: s.userMessage,
  })
}

/**
 * Prefer local {@link assertGpuInferenceAvailable}; use remote assertion when hitting a LAN Ollama.
 */
export async function assertGpuInferenceAvailableForChatBase(params: {
  baseUrlNoTrailingSlash: string
  modelId: string
}): Promise<void> {
  const base = params.baseUrlNoTrailingSlash.trim().replace(/\/$/, '')
  if (!base || isLikelyLoopbackOrigin(base)) {
    await assertGpuInferenceAvailable()
    return
  }
  await assertGpuInferenceAvailableForRemoteOllama(base, params.modelId)
}

export async function isGpuInferenceAvailable(): Promise<boolean> {
  try {
    const s = await getGpuStatus()
    return s.available
  } catch {
    return false
  }
}
