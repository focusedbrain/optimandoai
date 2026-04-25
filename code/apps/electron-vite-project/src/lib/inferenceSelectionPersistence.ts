/**
 * Persistent inference selection (orchestrator top chat, WR Chat dashboard) — structured for Host,
 * backward-compatible plain strings for local/cloud.
 */

import { getCachedUserInfo } from '../auth/sessionCache'
import { isHostInferenceModelId, parseAnyHostInferenceModelId } from './hostInferenceModelIds'

const SELECTION_V = 1 as const

export type InferenceSelectionKind = 'local_ollama' | 'cloud' | 'host_internal'

export interface StoredInferenceSelectionV1 {
  v: typeof SELECTION_V
  kind: InferenceSelectionKind
  /** Route id: Ollama name, cloud id, or `host-internal:...` / `host-inference:...`. */
  id: string
  model: string
  handshake_id?: string
  account_key?: string
}

/** Legacy unscoped (pre–STEP 7) — `llama3` or (deprecated unscoped) host id. */
export const LEGACY_ORCH_MODEL_KEY = 'optimando-orchestrator-chat-model'

function legacyOrchScopedKey(accountKey: string): string {
  return `${LEGACY_ORCH_MODEL_KEY}:scoped:${accountKey}`
}

const V1_ORCH = 'optimando-inference-v1-orch'
const V1_WR = 'optimando-inference-v1-wrchat'

const LEGACY_WR = 'optimando-wr-chat-active-model'

function legacyWrScoped(ak: string): string {
  return `${LEGACY_WR}:scoped:${ak}`
}

export function accountKeyFromSession(): string {
  const u = getCachedUserInfo()
  const k = (u?.wrdesk_user_id || u?.sub || '').trim()
  return k || 'anon'
}

function orchV1Key(): string {
  return `${V1_ORCH}:${accountKeyFromSession()}`
}
function wrV1Key(): string {
  return `${V1_WR}:${accountKeyFromSession()}`
}

function stampAccount(s: StoredInferenceSelectionV1): StoredInferenceSelectionV1 {
  return { ...s, v: SELECTION_V, account_key: accountKeyFromSession() }
}

function parseJson(raw: string | null): StoredInferenceSelectionV1 | null {
  if (!raw?.trim()) return null
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    if (r.v !== SELECTION_V) return null
    if (r.kind !== 'local_ollama' && r.kind !== 'cloud' && r.kind !== 'host_internal') return null
    if (typeof r.id !== 'string' || !r.id.trim()) return null
    if (typeof r.model !== 'string') return null
    return {
      v: SELECTION_V,
      kind: r.kind,
      id: r.id.trim(),
      model: r.model,
      handshake_id: typeof r.handshake_id === 'string' && r.handshake_id.trim() ? r.handshake_id.trim() : undefined,
      account_key: typeof r.account_key === 'string' ? r.account_key : undefined,
    }
  } catch {
    return null
  }
}

function inferKindFromId(
  id: string,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' }>,
): InferenceSelectionKind {
  if (isHostInferenceModelId(id)) return 'host_internal'
  const row = availableModels.find((m) => m.id === id)
  if (row?.type === 'cloud') return 'cloud'
  return 'local_ollama'
}

export function toStoredSelection(
  id: string,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' }>,
): StoredInferenceSelectionV1 {
  const kind = inferKindFromId(id, availableModels)
  if (kind === 'host_internal') {
    const p = parseAnyHostInferenceModelId(id)
    return stampAccount({
      v: SELECTION_V,
      kind: 'host_internal',
      id,
      model: p?.model?.trim() || '',
      handshake_id: p?.handshakeId,
    })
  }
  return stampAccount({ v: SELECTION_V, kind, id, model: id })
}

export function persistOrchestratorModelId(
  id: string,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' }>,
): void {
  if (!id) {
    clearOrchestratorInferenceSelection()
    return
  }
  const body = toStoredSelection(id, availableModels)
  const stamped = stampAccount(body)
  try {
    localStorage.setItem(orchV1Key(), JSON.stringify(stamped))
    localStorage.setItem(legacyOrchScopedKey(accountKeyFromSession()), stamped.id)
  } catch {
    /* ignore */
  }
}

export function readOrchestratorInferenceSelection(): StoredInferenceSelectionV1 | null {
  const ak = accountKeyFromSession()
  try {
    const j = parseJson(localStorage.getItem(orchV1Key()))
    if (j) {
      if (j.account_key && j.account_key !== ak) {
        return null
      }
      return j
    }
    const scoped = localStorage.getItem(legacyOrchScopedKey(ak))?.trim()
    if (scoped) {
      if (isHostInferenceModelId(scoped)) {
        const m = migrateUnscopedOrchHost(scoped)
        if (m) {
          try {
            localStorage.setItem(orchV1Key(), JSON.stringify(m))
          } catch {
            /* ignore */
          }
        }
        return m
      }
      return toStoredSelection(scoped, [
        { id: scoped, type: 'local' },
        { id: scoped, type: 'cloud' },
      ])
    }
    const unscoped = localStorage.getItem(LEGACY_ORCH_MODEL_KEY)?.trim()
    if (unscoped) {
      if (isHostInferenceModelId(unscoped)) {
        try {
          localStorage.removeItem(LEGACY_ORCH_MODEL_KEY)
        } catch {
          /* ignore */
        }
        return null
      }
      const next = toStoredSelection(unscoped, [
        { id: unscoped, type: 'local' },
        { id: unscoped, type: 'cloud' },
      ])
      const stamped = stampAccount(next)
      try {
        localStorage.setItem(orchV1Key(), JSON.stringify(stamped))
        localStorage.setItem(legacyOrchScopedKey(ak), stamped.id)
        localStorage.removeItem(LEGACY_ORCH_MODEL_KEY)
      } catch {
        /* ignore */
      }
      return next
    }
  } catch {
    /* ignore */
  }
  return null
}

