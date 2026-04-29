/**
 * Ollama embedding capability from /api/tags — chat model ≠ embedding model.
 */

import type { AiExecutionLane } from './aiExecutionTypes'
import { bareOllamaModelNameForApi } from '../../../src/lib/hostInferenceModelIds'

export type AiModelCapability = {
  canGenerateText: boolean
  canGenerateEmbeddings: boolean
  /** Exact model name from tags (e.g. nomic-embed-text:latest) when embeddings are available. */
  embeddingModel?: string
}

type TagsRow = { name?: string; model?: string }

export async function fetchOllamaInstalledModelNames(baseUrl: string): Promise<string[] | null> {
  const origin = baseUrl.replace(/\/$/, '')
  const url = `${origin}/api/tags`
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: TagsRow[] }
    const rows = Array.isArray(data.models) ? data.models : []
    return rows.map((m) => String(m.name ?? m.model ?? '').trim()).filter(Boolean)
  } catch {
    return null
  }
}

export function normalizeOllamaModelBaseName(name: string): string {
  const t = name.trim()
  const i = t.indexOf(':')
  return i > 0 ? t.slice(0, i) : t
}

/** Heuristic: Ollama embedding models typically include "embed" or known embedding families. */
export function isLikelyOllamaEmbeddingModel(name: string): boolean {
  const base = normalizeOllamaModelBaseName(name).toLowerCase()
  if (!base) return false
  if (base.includes('embed')) return true
  const knownPrefixes = [
    'all-minilm',
    'snowflake-arctic-embed',
    'granite-embedding',
    'jina-embeddings',
    'multilingual-e5',
    'qwen3-embedding',
    'mxbai-embed',
  ]
  return knownPrefixes.some((p) => base === p || base.startsWith(`${p}-`) || base.startsWith(`${p}:`))
}

function findInstalledExact(preferred: string, installed: string[]): string | null {
  const p = preferred.trim()
  if (!p) return null
  const pl = p.toLowerCase()
  for (const n of installed) {
    if (n.toLowerCase() === pl) return n
  }
  const pb = normalizeOllamaModelBaseName(p).toLowerCase()
  for (const n of installed) {
    if (normalizeOllamaModelBaseName(n).toLowerCase() === pb) return n
  }
  return null
}

export function pickEmbeddingModelForTags(
  configuredEmbedModel: string,
  installed: string[],
): { model: string | null; reason: string } {
  const embedPool = installed.filter(isLikelyOllamaEmbeddingModel)
  const configuredHit = findInstalledExact(configuredEmbedModel, installed)
  if (configuredHit) {
    if (isLikelyOllamaEmbeddingModel(configuredHit)) {
      return { model: configuredHit, reason: 'configured_embedding_installed' }
    }
    if (embedPool.length > 0) {
      return {
        model: embedPool[0]!,
        reason: 'configured_chat_model_not_embedder_using_first_embedding_in_tags',
      }
    }
    return { model: null, reason: 'configured_model_not_embedding_and_no_embedding_models_in_tags' }
  }
  if (embedPool.length > 0) {
    return { model: embedPool[0]!, reason: 'auto_first_embedding_model_in_tags' }
  }
  return { model: null, reason: 'no_embedding_models_in_tags' }
}

export type ResolveOllamaEmbeddingInput = {
  baseUrl: string
  lane: AiExecutionLane
  selectedChatModel: string
  /** Preferred embedding id (e.g. OllamaProvider default or WRDESK_OLLAMA_EMBED_MODEL). */
  configuredEmbedModel?: string
}

/**
 * Probes /api/tags, picks an embedding model distinct from the chat model, logs [EMBEDDING_MODEL_RESOLVE].
 * Never throws — use canGenerateEmbeddings to skip semantic paths.
 */
export async function resolveOllamaEmbeddingAtBaseUrl(
  input: ResolveOllamaEmbeddingInput,
): Promise<AiModelCapability & { reason: string }> {
  const rawSelector =
    typeof input.selectedChatModel === 'string' ? input.selectedChatModel.trim() : ''
  /** UI may pass `host-internal:<hid>:<encModel>`; `/api/tags` lists bare Ollama names only. */
  const chatModelForTags = bareOllamaModelNameForApi(input.selectedChatModel) || rawSelector

  const configured =
    input.configuredEmbedModel?.trim() ||
    (typeof process.env.WRDESK_OLLAMA_EMBED_MODEL === 'string' ? process.env.WRDESK_OLLAMA_EMBED_MODEL.trim() : '') ||
    'nomic-embed-text'

  const laneForLog =
    input.lane === 'local' ? 'local' : 'ollama_direct'

  const installed = await fetchOllamaInstalledModelNames(input.baseUrl)
  if (!installed) {
    const line =
      `[EMBEDDING_MODEL_RESOLVE] lane=${laneForLog} baseUrl=${input.baseUrl} selectedChatModel=${chatModelForTags}` +
      (rawSelector && rawSelector !== chatModelForTags ? ` selector_raw=${rawSelector}` : '') +
      ` embeddingModel=null availableModels=0 canGenerateEmbeddings=false reason=tags_unreachable`
    console.log(line)
    return {
      canGenerateText: true,
      canGenerateEmbeddings: false,
      reason: 'tags_unreachable',
    }
  }

  const chatHit = findInstalledExact(chatModelForTags, installed)
  const canGenerateText = chatHit != null

  const { model, reason } = pickEmbeddingModelForTags(configured, installed)
  const canGenerateEmbeddings = model != null

  const line =
    `[EMBEDDING_MODEL_RESOLVE] lane=${laneForLog} baseUrl=${input.baseUrl} selectedChatModel=${chatModelForTags}` +
    (rawSelector && rawSelector !== chatModelForTags ? ` selector_raw=${rawSelector}` : '') +
    ` embeddingModel=${model ?? 'null'} availableModels=${installed.length} canGenerateEmbeddings=${canGenerateEmbeddings} reason=${reason}`
  console.log(line)

  return {
    canGenerateText,
    canGenerateEmbeddings,
    ...(model ? { embeddingModel: model } : {}),
    reason,
  }
}
