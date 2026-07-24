/**
 * Client for declared-model availability (POST /api/llm/resolve-model) + loud fallback UI helpers.
 */

import { ensureLaunchSecretForElectronHttp } from '../services/ensureLaunchSecretForElectronHttp'
import type { LlmRequestBody } from '../services/processFlow'
import type { BrainResolution } from '../services/processFlow'
import { buildLlmRequestBody } from '../services/processFlow'

const DEFAULT_LLM_BASE = 'http://127.0.0.1:51248'

export type ModelFallbackReason = 'not_installed' | 'api_key_missing' | 'no_active_model'

export type ModelFallbackInfo = {
  requestedModel: string
  actualModel: string
  fellBack: true
  reason: ModelFallbackReason
}

export type DeclaredModelResolutionWire =
  | {
      ok: true
      requestedModel: string
      actualModel: string
      fellBack: boolean
      reason?: ModelFallbackReason
    }
  | {
      ok: false
      requestedModel: string
      error: string
      reason?: ModelFallbackReason
    }

async function defaultGetFetchHeaders(): Promise<Record<string, string>> {
  await ensureLaunchSecretForElectronHttp()
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | undefined) => {
          resolve({
            'Content-Type': 'application/json',
            'X-Launch-Secret': resp?.secret?.trim() ?? '',
          })
        })
        return
      }
    } catch {
      /* fall through */
    }
    resolve({ 'Content-Type': 'application/json' })
  })
}

export function formatModelFallbackBanner(fb: ModelFallbackInfo): string {
  const reasonText =
    fb.reason === 'api_key_missing'
      ? 'API key missing'
      : fb.reason === 'no_active_model'
        ? 'no active model loaded'
        : 'unavailable'
  return `⚠️ **Model fallback:** Requested **${fb.requestedModel}** — ${reasonText}, ran on **${fb.actualModel}**.\n\n`
}

export function applyModelFallbackBanner(content: string, fb?: ModelFallbackInfo | null): string {
  if (!fb?.fellBack) return content
  return formatModelFallbackBanner(fb) + content
}

export function parseModelFallbackFromChatData(data: unknown): ModelFallbackInfo | null {
  if (!data || typeof data !== 'object') return null
  const fb = (data as { modelFallback?: unknown }).modelFallback
  if (!fb || typeof fb !== 'object') return null
  const o = fb as Record<string, unknown>
  if (o.fellBack !== true) return null
  const requestedModel = typeof o.requestedModel === 'string' ? o.requestedModel.trim() : ''
  const actualModel = typeof o.actualModel === 'string' ? o.actualModel.trim() : ''
  const reasonRaw = o.reason
  const reason: ModelFallbackReason =
    reasonRaw === 'api_key_missing' || reasonRaw === 'no_active_model' || reasonRaw === 'not_installed'
      ? reasonRaw
      : 'not_installed'
  if (!requestedModel || !actualModel) return null
  return { requestedModel, actualModel, fellBack: true, reason }
}

