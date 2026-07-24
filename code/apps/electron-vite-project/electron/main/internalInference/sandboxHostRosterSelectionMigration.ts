/**
 * Sandbox-side selection hygiene on Host roster receipt (A4).
 *
 * When a Host BEAP ad delivers a model roster, the persisted remote selection
 * (`ai-execution-context.json`, lane `beap`/`ollama_direct`) is alias-resolved against that roster.
 * A selection that does not resolve (stale Ollama-era tag, removed model) is migrated ONCE to the
 * roster's active model instead of being sent to the Host verbatim (which ends in
 * MODEL_UNAVAILABLE). Alias spellings (path/filename) are normalized to the canonical name.
 */

import {
  readStoredAiExecutionContext,
  writeStoredAiExecutionContext,
} from '../llm/aiExecutionContextStore'
import {
  canonicalLocalModelName,
  dedupeCanonicalModelNames,
  resolveLocalModelAlias,
} from '../llm/localModelIdentity'
import type { HostAiBeapAdOllamaModelWireEntry } from './hostAiBeapAdOllamaModelCount'

const L = '[HOST_AI_SELECTION_MIGRATION]'

export function migrateStoredSelectionForReceivedHostRoster(input: {
  handshakeId: string
  rosterModels: readonly HostAiBeapAdOllamaModelWireEntry[]
  rosterActiveModelId: string | null
}): void {
  const hid = String(input.handshakeId ?? '').trim()
  if (!hid) return
  const rosterNames = dedupeCanonicalModelNames(
    input.rosterModels.map((m) => m.name || m.id).filter(Boolean),
  )
  if (rosterNames.length === 0) return

  const stored = readStoredAiExecutionContext()
  if (!stored) return
  if (stored.lane !== 'beap' && stored.lane !== 'ollama_direct') return
  const storedHid = stored.handshakeId?.trim() || ''
  if (storedHid && storedHid !== hid) return

  const resolved = resolveLocalModelAlias(stored.model, rosterNames)
  if (resolved && resolved === stored.model) {
    return // already canonical and present in roster
  }

  const activeCanonical =
    canonicalLocalModelName(input.rosterActiveModelId) || rosterNames[0]!
  const nextModel = resolved ?? activeCanonical
  const migrationKind = resolved ? 'alias_normalized' : 'unresolvable_migrated_to_active'

  writeStoredAiExecutionContext({
    ...stored,
    model: nextModel,
    models: rosterNames,
  })
  console.log(
    `${L} ${JSON.stringify({
      handshakeId: hid,
      storedModel: stored.model,
      migratedTo: nextModel,
      reason: migrationKind,
      rosterModels: rosterNames,
      rosterActiveModelId: input.rosterActiveModelId,
    })}`,
  )
}
