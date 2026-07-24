/**
 * One-shot llama.cpp model warm-up for bulk Auto-Sort first chunk only.
 */

import { assertGpuInferenceAvailable } from '../inference/inferenceGate'
import { DEFAULT_LLAMACPP_PORT } from './localLlmPaths'
import { collectLlamacppHttpBasesFromEnv } from './llamacppHttpBases'

const CHAT_URL = `${collectLlamacppHttpBasesFromEnv()[0] ?? `http://127.0.0.1:${DEFAULT_LLAMACPP_PORT}`}/v1/chat/completions`

const PREWARM_COOLDOWN_MS = 120_000
const lastPrewarmAtByModel = new Map<string, number>()
let postSwitchBypassModelId: string | null = null

export function noteLocalLlmActiveModelChangedForBulkPrewarm(modelId: string): void {
  postSwitchBypassModelId = modelId?.trim() || null
}

export type LocalLlmBulkPrewarmDiag = {
  action:
    | 'ran'
    | 'skipped_cooldown'
    | 'skipped_not_first_chunk'
    | 'skipped_server_unreachable'
    | 'skipped_gpu_inference_blocked'
    | 'failed'
  wallMs?: number
  followingClassifyLikelyResident?: boolean
}

export async function maybePrewarmLocalLlmForBulkClassify(
  model: string,
  opts: { chunkIndex?: number },
): Promise<LocalLlmBulkPrewarmDiag> {
  const idx = opts.chunkIndex
  if (idx != null && idx !== 1) {
    return { action: 'skipped_not_first_chunk', followingClassifyLikelyResident: true }
  }

  const now = Date.now()
  const trimmed = model?.trim()
  if (!trimmed) return { action: 'failed', followingClassifyLikelyResident: false }

  let bypassCooldown = false
  if (postSwitchBypassModelId != null && postSwitchBypassModelId === trimmed) {
    postSwitchBypassModelId = null
    bypassCooldown = true
  }

  if (!bypassCooldown) {
    const last = lastPrewarmAtByModel.get(trimmed)
    if (last != null && now - last < PREWARM_COOLDOWN_MS) {
      return { action: 'skipped_cooldown', followingClassifyLikelyResident: true }
    }
  }

  const wallT0 = performance.now()
  const ac = new AbortController()
  const to = setTimeout(() => ac.abort(), 60_000)
  try {
    await assertGpuInferenceAvailable()
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        model: trimmed,
        stream: false,
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
    })
    const wallMs = Math.round(performance.now() - wallT0)
    if (!res.ok) return { action: 'failed', wallMs, followingClassifyLikelyResident: false }
    lastPrewarmAtByModel.set(trimmed, Date.now())
    return { action: 'ran', wallMs, followingClassifyLikelyResident: true }
  } catch (e: unknown) {
    const name = e instanceof Error ? e.name : ''
    const wallMs = Math.round(performance.now() - wallT0)
    if (name === 'InferenceUnavailableError') {
      return { action: 'skipped_gpu_inference_blocked', wallMs, followingClassifyLikelyResident: false }
    }
    return { action: 'skipped_server_unreachable', wallMs, followingClassifyLikelyResident: false }
  } finally {
    clearTimeout(to)
  }
}
