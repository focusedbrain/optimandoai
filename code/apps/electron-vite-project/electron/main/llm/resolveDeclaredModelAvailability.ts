/**
 * Central declared-model availability: missing local Ollama tags → active model fallback (loud, never silent).
 */

import { ollamaManager } from './ollama-manager'

export type ModelFallbackReason = 'not_installed' | 'no_active_model'

export type DeclaredModelResolution =
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
      reason: 'no_active_model'
    }

export function isOllamaModelInstalled(installedNames: readonly string[], requested: string): boolean {
  const want = requested.trim()
  if (!want) return false
  if (installedNames.includes(want)) return true
  const lower = want.toLowerCase()
  return installedNames.some((n) => n.toLowerCase() === lower)
}

export function logModelFallbackLine(fields: {
  requestedModel: string
  actualModel: string
  reason: string
  origin: string
}): void {
  console.log(
    `[MODEL_FALLBACK] requested=${fields.requestedModel} actual=${fields.actualModel} reason=${fields.reason} origin=${fields.origin}`,
  )
}

/**
 * Resolve a declared local Ollama model id before chat.
 * Fallback target: {@link ollamaManager.getEffectiveChatModelName} (persisted active + installed tags).
 */
export async function resolveDeclaredLocalOllamaModel(
  requestedModelId: string | null | undefined,
  origin: string,
): Promise<DeclaredModelResolution> {
  const requested = typeof requestedModelId === 'string' ? requestedModelId.trim() : ''
  const models = await ollamaManager.listModels()
  const installedNames = models.map((m) => m.name)

  if (requested && isOllamaModelInstalled(installedNames, requested)) {
    const exact = installedNames.find((n) => n.toLowerCase() === requested.toLowerCase()) ?? requested
    return {
      ok: true,
      requestedModel: requested,
      actualModel: exact,
      fellBack: false,
    }
  }

  const active = await ollamaManager.getEffectiveChatModelName()
  if (!active) {
    const err = requested
      ? `Model "${requested}" is not installed and no active model is loaded. Install a model or pick one in LLM Settings.`
      : 'No active model is loaded. Install a model or pick one in LLM Settings.'
    return {
      ok: false,
      requestedModel: requested,
      error: err,
      reason: 'no_active_model',
    }
  }

  if (!requested || requested === active) {
    return {
      ok: true,
      requestedModel: requested || active,
      actualModel: active,
      fellBack: false,
    }
  }

  logModelFallbackLine({
    requestedModel: requested,
    actualModel: active,
    reason: 'not_installed',
    origin,
  })

  return {
    ok: true,
    requestedModel: requested,
    actualModel: active,
    fellBack: true,
    reason: 'not_installed',
  }
}

export type ModelFallbackWire = {
  requestedModel: string
  actualModel: string
  fellBack: boolean
  reason?: ModelFallbackReason | 'api_key_missing'
}

export function toModelFallbackWire(res: DeclaredModelResolution): ModelFallbackWire | undefined {
  if (!res.ok || !res.fellBack) return undefined
  return {
    requestedModel: res.requestedModel,
    actualModel: res.actualModel,
    fellBack: true,
    reason: res.reason,
  }
}
