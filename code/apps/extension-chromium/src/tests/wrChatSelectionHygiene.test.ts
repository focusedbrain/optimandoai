/**
 * @vitest-environment jsdom
 *
 * Extension A4 mirror: WR chat selection hygiene against the current host rows.
 * - URL-encoded stale Ollama tag → one-time migration to the roster's active model (persisted).
 * - Canonical selection matching a row → passes untouched.
 * - Empty roster → no healing, error path stays with the caller.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { resolveWrChatHostSelectionForSend } from '../lib/wrChatSelectionHygiene'
import {
  loadPersistedWrChatExtensionModel,
  persistWrChatExtensionModelId,
} from '../lib/wrChatExtensionModelPersistence'
import { canonicalLocalModelName, resolveLocalModelAlias } from '../lib/localModelIdentity'

const HID = 'hs-e8a385c7'
const CANON = 'gemma-4-12B-it-Q4_K_M'
const WIN_PATH = `C:\\Users\\oscar\\.opengiraffe\\electron-data\\models\\${CANON}.gguf`

const hostRowId = (model: string) =>
  `host-internal:${encodeURIComponent(HID)}:${encodeURIComponent(model)}`

const STALE_ID = hostRowId('gemma4:12b-it-q8_0') // encodes ':' as %3A
const CANON_ID = hostRowId(CANON)

const canonRow = { name: CANON_ID, hostAi: true, isHostActiveModel: true, hostActiveModel: CANON }

describe('resolveWrChatHostSelectionForSend', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('migrates a URL-encoded stale Ollama tag to the roster active model and persists', () => {
    persistWrChatExtensionModelId(STALE_ID, 'user')
    const r = resolveWrChatHostSelectionForSend({
      surface: 'sidebar_wrchat',
      selectedModelId: STALE_ID,
      availableModels: [canonRow],
    })
    expect(r.migrated).toBe(true)
    expect(r.migrationReason).toBe('unresolvable_migrated_to_active')
    expect(r.effectiveModelId).toBe(CANON_ID)
    expect(r.wireModel).toBe(CANON)
    expect(r.handshakeId).toBe(HID)
    // storage rewritten once, selection source preserved
    const persisted = loadPersistedWrChatExtensionModel()
    expect(persisted?.modelId).toBe(CANON_ID)
    expect(persisted?.selectionSource).toBe('user')
    // idempotent: second run is a no-op pass-through
    const r2 = resolveWrChatHostSelectionForSend({
      surface: 'sidebar_wrchat',
      selectedModelId: CANON_ID,
      availableModels: [canonRow],
    })
    expect(r2.migrated).toBe(false)
    expect(r2.effectiveModelId).toBe(CANON_ID)
  })

  it('canonical selection matching a row passes untouched', () => {
    const r = resolveWrChatHostSelectionForSend({
      surface: 'popup_wrchat',
      selectedModelId: CANON_ID,
      availableModels: [canonRow],
    })
    expect(r.migrated).toBe(false)
    expect(r.effectiveModelId).toBe(CANON_ID)
    expect(r.wireModel).toBe(CANON)
  })

  it('normalizes a path-spelled selection onto the canonical roster row (alias_normalized)', () => {
    const pathId = hostRowId(WIN_PATH)
    persistWrChatExtensionModelId(pathId, 'auto')
    const r = resolveWrChatHostSelectionForSend({
      surface: 'mode_run_agent',
      selectedModelId: pathId,
      availableModels: [canonRow],
    })
    expect(r.migrated).toBe(true)
    expect(r.migrationReason).toBe('alias_normalized')
    expect(r.effectiveModelId).toBe(CANON_ID)
    expect(r.wireModel).toBe(CANON)
    expect(loadPersistedWrChatExtensionModel()?.modelId).toBe(CANON_ID)
  })

  it('does NOT heal on an empty roster — selection and storage stay, error path remains', () => {
    persistWrChatExtensionModelId(STALE_ID, 'user')
    const r = resolveWrChatHostSelectionForSend({
      surface: 'sidebar_wrchat',
      selectedModelId: STALE_ID,
      availableModels: [],
    })
    expect(r.migrated).toBe(false)
    expect(r.effectiveModelId).toBe(STALE_ID)
    expect(r.wireModel).toBe('gemma4:12b-it-q8_0')
    expect(loadPersistedWrChatExtensionModel()?.modelId).toBe(STALE_ID)
  })

  it('non-host ids pass through untouched', () => {
    const r = resolveWrChatHostSelectionForSend({
      surface: 'sidebar_wrchat',
      selectedModelId: 'llama3.1:8b',
      availableModels: [canonRow],
    })
    expect(r.migrated).toBe(false)
    expect(r.effectiveModelId).toBe('llama3.1:8b')
    expect(r.wireModel).toBeUndefined()
  })
})

describe('localModelIdentity mirror parity with electron source', async () => {
  // Guard against silent divergence of the mirrored module: compare behavior with the single
  // source of truth in electron-vite-project on a fixture set.
  const electron = await import(
    '../../../electron-vite-project/electron/main/llm/localModelIdentity'
  )

  it('canonicalLocalModelName matches electron implementation', () => {
    const fixtures = [WIN_PATH, `${CANON}.gguf`, CANON, 'gemma4:12b-it-q8_0', '', 'model.GGUF', '/a/b/x.gguf']
    for (const f of fixtures) {
      expect(canonicalLocalModelName(f)).toBe(electron.canonicalLocalModelName(f))
    }
  })

  it('resolveLocalModelAlias matches electron implementation', () => {
    const installedSets = [[CANON], [WIN_PATH], [CANON, WIN_PATH], []]
    const requests = [WIN_PATH, CANON, `${CANON}.gguf`, 'gemma4:12b-it-q8_0', '']
    for (const installed of installedSets) {
      for (const req of requests) {
        expect(resolveLocalModelAlias(req, installed)).toBe(
          electron.resolveLocalModelAlias(req, installed),
        )
      }
    }
  })
})
