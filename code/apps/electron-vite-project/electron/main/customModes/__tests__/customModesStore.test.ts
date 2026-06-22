/**
 * Custom modes store — merge/dedupe, migration idempotency, concurrent-write safety.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CustomModeDefinition } from '../../../../extension-chromium/src/shared/ui/customModeTypes'

function makeMode(partial: Partial<CustomModeDefinition> & { id: string; name: string }): CustomModeDefinition {
  const now = partial.updatedAt ?? partial.createdAt ?? '2026-01-01T00:00:00.000Z'
  return {
    id: partial.id,
    type: partial.type ?? 'custom',
    deletable: partial.deletable,
    builtInKey: partial.builtInKey,
    name: partial.name,
    description: partial.description ?? '',
    icon: partial.icon ?? '⚡',
    modelProvider: partial.modelProvider ?? 'ollama',
    modelName: partial.modelName ?? 'llama3',
    endpoint: partial.endpoint ?? 'http://127.0.0.1:11434',
    sessionId: partial.sessionId ?? null,
    sessionMode: partial.sessionMode ?? 'shared',
    searchFocus: partial.searchFocus ?? '',
    ignoreInstructions: partial.ignoreInstructions ?? '',
    intervalSeconds: partial.intervalSeconds ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
    metadata: partial.metadata,
  }
}

type ElectronMockState = { userData: string }

function makeElectronMock(state: ElectronMockState) {
  return {
    app: {
      getPath: (name: string): string => {
        if (name === 'userData') return state.userData
        return path.join(state.userData, name)
      },
      isPackaged: false,
    },
  }
}

describe('customModesStore', () => {
  let tmpRoot: string
  let userData: string
  let electronState: ElectronMockState

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-custom-modes-'))
    userData = path.join(tmpRoot, 'userData')
    fs.mkdirSync(userData, { recursive: true })
    electronState = { userData }
    vi.resetModules()
    vi.doMock('electron', () => makeElectronMock(electronState))
    const { markUserDataPathBootstrapped } = await import('../../../userDataBootstrapState')
    markUserDataPathBootstrapped()
    const { resetCustomModesWriteLockForTests } = await import('../customModesStore')
    resetCustomModesWriteLockForTests()
  })

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('electron')
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('mergeCustomModes prefers newest updatedAt for same id', async () => {
    const { mergeCustomModes } = await import('../customModesStore')
    const existing = [
      makeMode({
        id: 'custom:a',
        name: 'Alpha',
        updatedAt: '2026-01-01T00:00:00.000Z',
        description: 'old',
      }),
    ]
    const incoming = [
      makeMode({
        id: 'custom:a',
        name: 'Alpha',
        updatedAt: '2026-02-01T00:00:00.000Z',
        description: 'new',
      }),
    ]
    const merged = mergeCustomModes(existing, incoming, true)
    expect(merged).toHaveLength(1)
    expect(merged[0].description).toBe('new')
  })

  it('mergeCustomModes on updatedAt tie prefers incoming batch', async () => {
    const { mergeCustomModes } = await import('../customModesStore')
    const ts = '2026-01-01T00:00:00.000Z'
    const existing = [makeMode({ id: 'custom:a', name: 'Alpha', updatedAt: ts, description: 'old' })]
    const incoming = [makeMode({ id: 'custom:a', name: 'Alpha', updatedAt: ts, description: 'incoming' })]
    const merged = mergeCustomModes(existing, incoming, true)
    expect(merged[0].description).toBe('incoming')
  })

  it('mergeCustomModes skips incoming duplicate name (different ids) and logs', async () => {
    const { mergeCustomModes } = await import('../customModesStore')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const existing = [makeMode({ id: 'custom:keep', name: 'Same Name' })]
    const incoming = [makeMode({ id: 'custom:skip', name: 'same name' })]
    const merged = mergeCustomModes(existing, incoming, true)
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe('custom:keep')
    expect(logSpy).toHaveBeenCalledWith(
      '[CustomModes] import skip duplicate name',
      expect.objectContaining({ nameKey: 'same name', incomingId: 'custom:skip' }),
    )
    logSpy.mockRestore()
  })

  it('importModes is idempotent when run twice with same legacy batch', async () => {
    const { importModes, listModes } = await import('../customModesStore')
    const legacy = [makeMode({ id: 'custom:legacy-1', name: 'Legacy One' })]
    const first = await importModes(legacy, 'extension')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.filter((m) => m.id.startsWith('custom:'))).toHaveLength(1)

    const second = await importModes(legacy, 'extension')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.filter((m) => m.id.startsWith('custom:'))).toHaveLength(1)
    expect(listModes().filter((m) => m.id.startsWith('custom:'))).toHaveLength(1)
  })

  it('concurrent writes re-read file so neither mutation is dropped', async () => {
    const { createMode, listModes } = await import('../customModesStore')
    const draftA = {
      name: 'Concurrent A',
      description: '',
      icon: '⚡',
      modelProvider: 'ollama',
      modelName: 'model-a',
      endpoint: 'http://127.0.0.1:11434',
      sessionId: null as string | null,
      sessionMode: 'shared' as const,
      searchFocus: '',
      ignoreInstructions: '',
      intervalSeconds: null as number | null,
    }
    const draftB = {
      ...draftA,
      name: 'Concurrent B',
      modelName: 'model-b',
    }

    const [resA, resB] = await Promise.all([createMode(draftA), createMode(draftB)])
    expect(resA.ok).toBe(true)
    expect(resB.ok).toBe(true)
    const modes = listModes()
    expect(modes.some((m) => m.name === 'Concurrent A')).toBe(true)
    expect(modes.some((m) => m.name === 'Concurrent B')).toBe(true)
    expect(modes.filter((m) => m.id.startsWith('custom:'))).toHaveLength(2)
  })

  it('createMode rejects duplicate names', async () => {
    const { createMode } = await import('../customModesStore')
    const draft = {
      name: 'Dup',
      description: '',
      icon: '⚡',
      modelProvider: 'ollama',
      modelName: 'm1',
      endpoint: 'http://127.0.0.1:11434',
      sessionId: null as string | null,
      sessionMode: 'shared' as const,
      searchFocus: '',
      ignoreInstructions: '',
      intervalSeconds: null as number | null,
    }
    const first = await createMode(draft)
    expect(first.ok).toBe(true)
    const second = await createMode({ ...draft, modelName: 'm2' })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error).toMatch(/already exists/i)
    }
  })

  it('profileFields round-trip through create, reload, and update', async () => {
    const { createMode, listModes, updateMode } = await import('../customModesStore')
    const draft = {
      name: 'Profile Mode',
      description: '',
      icon: '⚡',
      modelProvider: 'ollama',
      modelName: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
      sessionId: null as string | null,
      sessionMode: 'shared' as const,
      searchFocus: 'jobs',
      ignoreInstructions: '',
      profileFields: [
        { key: 'goals', label: 'Goals', value: 'Staff engineer', type: 'longtext' as const },
        { key: 'location', label: 'Location', value: 'Remote', type: 'text' as const },
      ],
      intervalSeconds: null as number | null,
    }
    const created = await createMode(draft)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const createdMode = created.data.find((m) => m.name === 'Profile Mode')
    expect(createdMode?.profileFields).toEqual(draft.profileFields)

    const reloaded = listModes().find((m) => m.id === createdMode?.id)
    expect(reloaded?.profileFields).toEqual(draft.profileFields)

    const updated = await updateMode(createdMode!.id, {
      ...draft,
      profileFields: [
        { key: 'goals', label: 'Goals', value: 'Principal engineer', type: 'longtext' as const },
        { key: 'location', label: 'Location', value: 'Hybrid London', type: 'text' as const },
        { key: 'donts', label: "Don'ts", value: 'No agencies', type: 'text' as const },
      ],
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return

    const afterEdit = listModes().find((m) => m.id === createdMode!.id)
    expect(afterEdit?.profileFields).toHaveLength(3)
    expect(afterEdit?.profileFields?.[0].value).toBe('Principal engineer')
  })
})

describe('migrateCustomModesPersistedState (unchanged helper)', () => {
  it('still coerces legacy nested rows', async () => {
    const { migrateCustomModesPersistedState } = await import(
      '../../../../../extension-chromium/src/shared/ui/customModePersistence'
    )
    const legacy = {
      state: {
        modes: [
          {
            id: 'custom:legacy-nested',
            name: 'Nested',
            icon: '⚡',
            model: { provider: 'ollama', modelName: 'x', endpoint: 'http://127.0.0.1:11434' },
            session: { sessionMode: 'shared' },
            focus: { lookFor: 'stuff' },
            runBehavior: 'manual',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }
    const migrated = migrateCustomModesPersistedState(legacy, 1)
    expect(migrated.state.modes).toHaveLength(1)
    expect(migrated.state.modes[0].id).toBe('custom:legacy-nested')
    expect(migrated.state.modes[0].searchFocus).toBe('stuff')
  })
})
