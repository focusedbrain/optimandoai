/**
 * A4 regression: on Host roster receipt, the persisted Sandbox selection is alias-resolved against
 * the roster; unresolvable selections (stale Ollama tags) migrate to the roster's active model
 * instead of being resent verbatim (which ends in MODEL_UNAVAILABLE on the Host).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readStored = vi.hoisted(() => vi.fn())
const writeStored = vi.hoisted(() => vi.fn())
vi.mock('../../llm/aiExecutionContextStore', () => ({
  readStoredAiExecutionContext: () => readStored(),
  writeStoredAiExecutionContext: (ctx: unknown) => writeStored(ctx),
}))

import { migrateStoredSelectionForReceivedHostRoster } from '../sandboxHostRosterSelectionMigration'

const CANON = 'gemma-4-12B-it-Q4_K_M'
const WIN_PATH = `C:\\Users\\oscar\\.opengiraffe\\electron-data\\models\\${CANON}.gguf`
const HID = 'hs-e8a385c7'

const roster = (names: string[], active: string | null) => ({
  handshakeId: HID,
  rosterModels: names.map((n) => ({
    id: n,
    name: n,
    provider: 'llamacpp' as const,
    available: true,
    active: n === active,
  })),
  rosterActiveModelId: active,
})

describe('migrateStoredSelectionForReceivedHostRoster', () => {
  beforeEach(() => {
    readStored.mockReset()
    writeStored.mockReset()
  })

  it('migrates a stale Ollama tag selection to the roster active model (once, logged)', () => {
    readStored.mockReturnValue({
      lane: 'beap',
      model: 'gemma4:12b-it-q8_0',
      handshakeId: HID,
    })
    migrateStoredSelectionForReceivedHostRoster(roster([CANON], CANON))
    expect(writeStored).toHaveBeenCalledWith(
      expect.objectContaining({ model: CANON, models: [CANON] }),
    )
  })

  it('normalizes a path-spelled selection to the canonical name', () => {
    readStored.mockReturnValue({ lane: 'beap', model: WIN_PATH, handshakeId: HID })
    migrateStoredSelectionForReceivedHostRoster(roster([CANON], CANON))
    expect(writeStored).toHaveBeenCalledWith(expect.objectContaining({ model: CANON }))
  })

  it('does nothing when the selection is already canonical and in the roster', () => {
    readStored.mockReturnValue({ lane: 'beap', model: CANON, handshakeId: HID })
    migrateStoredSelectionForReceivedHostRoster(roster([CANON], CANON))
    expect(writeStored).not.toHaveBeenCalled()
  })

  it('does not touch selections for other handshakes or local lane', () => {
    readStored.mockReturnValue({ lane: 'beap', model: 'x', handshakeId: 'hs-other' })
    migrateStoredSelectionForReceivedHostRoster(roster([CANON], CANON))
    expect(writeStored).not.toHaveBeenCalled()

    readStored.mockReturnValue({ lane: 'local', model: 'x' })
    migrateStoredSelectionForReceivedHostRoster(roster([CANON], CANON))
    expect(writeStored).not.toHaveBeenCalled()
  })

  it('dedupes path/name duplicates in the received roster', () => {
    readStored.mockReturnValue({
      lane: 'beap',
      model: 'gemma4:12b-it-q8_0',
      handshakeId: HID,
    })
    migrateStoredSelectionForReceivedHostRoster(roster([WIN_PATH, CANON], CANON))
    expect(writeStored).toHaveBeenCalledWith(
      expect.objectContaining({ model: CANON, models: [CANON] }),
    )
  })
})
