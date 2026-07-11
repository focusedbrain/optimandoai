/**
 * WR Chat extension: resolve + migrate Host model selections against the received roster (A4 semantics).
 *
 * Stale Ollama-era tags (including URL-encoded route tails like `gemma4%3A12b-it-q8_0`) are alias-resolved
 * against `wrChatAvailableModels`; unresolvable selections migrate to the roster active model once.
 */

import {
  canonicalLocalModelName,
  dedupeCanonicalModelNames,
  localModelIdsMatch,
  resolveLocalModelAlias,
} from '@shared/llm/localModelIdentity'
import {
  hostInternalInferenceModelId,
  isHostInferenceRouteId,
  parseAnyHostInferenceModelId,
} from './hostInferenceRouteIds'
import {
  loadPersistedWrChatExtensionModel,
  persistWrChatExtensionModelId,
  type WrChatExtensionSelectionSource,
} from './wrChatExtensionModelPersistence'
import type { WrChatSelectorRow } from './wrChatModelsFromLlmStatus'
import { chooseDefaultWrChatModel } from './wrChatModelsFromLlmStatus'

export type WrChatHostSelectionSurface = 'sidebar_wrchat' | 'popup_wrchat' | 'active_mode_wrchat'

const MIGRATION_LOG = '[WRCHAT_SELECTION_MIGRATION]'

const EPHEMERAL_HOST_MODEL_TAILS = new Set([
  'checking',
  'unavailable',
  'connecting',
  'offline',
  'unreachable',
  'unconfigured',
  'inactive',
  '—',
])

function isEphemeralHostModelTail(model: string | null | undefined): boolean {
  const m = String(model ?? '').trim()
  return !m || EPHEMERAL_HOST_MODEL_TAILS.has(m)
}

export function extractHostRosterModelNames(rows: readonly WrChatSelectorRow[]): string[] {
  const raw: string[] = []
  for (const r of rows) {
    if (!r.hostAi) continue
    if (r.hostActiveModel && !isEphemeralHostModelTail(r.hostActiveModel)) {
      raw.push(r.hostActiveModel)
    }
    const parsed = parseAnyHostInferenceModelId(r.name)
    if (parsed?.model && !isEphemeralHostModelTail(parsed.model)) raw.push(parsed.model)
  }
  return dedupeCanonicalModelNames(raw)
}

export function hostRosterHasModels(rows: readonly WrChatSelectorRow[]): boolean {
  return extractHostRosterModelNames(rows).length > 0
}

export function isHostWrChatOffline(rows: readonly WrChatSelectorRow[]): boolean {
  const hostRows = rows.filter((r) => r.hostAi)
  return hostRows.length > 0 && hostRows.every((r) => r.hostAvailable === false)
}

function findHostRowForHandshake(
  rows: readonly WrChatSelectorRow[],
  handshakeId: string,
  wireModel?: string | null,
): WrChatSelectorRow | undefined {
  const hid = handshakeId.trim()
  if (!hid) return undefined
  for (const r of rows) {
    if (!r.hostAi) continue
    const p = parseAnyHostInferenceModelId(r.name)
    if (p?.handshakeId !== hid) continue
    if (!wireModel) return r
    if (p.model && localModelIdsMatch(p.model, wireModel)) return r
    if (r.hostActiveModel && localModelIdsMatch(r.hostActiveModel, wireModel)) return r
  }
  return rows.find((r) => {
    if (!r.hostAi || !r.isHostActiveModel) return false
    const p = parseAnyHostInferenceModelId(r.name)
    return p?.handshakeId === hid
  })
}

function rosterActiveCanonical(rows: readonly WrChatSelectorRow[], handshakeId: string): string | null {
  const row = findHostRowForHandshake(rows, handshakeId)
  const names = extractHostRosterModelNames(rows)
  return canonicalLocalModelName(row?.hostActiveModel) || names[0] || null
}

