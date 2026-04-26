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
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
): InferenceSelectionKind {
  if (isHostInferenceModelId(id)) return 'host_internal'
  const row = availableModels.find((m) => m.id === id)
  if (row?.type === 'cloud') return 'cloud'
  return 'local_ollama'
}

export function toStoredSelection(
  id: string,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
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
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
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

/** IPC snapshot: fields used to restore Host AI without clearing during P2P/capability warmup. */
export type OrchestratorHostInferenceTargetSnapshot = {
  id: string
  handshake_id: string
  available: boolean
  p2pUiPhase?: string
  availability?: string
  unavailable_reason?: string
  host_selector_state?: string
  hostSelectorState?: string
  inference_error_code?: string | null
  failureCode?: string | null
  hostAiStructuredUnavailableReason?: string
}

function definitiveP2pSessionFailureCode(err: string): boolean {
  if (!err) return false
  return (
    err === 'OFFER_START_NOT_OBSERVED' ||
    err === 'OFFER_CREATE_TIMEOUT' ||
    err === 'SIGNALING_ANSWER_TIMEOUT' ||
    err === 'OFFER_SIGNAL_SEND_FAILED' ||
    err === 'OFFER_DISPATCH_FAILED' ||
    err === 'WEBRTC_TRANSPORT_NOT_READY' ||
    err === 'SIGNALING_NOT_STARTED' ||
    err === 'RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE' ||
    err === 'RELAY_MISSING_P2P_SIGNAL_ROUTE' ||
    err === 'RELAY_UNREACHABLE' ||
    err === 'P2P_SIGNAL_SCHEMA_REJECTED' ||
    err === 'P2P_SIGNAL_AUTH_OR_ROUTE_FAILED'
  )
}

/**
 * Handshake id for Host routing: persisted field first, else parsed from `host-internal:` / `host-inference:` id.
 */
export function resolveHostHandshakeIdFromInferenceSelection(
  stored: Pick<StoredInferenceSelectionV1, 'handshake_id' | 'id'>,
): string | null {
  const h = stored.handshake_id?.trim()
  if (h) return h
  const p = parseAnyHostInferenceModelId(stored.id)
  return p?.handshakeId?.trim() || null
}

/**
 * Prefer matching the internal Host row by handshake (stable) before exact `id`, because list rows may use
 * ephemeral tails (`connecting`, `checking`, …) while persistence keeps `host-internal:<hid>:<model>`.
 */
export function findHostInferenceTargetForHandshakeAndId<T extends { id: string; handshake_id: string }>(
  targets: T[] | undefined,
  handshakeId: string | null,
  storedId: string,
): T | undefined {
  const list = targets ?? []
  const hid = handshakeId?.trim()
  if (hid) {
    const sameHs = list.filter((x) => x.handshake_id === hid)
    if (sameHs.length === 1) return sameHs[0]
    if (sameHs.length > 1) {
      const exact = sameHs.find((x) => x.id === storedId)
      return exact ?? sameHs[0]
    }
  }
  return list.find((x) => x.id === storedId)
}

/** Host AI is only selectable when fully probed — there is no “pending connecting” restore path. */
export function isHostInferenceTargetPendingForRestore(_t: OrchestratorHostInferenceTargetSnapshot): boolean {
  return false
}

/** True only for states where the saved Host selection should be dropped (policy, identity, hard P2P failure, …). */
export function isHostInferenceTargetDefinitivelyInvalidForRestore(t: OrchestratorHostInferenceTargetSnapshot): boolean {
  const phase = t.p2pUiPhase ?? ''
  const av = String(t.availability ?? '')
  const ur = String(t.unavailable_reason ?? '')
  const err = String(t.inference_error_code ?? t.failureCode ?? '')

  if (phase === 'policy_disabled' || av === 'policy_disabled' || ur === 'HOST_POLICY_DISABLED') return true
  if (phase === 'hidden' || ur === 'SANDBOX_HOST_ROLE_METADATA') return true
  if (av === 'identity_incomplete' || ur === 'IDENTITY_INCOMPLETE') return true
  if (av === 'model_unavailable' || ur === 'HOST_NO_ACTIVE_LOCAL_LLM') return true
  if (
    err === 'HOST_NO_ACTIVE_LOCAL_LLM' ||
    err === 'MODEL_UNAVAILABLE' ||
    err === 'PROBE_NO_MODELS' ||
    err === 'PROBE_OLLAMA_UNAVAILABLE'
  ) {
    return true
  }
  if (definitiveP2pSessionFailureCode(err)) return true
  const sur = String(t.hostAiStructuredUnavailableReason ?? '')
  if (
    sur === 'provider_not_ready' ||
    sur === 'no_models' ||
    sur === 'transport_not_ready' ||
    sur === 'capability_probe_failed' ||
    sur === 'auth_rejected' ||
    sur === 'rate_limited' ||
    sur === 'gateway_error' ||
    sur === 'host_unreachable' ||
    sur === 'invalid_response' ||
    sur === 'local_ollama_down' ||
    sur === 'host_remote_ollama_down'
  ) {
    return true
  }
  if (
    ur === 'transport_not_ready' ||
    ur === 'capability_probe_failed' ||
    ur === 'provider_not_ready' ||
    ur === 'no_models' ||
    ur === 'INTERNAL_RELAY_P2P_NOT_READY'
  ) {
    return true
  }

  return false
}

/** Minimal merged-list row shape for Host AI stale UI (orchestrator selector). */
export type OrchestratorUiHostListRow = {
  id: string
  type: 'local' | 'cloud' | 'host_internal'
  hostTargetAvailable?: boolean
  hostSelectorState?: 'available' | 'checking' | 'unavailable'
}

/**
 * "That Host AI selection is no longer in the list" (orchestrator): same handshake-first matching and
 * pending vs definitive rules as `validateStoredSelectionForOrchestrator`. Non-Host selections always false.
 */
export function isHostInternalSelectionStaleForOrchestratorUi(
  selectedModelId: string,
  availableModels: OrchestratorUiHostListRow[],
  inferenceTargets: OrchestratorHostInferenceTargetSnapshot[] | undefined,
): boolean {
  const entry = availableModels.find((m) => m.id === selectedModelId)
  const isHost = entry?.type === 'host_internal' || isHostInferenceModelId(selectedModelId)
  if (!isHost) {
    return false
  }

  const p = parseAnyHostInferenceModelId(selectedModelId)
  const hid = p?.handshakeId ?? null
  const t = findHostInferenceTargetForHandshakeAndId(inferenceTargets, hid, selectedModelId)

  if (t) {
    if (isHostInferenceTargetPendingForRestore(t)) {
      return false
    }
    if (isHostInferenceTargetDefinitivelyInvalidForRestore(t)) {
      return true
    }
    return false
  }

  if (entry?.type === 'host_internal') {
    if (entry.hostSelectorState === 'checking') {
      return false
    }
    return !entry.hostTargetAvailable
  }

  return true
}

export type ValidateSelectionResult = {
  modelId: string
  error?: 'host_unavailable' | 'unknown_model'
}

export type OrchestratorSelectionValidateReason =
  | 'ok'
  | 'host_pending_p2p'
  | 'host_target_missing'
  | 'host_model_unavailable'
  | 'local_model_missing'
  | 'cloud_model_missing'

/** Single snapshot for orchestrator restore diagnostics / logging (renderer). */
export type OrchestratorSelectionDiagnostics = {
  provider: 'host_ai' | 'local_ollama' | 'cloud'
  saved: string
  kind: InferenceSelectionKind
  handshake: string | null
  source: 'inference_targets' | 'local_models' | 'cloud_models'
  matched_row_id: string | null
  available: boolean | null
  availability: string | null
  p2p_phase: string | null
  host_selector_state: string | null
  valid: boolean
  pending: boolean
  reason: OrchestratorSelectionValidateReason
}

export type ValidateSelectionResultWithDiagnostics = ValidateSelectionResult & {
  diagnostics: OrchestratorSelectionDiagnostics
}

function orchestratorDiagHostRowFields(
  t: OrchestratorHostInferenceTargetSnapshot,
): Pick<
  OrchestratorSelectionDiagnostics,
  'matched_row_id' | 'available' | 'availability' | 'p2p_phase' | 'host_selector_state'
> {
  return {
    matched_row_id: t.id,
    available: t.available,
    availability: t.availability != null && t.availability !== '' ? String(t.availability) : null,
    p2p_phase: t.p2pUiPhase ?? null,
    host_selector_state: (t.host_selector_state ?? t.hostSelectorState ?? null) as string | null,
  }
}

const emptyNonHostRowFields: Pick<
  OrchestratorSelectionDiagnostics,
  'matched_row_id' | 'available' | 'availability' | 'p2p_phase' | 'host_selector_state'
> = {
  matched_row_id: null,
  available: null,
  availability: null,
  p2p_phase: null,
  host_selector_state: null,
}

/**
 * Same rules as `validateStoredSelectionForOrchestrator` plus structured diagnostics for targeted logging.
 * Callers should dedupe logs when `diagnostics` + `modelId` + `error` are unchanged.
 */
export function validateStoredSelectionForOrchestratorWithDiagnostics(
  stored: StoredInferenceSelectionV1,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
  inferenceTargets: OrchestratorHostInferenceTargetSnapshot[] | undefined,
  isSandbox: boolean,
  hasLocalModelsInList: boolean,
): ValidateSelectionResultWithDiagnostics {
  const ak = accountKeyFromSession()

  if (stored.account_key && stored.account_key !== ak) {
    const reason: OrchestratorSelectionValidateReason =
      stored.kind === 'cloud' ? 'cloud_model_missing' : 'local_model_missing'
    return {
      modelId: '',
      error: 'unknown_model',
      diagnostics: {
        provider:
          stored.kind === 'host_internal' ? 'host_ai' : stored.kind === 'cloud' ? 'cloud' : 'local_ollama',
        saved: stored.id,
        kind: stored.kind,
        handshake: stored.kind === 'host_internal' ? resolveHostHandshakeIdFromInferenceSelection(stored) : null,
        source:
          stored.kind === 'host_internal'
            ? 'inference_targets'
            : stored.kind === 'cloud'
              ? 'cloud_models'
              : 'local_models',
        ...emptyNonHostRowFields,
        valid: false,
        pending: false,
        reason,
      },
    }
  }

  if (stored.kind === 'host_internal') {
    const hid = resolveHostHandshakeIdFromInferenceSelection(stored)
    const t = findHostInferenceTargetForHandshakeAndId(inferenceTargets, hid, stored.id)
    const row = t ? orchestratorDiagHostRowFields(t) : emptyNonHostRowFields

    if (!t) {
      return {
        modelId: '',
        error: 'host_unavailable',
        diagnostics: {
          provider: 'host_ai',
          saved: stored.id,
          kind: stored.kind,
          handshake: hid,
          source: 'inference_targets',
          ...row,
          valid: false,
          pending: false,
          reason: 'host_target_missing',
        },
      }
    }
    if (isHostInferenceTargetDefinitivelyInvalidForRestore(t)) {
      return {
        modelId: '',
        error: 'host_unavailable',
        diagnostics: {
          provider: 'host_ai',
          saved: stored.id,
          kind: stored.kind,
          handshake: hid,
          source: 'inference_targets',
          ...orchestratorDiagHostRowFields(t),
          valid: false,
          pending: false,
          reason: 'host_model_unavailable',
        },
      }
    }
    const pending = !t.available || isHostInferenceTargetPendingForRestore(t)
    return {
      modelId: stored.id,
      diagnostics: {
        provider: 'host_ai',
        saved: stored.id,
        kind: stored.kind,
        handshake: hid,
        source: 'inference_targets',
        ...orchestratorDiagHostRowFields(t),
        valid: true,
        pending,
        reason: pending ? 'host_pending_p2p' : 'ok',
      },
    }
  }

  if (stored.kind === 'local_ollama' && isSandbox && !hasLocalModelsInList) {
    return {
      modelId: '',
      error: 'unknown_model',
      diagnostics: {
        provider: 'local_ollama',
        saved: stored.id,
        kind: stored.kind,
        handshake: null,
        source: 'local_models',
        ...emptyNonHostRowFields,
        valid: false,
        pending: false,
        reason: 'local_model_missing',
      },
    }
  }

  if (availableModels.some((m) => m.id === stored.id)) {
    const isCloud = stored.kind === 'cloud'
    return {
      modelId: stored.id,
      diagnostics: {
        provider: isCloud ? 'cloud' : 'local_ollama',
        saved: stored.id,
        kind: stored.kind,
        handshake: null,
        source: isCloud ? 'cloud_models' : 'local_models',
        ...emptyNonHostRowFields,
        valid: true,
        pending: false,
        reason: 'ok',
      },
    }
  }

  const isCloud = stored.kind === 'cloud'
  return {
    modelId: '',
    error: 'unknown_model',
    diagnostics: {
      provider: isCloud ? 'cloud' : 'local_ollama',
      saved: stored.id,
      kind: stored.kind,
      handshake: null,
      source: isCloud ? 'cloud_models' : 'local_models',
      ...emptyNonHostRowFields,
      valid: false,
      pending: false,
      reason: isCloud ? 'cloud_model_missing' : 'local_model_missing',
    },
  }
}

export function validateStoredSelectionForOrchestrator(
  stored: StoredInferenceSelectionV1,
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
  inferenceTargets: OrchestratorHostInferenceTargetSnapshot[] | undefined,
  isSandbox: boolean,
  hasLocalModelsInList: boolean,
): ValidateSelectionResult {
  const r = validateStoredSelectionForOrchestratorWithDiagnostics(
    stored,
    availableModels,
    inferenceTargets,
    isSandbox,
    hasLocalModelsInList,
  )
  return { modelId: r.modelId, error: r.error }
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
  availableModels: Array<{ id: string; type: 'local' | 'cloud' | 'host_internal' }>,
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

/** Main bumps orchestrator build stamp — clear persisted Host-internal routing only. */
export function clearPersistedHostAiInferenceSelection(): void {
  try {
    if (readOrchestratorInferenceSelection()?.kind === 'host_internal') {
      clearOrchestratorInferenceSelection()
    }
  } catch {
    /* ignore */
  }
  try {
    if (readWrChatInferenceSelection()?.kind === 'host_internal') {
      clearWrChatInferenceSelection()
    }
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