function migrateUnscopedOrchHost(id: string): StoredInferenceSelectionV1 | null {
  const p = parseAnyHostInferenceModelId(id)
  if (!p) return null
  return stampAccount({
    v: SELECTION_V,
    kind: 'host_internal',
    id,
    model: p.model?.trim() || '',
    handshake_id: p.handshakeId,
  })
}

export function clearOrchestratorInferenceSelection(): void {
  const ak = accountKeyFromSession()
  try {
    localStorage.removeItem(orchV1Key())
    localStorage.removeItem(legacyOrchScopedKey(ak))
  } catch {
    /* ignore */
  }
}

type HostishTarget = {
  id: string
  handshake_id: string
  available: boolean
}

export type ValidateSelectionResult = {
  modelId: string
  error?: 'host_unavailable' | 'unknown_model'
}

export function validateStoredSelectionForOrchestrator(
  stored: StoredInferenceSelectionV1,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' }>,
  inferenceTargets: HostishTarget[] | undefined,
  isSandbox: boolean,
  hasLocalModelsInList: boolean,
): ValidateSelectionResult {
  const ak = accountKeyFromSession()
  if (stored.account_key && stored.account_key !== ak) {
    return { modelId: '', error: 'unknown_model' }
  }
  if (stored.kind === 'host_internal') {
    const t = (inferenceTargets ?? []).find(
      (x) => x.id === stored.id && (stored.handshake_id ? x.handshake_id === stored.handshake_id : true),
    )
    if (!t || !t.available) {
      return { modelId: '', error: 'host_unavailable' }
    }
    return { modelId: stored.id }
  }
  if (stored.kind === 'local_ollama' && isSandbox && !hasLocalModelsInList) {
    return { modelId: '', error: 'unknown_model' }
  }
  if (availableModels.some((m) => m.id === stored.id)) {
    return { modelId: stored.id }
  }
  return { modelId: '', error: 'unknown_model' }
}

// ── WR Chat (dashboard) ─────────────────────────────────────────────

export function readWrChatInferenceSelection(): StoredInferenceSelectionV1 | null {
  const ak = accountKeyFromSession()
  try {
    const j = parseJson(localStorage.getItem(wrV1Key()))
    if (j) {
      if (j.account_key && j.account_key !== ak) return null
      return j
    }
    const sc = localStorage.getItem(legacyWrScoped(ak))?.trim()
    if (sc) {
      if (isHostInferenceModelId(sc)) {
        const p = parseAnyHostInferenceModelId(sc)
        if (!p) return null
        return stampAccount({
          v: SELECTION_V,
          kind: 'host_internal',
          id: sc,
          model: p.model?.trim() || '',
          handshake_id: p.handshakeId,
        })
      }
      return stampAccount({ v: SELECTION_V, kind: 'local_ollama', id: sc, model: sc })
    }
    const un = localStorage.getItem(LEGACY_WR)?.trim()
    if (un) {
      if (isHostInferenceModelId(un)) {
        try {
          localStorage.removeItem(LEGACY_WR)
        } catch {
          /* ignore */
        }
        return null
      }
      const next = stampAccount({ v: SELECTION_V, kind: 'local_ollama', id: un, model: un })
      try {
        localStorage.setItem(wrV1Key(), JSON.stringify(next))
        localStorage.setItem(legacyWrScoped(ak), next.id)
        localStorage.removeItem(LEGACY_WR)
      } catch {
        /* ignore */
      }
      return next
    }
  } catch {
    /* ignore */
  }
  return null
}

export function persistWrChatModelId(
  id: string,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' }>,
): void {
  if (!id) {
    clearWrChatInferenceSelection()
    return
  }
  const body = toStoredSelection(id, availableModels)
  const stamped = stampAccount(body)
  try {
    localStorage.setItem(wrV1Key(), JSON.stringify(stamped))
    localStorage.setItem(legacyWrScoped(accountKeyFromSession()), stamped.id)
  } catch {
    /* ignore */
  }
}

export function clearWrChatInferenceSelection(): void {
  const ak = accountKeyFromSession()
  try {
    localStorage.removeItem(wrV1Key())
    localStorage.removeItem(legacyWrScoped(ak))
  } catch {
    /* ignore */
  }
}

type WrHostish = { name: string; hostAi?: boolean; hostAvailable?: boolean }

export function validateStoredSelectionForWrChat(
  stored: StoredInferenceSelectionV1,
  mergedModelNames: string[],
  hostRows: WrHostish[],
): ValidateSelectionResult {
  if (stored.account_key && stored.account_key !== accountKeyFromSession()) {
    return { modelId: '', error: 'unknown_model' }
  }
  if (stored.kind === 'host_internal') {
    const row = hostRows.find((h) => h.name === stored.id)
    if (!row?.hostAi || !row.hostAvailable) {
      return { modelId: '', error: 'host_unavailable' }
    }
    return { modelId: stored.id }
  }
  if (mergedModelNames.includes(stored.id)) {
    return { modelId: stored.id }
  }
  return { modelId: '', error: 'unknown_model' }
}