export type WrChatHostSelectionMigrationResult = {
  modelId: string
  migrated: boolean
  reason?: 'alias_normalized' | 'unresolvable_migrated_to_active' | 'route_id_rebuilt'
}

/**
 * Resolve a stored host-internal route id against the current roster; rebuild id with canonical wire model when needed.
 */
export function migrateWrChatHostSelectionId(
  storedId: string,
  rows: readonly WrChatSelectorRow[],
  surface: WrChatHostSelectionSurface,
): WrChatHostSelectionMigrationResult {
  const id = String(storedId ?? '').trim()
  if (!id || !isHostInferenceRouteId(id)) {
    return { modelId: id, migrated: false }
  }

  const parsed = parseAnyHostInferenceModelId(id)
  if (!parsed?.handshakeId) {
    return { modelId: id, migrated: false }
  }

  const rosterNames = extractHostRosterModelNames(rows)
  if (rosterNames.length === 0) {
    return { modelId: id, migrated: false }
  }

  const storedModel = parsed.model?.trim() || ''
  const resolvedWire = storedModel ? resolveLocalModelAlias(storedModel, rosterNames) : null
  const activeCanonical = rosterActiveCanonical(rows, parsed.handshakeId)
  const nextWire = resolvedWire ?? activeCanonical
  if (!nextWire) {
    return { modelId: id, migrated: false }
  }

  const matchingRow = findHostRowForHandshake(rows, parsed.handshakeId, nextWire)
  const rebuiltId =
    matchingRow?.name ??
    (storedModel || parsed.model !== undefined
      ? hostInternalInferenceModelId(parsed.handshakeId, nextWire)
      : id)

  const alreadyCanonical =
    rebuiltId === id &&
    (!storedModel || (resolvedWire != null && resolvedWire === canonicalLocalModelName(storedModel)))
  if (alreadyCanonical) {
    return { modelId: id, migrated: false }
  }

  const reason: WrChatHostSelectionMigrationResult['reason'] = resolvedWire
    ? rebuiltId !== id
      ? 'route_id_rebuilt'
      : 'alias_normalized'
    : 'unresolvable_migrated_to_active'

  console.log(
    `${MIGRATION_LOG} ${JSON.stringify({
      surface,
      stored: id,
      replaced_with: rebuiltId,
      reason,
    })}`,
  )
  return { modelId: rebuiltId, migrated: true, reason }
}

/** Canonical wire model for outbound Host inference (decode route tail + alias-resolve against roster). */
export function resolveWrChatHostWireModelForSend(
  parsed: { handshakeId: string; model?: string } | null | undefined,
  row: WrChatSelectorRow | undefined,
  rows: readonly WrChatSelectorRow[],
): string | undefined {
  const rosterNames = extractHostRosterModelNames(rows)
  if (rosterNames.length === 0) {
    const fallback = parsed?.model?.trim() || row?.hostActiveModel?.trim()
    return fallback ? canonicalLocalModelName(fallback) || undefined : undefined
  }

  const raw = parsed?.model?.trim() || row?.hostActiveModel?.trim()
  if (!raw) {
    const active = rosterActiveCanonical(rows, parsed?.handshakeId ?? '')
    return active || undefined
  }

  const resolved = resolveLocalModelAlias(raw, rosterNames)
  if (resolved) return resolved

  const active = rosterActiveCanonical(rows, parsed?.handshakeId ?? '')
  return active || canonicalLocalModelName(raw) || undefined
}

export function persistMigratedWrChatExtensionSelection(
  modelId: string,
  selectionSource: WrChatExtensionSelectionSource,
): void {
  persistWrChatExtensionModelId(modelId, selectionSource)
}

/**
 * Align persisted + in-memory selection with roster (idempotent migration). Returns null when roster is empty.
 */