export async function resolveDeclaredModelViaHttp(args: {
  requestedModelId: string
  origin: string
  baseUrl?: string
  getFetchHeaders?: () => Promise<Record<string, string>>
}): Promise<DeclaredModelResolutionWire> {
  const baseUrl = (args.baseUrl ?? DEFAULT_LLM_BASE).replace(/\/$/, '')
  const headers = await (args.getFetchHeaders ?? defaultGetFetchHeaders)()
  try {
    const res = await fetch(`${baseUrl}/api/llm/resolve-model`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestedModelId: args.requestedModelId,
        origin: args.origin,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const j = (await res.json().catch(() => ({}))) as DeclaredModelResolutionWire & { error?: string }
    if (!res.ok) {
      return {
        ok: false,
        requestedModel: args.requestedModelId,
        error: j.error ?? `Model resolve failed (${res.status})`,
        reason: j.reason ?? 'no_active_model',
      }
    }
    return j
  } catch (e) {
    return {
      ok: false,
      requestedModel: args.requestedModelId,
      error: e instanceof Error ? e.message : 'Model resolve failed',
      reason: 'no_active_model',
    }
  }
}

function wireToFallback(w: DeclaredModelResolutionWire, reasonOverride?: ModelFallbackReason): ModelFallbackInfo | null {
  if (!w.ok || !w.fellBack) return null
  return {
    requestedModel: w.requestedModel,
    actualModel: w.actualModel,
    fellBack: true,
    reason: reasonOverride ?? (w.reason === 'api_key_missing' ? 'api_key_missing' : w.reason ?? 'not_installed'),
  }
}

/**
 * Build LLM chat body with declared-model availability applied (local tags + cloud key → active local).
 */
export async function buildLlmRequestBodyWithAvailability(
  modelResolution: BrainResolution & { ok: true },
  messages: Array<{ role: string; content: string; images?: string[] }>,
  options: {
    origin: string
    baseUrl?: string
    getFetchHeaders?: () => Promise<Record<string, string>>
  },
): Promise<{ body: LlmRequestBody; modelFallback?: ModelFallbackInfo; error?: string }> {
  const { body, error: keyError } = await buildLlmRequestBody(modelResolution, messages)

  if (keyError) {
    const requested = modelResolution.model.trim()
    const resolved = await resolveDeclaredModelViaHttp({
      requestedModelId: requested,
      origin: options.origin,
      baseUrl: options.baseUrl,
      getFetchHeaders: options.getFetchHeaders,
    })
    if (!resolved.ok) {
      return { body, error: resolved.error ?? keyError }
    }
    const fb = wireToFallback(resolved, 'api_key_missing') ?? {
      requestedModel: requested,
      actualModel: resolved.actualModel,
      fellBack: true as const,
      reason: 'api_key_missing' as const,
    }
    console.log(
      `[MODEL_FALLBACK] requested=${fb.requestedModel} actual=${fb.actualModel} reason=api_key_missing origin=${options.origin}`,
    )
    return {
      body: { modelId: resolved.actualModel, messages },
      modelFallback: fb,
    }
  }

  if (modelResolution.isLocal) {
    const resolved = await resolveDeclaredModelViaHttp({
      requestedModelId: body.modelId,
      origin: options.origin,
      baseUrl: options.baseUrl,
      getFetchHeaders: options.getFetchHeaders,
    })
    if (!resolved.ok) {
      return { body, error: resolved.error }
    }
    const fb = wireToFallback(resolved)
    if (fb) {
      console.log(
        `[MODEL_FALLBACK] requested=${fb.requestedModel} actual=${fb.actualModel} reason=${fb.reason} origin=${options.origin}`,
      )
    }
    return {
      body: { ...body, modelId: resolved.actualModel },
      modelFallback: fb ?? undefined,
    }
  }

  return { body }
}

export type LlmChatPostResult =
  | { ok: true; content: string; modelFallback?: ModelFallbackInfo }
  | { ok: false; error: string }

/** POST /api/llm/chat and parse content + server-side fallback metadata. */
export async function postLlmChatWithAvailability(args: {
  body: LlmRequestBody
  origin: string
  baseUrl?: string
  getFetchHeaders?: () => Promise<Record<string, string>>
  signal?: AbortSignal
  extraBody?: Record<string, unknown>
  preResolvedFallback?: ModelFallbackInfo
}): Promise<LlmChatPostResult> {
  const baseUrl = (args.baseUrl ?? DEFAULT_LLM_BASE).replace(/\/$/, '')
  const headers = await (args.getFetchHeaders ?? defaultGetFetchHeaders)()
  const response = await fetch(`${baseUrl}/api/llm/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...args.body, ...args.extraBody }),
    signal: args.signal ?? AbortSignal.timeout(600_000),
  })

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}))
    const err = (errBody as { error?: string }).error || 'LLM request failed'
    return { ok: false, error: err }
  }

  const result = await response.json()
  if (!result.ok || !result.data?.content) {
    return { ok: false, error: 'No output from LLM' }
  }

  const fromServer = parseModelFallbackFromChatData(result.data)
  const modelFallback = fromServer ?? args.preResolvedFallback
  return {
    ok: true,
    content: result.data.content as string,
    modelFallback,
  }
}
