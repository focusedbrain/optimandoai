/**
 * WR Chat selection hygiene (extension mirror of build042 A4):
 *
 * The three extension WR chat surfaces (sidebar, popup, active-mode run) persist a route id like
 * `host-internal:<hid>:<encModel>` in `localStorage['optimando-wr-chat-active-model']`. When the
 * Host migrates to canonical model names, a stale URL-encoded Ollama tag (e.g. `gemma4%3A12b-it-q8_0`)
 * no longer matches any roster row and every send ends in MODEL_UNAVAILABLE. This module resolves
 * the stored selection against the CURRENT host rows via alias resolution (decode first — the %3A
 * case), migrates unresolvable selections once to the roster's active model
 * (`[WRCHAT_SELECTION_MIGRATION]`), and yields the canonical wire model for outbound requests.
 *
 * The genuine empty case (no host rows / roster without models / host offline) is NOT healed here —
 * the caller keeps its existing error path.
 */

import { parseAnyHostInferenceModelId } from './hostInferenceRouteIds'
import { canonicalLocalModelName, resolveLocalModelAlias } from './localModelIdentity'
import {
  loadPersistedWrChatExtensionModel,
  persistWrChatExtensionModelId,
} from './wrChatExtensionModelPersistence'

export type WrChatHostRowLike = {
  /** Route id (`host-internal:<encHid>:<encModel>` for host rows). */
  name: string
  hostAi?: boolean
  isHostActiveModel?: boolean
  hostActiveModel?: string | null
  hostLocalModelName?: string
}

export type WrChatHostSelectionResolution = {
  /** Row id to route with — the original selection, or the migrated roster row id. */
  effectiveModelId: string
  /** Canonical model name for the outbound request (undefined for legacy ids without a model). */
  wireModel: string | undefined
  handshakeId: string | null
  migrated: boolean
  migrationReason: 'alias_normalized' | 'unresolvable_migrated_to_active' | null
}

function hostRowsForHandshake(
  rows: readonly WrChatHostRowLike[] | undefined,
  handshakeId: string,
): Array<{ row: WrChatHostRowLike; model: string | undefined }> {
  const out: Array<{ row: WrChatHostRowLike; model: string | undefined }> = []
  for (const row of rows ?? []) {
    const parsed = parseAnyHostInferenceModelId(row.name)
    if (!parsed) continue
    if (handshakeId && parsed.handshakeId !== handshakeId) continue
    out.push({ row, model: parsed.model ?? row.hostActiveModel?.trim() ?? undefined })
  }
  return out
}

/**
 * Resolve (and, when needed, migrate) a WR Chat host selection against the current selector rows.
 * Non-host ids pass through untouched. Idempotent: a canonical selection that matches a row
 * resolves to itself with `migrated: false`.
 */
export function resolveWrChatHostSelectionForSend(args: {
  surface: string
  selectedModelId: string
  availableModels: readonly WrChatHostRowLike[] | undefined
  /** Persist the migrated id to the shared WR chat storage when it currently holds the stale id. Default true. */
  persist?: boolean
}): WrChatHostSelectionResolution {
  const selectedId = String(args.selectedModelId ?? '').trim()
  const parsed = parseAnyHostInferenceModelId(selectedId)
  if (!parsed) {
    return {
      effectiveModelId: selectedId,
      wireModel: undefined,
      handshakeId: null,
      migrated: false,
      migrationReason: null,
    }
  }

  const candidates = hostRowsForHandshake(args.availableModels, parsed.handshakeId)
  const rosterNames = candidates
    .map((c) => canonicalLocalModelName(c.model))
    .filter((n): n is string => Boolean(n))

  const noMigration = (wire: string | undefined): WrChatHostSelectionResolution => ({
    effectiveModelId: selectedId,
    wireModel: wire,
    handshakeId: parsed.handshakeId,
    migrated: false,
    migrationReason: null,
  })

  // Genuinely empty roster (no host rows with a model for this handshake): do not heal — keep the
  // caller's error path. Still canonicalize outbound (path/.gguf spellings).
  if (rosterNames.length === 0) {
    return noMigration(canonicalLocalModelName(parsed.model) || undefined)
  }

  // Legacy id without a model tail: route with the roster active model, no persisted change needed.
  if (!parsed.model) {
    const active =
      candidates.find((c) => c.row.isHostActiveModel === true) ?? candidates[0]!
    return noMigration(canonicalLocalModelName(active.model) || undefined)
  }

  const resolved = resolveLocalModelAlias(parsed.model, rosterNames)
  if (resolved) {
    // Alias (path / filename / encoded) of a roster model: normalize to that row's id.
    const match = candidates.find((c) => canonicalLocalModelName(c.model) === resolved)
    const targetId = match?.row.name ?? selectedId
    if (targetId === selectedId) {
      return noMigration(resolved)
    }
    finishMigration(args, selectedId, targetId, 'alias_normalized')
    return {
      effectiveModelId: targetId,
      wireModel: resolved,
      handshakeId: parsed.handshakeId,
      migrated: true,
      migrationReason: 'alias_normalized',
    }
  }

  // Unresolvable (stale Ollama-era tag): migrate once to the roster's active model.
  const active = candidates.find((c) => c.row.isHostActiveModel === true) ?? candidates[0]!
  const targetId = active.row.name
  const wire = canonicalLocalModelName(active.model) || undefined
  finishMigration(args, selectedId, targetId, 'unresolvable_migrated_to_active')
  return {
    effectiveModelId: targetId,
    wireModel: wire,
    handshakeId: parsed.handshakeId,
    migrated: true,
    migrationReason: 'unresolvable_migrated_to_active',
  }
}

function finishMigration(
  args: { surface: string; persist?: boolean },
  stored: string,
  replacedWith: string,
  reason: 'alias_normalized' | 'unresolvable_migrated_to_active',
): void {
  console.log(
    `[WRCHAT_SELECTION_MIGRATION] ${JSON.stringify({
      surface: args.surface,
      stored,
      replaced_with: replacedWith,
      reason,
    })}`,
  )
  if (args.persist === false) return
  try {
    const persisted = loadPersistedWrChatExtensionModel()
    // Only rewrite storage when it actually holds the stale id (idempotent; keeps the user's
    // explicit selection semantics on the migrated row).
    if (persisted?.modelId === stored) {
      persistWrChatExtensionModelId(replacedWith, persisted.selectionSource)
    }
  } catch {
    /* storage unavailable (test / non-DOM context) — routing still healed for this send */
  }
}