export function reconcileWrChatExtensionModelWithRoster(
  currentModelId: string | undefined,
  rows: readonly WrChatSelectorRow[],
  surface: WrChatHostSelectionSurface,
): { modelId: string | null; selectionSource: WrChatExtensionSelectionSource } {
  if (rows.length === 0) {
    return { modelId: null, selectionSource: 'auto' }
  }

  const persisted = loadPersistedWrChatExtensionModel()
  let effectiveId = (currentModelId?.trim() || persisted?.modelId || '').trim()
  let selectionSource: WrChatExtensionSelectionSource = persisted?.selectionSource ?? 'auto'

  if (effectiveId && isHostInferenceRouteId(effectiveId)) {
    const migrated = migrateWrChatHostSelectionId(effectiveId, rows, surface)
    if (migrated.migrated) {
      effectiveId = migrated.modelId
      persistMigratedWrChatExtensionSelection(effectiveId, selectionSource)
    }
  }

  if (persisted?.modelId && isHostInferenceRouteId(persisted.modelId) && persisted.modelId !== effectiveId) {
    const migratedPersisted = migrateWrChatHostSelectionId(persisted.modelId, rows, surface)
    if (migratedPersisted.migrated) {
      effectiveId = migratedPersisted.modelId
      selectionSource = persisted.selectionSource
      persistMigratedWrChatExtensionSelection(effectiveId, selectionSource)
    }
  }

  if (effectiveId && rows.some((r) => r.name === effectiveId)) {
    return { modelId: effectiveId, selectionSource }
  }

  if (effectiveId && isHostInferenceRouteId(effectiveId)) {
    const parsed = parseAnyHostInferenceModelId(effectiveId)
    if (parsed?.handshakeId) {
      const row = findHostRowForHandshake(rows, parsed.handshakeId)
      if (row?.name) {
        if (row.name !== effectiveId) {
          persistMigratedWrChatExtensionSelection(row.name, selectionSource)
        }
        return { modelId: row.name, selectionSource }
      }
    }
  }

  if (persisted?.selectionSource === 'user' && effectiveId && !rows.some((r) => r.name === effectiveId)) {
    // After migration attempt, unknown user selection — fall through to default.
  }

  const fallback = chooseDefaultWrChatModel([...rows])
  return { modelId: fallback, selectionSource: 'auto' }
}

export function resolveWrChatExtensionModelForSend(
  modelId: string,
  rows: readonly WrChatSelectorRow[],
  surface: WrChatHostSelectionSurface,
): { modelId: string; wireModel?: string; error?: string } {
  const id = String(modelId ?? '').trim()
  if (!id) {
    return { modelId: id, error: 'HOST_NO_ACTIVE_LOCAL_LLM' }
  }

  if (!isHostInferenceRouteId(id)) {
    return { modelId: id }
  }

  if (isHostWrChatOffline(rows)) {
    return {
      modelId: id,
      error:
        'This Host model is not available. Pick another model or check the model and AI settings on the Host machine.',
    }
  }

  const rosterNames = extractHostRosterModelNames(rows)
  if (rosterNames.length === 0) {
    return { modelId: id, error: 'HOST_NO_ACTIVE_LOCAL_LLM' }
  }

  const migrated = migrateWrChatHostSelectionId(id, rows, surface)
  const resolvedId = migrated.migrated ? migrated.modelId : id
  if (migrated.migrated) {
    const persisted = loadPersistedWrChatExtensionModel()
    persistMigratedWrChatExtensionSelection(resolvedId, persisted?.selectionSource ?? 'auto')
  }

  const row = rows.find((r) => r.name === resolvedId) ?? findHostRowForHandshake(rows, parseAnyHostInferenceModelId(resolvedId)?.handshakeId ?? '')
  const parsed = parseAnyHostInferenceModelId(resolvedId)
  const wireModel = resolveWrChatHostWireModelForSend(parsed, row, rows)
  return { modelId: resolvedId, wireModel }
}
