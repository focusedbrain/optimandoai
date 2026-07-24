/**
 * Built-in Scam Watchdog — store seed, delete guard, watchdogService resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_SCAM_WATCHDOG_ID } from '../../../../../extension-chromium/src/shared/ui/scamWatchdogBuiltIn'
import { isModeDeletable } from '../../../../../extension-chromium/src/shared/ui/customModeTypes'

function makeElectronMock(userData: string) {
  return {
    app: {
      getPath: (name: string): string => (name === 'userData' ? userData : path.join(userData, name)),
      isPackaged: false,
    },
  }
}

describe('built-in Scam Watchdog store', () => {
  let tmpRoot: string
  let userData: string

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-scam-watchdog-'))
    userData = path.join(tmpRoot, 'userData')
    fs.mkdirSync(userData, { recursive: true })
    vi.resetModules()
    vi.doMock('electron', () => makeElectronMock(userData))
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

  it('seeds Scam Watchdog on first store read and does not duplicate on restart', async () => {
    const { listModes } = await import('../customModesStore')
    const first = listModes()
    expect(first.some((m) => m.id === BUILTIN_SCAM_WATCHDOG_ID)).toBe(true)
    expect(first.filter((m) => m.id === BUILTIN_SCAM_WATCHDOG_ID)).toHaveLength(1)

    vi.resetModules()
    vi.doMock('electron', () => makeElectronMock(userData))
    const { markUserDataPathBootstrapped } = await import('../../../userDataBootstrapState')
    markUserDataPathBootstrapped()
    const { listModes: listAgain } = await import('../customModesStore')
    const second = listAgain()
    expect(second.filter((m) => m.id === BUILTIN_SCAM_WATCHDOG_ID)).toHaveLength(1)
  })

  it('rejects delete for built-in Scam Watchdog', async () => {
    const { listModes, deleteMode } = await import('../customModesStore')
    listModes()
    const res = await deleteMode(BUILTIN_SCAM_WATCHDOG_ID)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/cannot be deleted/i)
  })

  it('allows editing instructions and model allocation', async () => {
    const { listModes, updateMode, getModeById } = await import('../customModesStore')
    listModes()
    const updated = await updateMode(BUILTIN_SCAM_WATCHDOG_ID, {
      searchFocus: 'Custom scam detection instructions',
      modelName: 'llava:13b',
    })
    expect(updated.ok).toBe(true)
    const mode = getModeById(BUILTIN_SCAM_WATCHDOG_ID)
    expect(mode?.searchFocus).toBe('Custom scam detection instructions')
    expect(mode?.modelName).toBe('llava:13b')
    expect(mode?.type).toBe('built-in')
    expect(isModeDeletable(mode!)).toBe(false)
  })
})

describe('watchdogService built-in mode reads', () => {
  let tmpRoot: string
  let userData: string

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-watchdog-resolve-'))
    userData = path.join(tmpRoot, 'userData')
    fs.mkdirSync(userData, { recursive: true })
    vi.resetModules()
    vi.doMock('electron', () => makeElectronMock(userData))
    const { markUserDataPathBootstrapped } = await import('../../../userDataBootstrapState')
    markUserDataPathBootstrapped()
    const { resetCustomModesWriteLockForTests } = await import('../customModesStore')
    resetCustomModesWriteLockForTests()
    const { listModes } = await import('../customModesStore')
    listModes()
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

  it('uses WATCHDOG_SYSTEM_PROMPT for scan when searchFocus is chat-only', async () => {
    const { updateMode } = await import('../customModesStore')
    await updateMode(BUILTIN_SCAM_WATCHDOG_ID, { searchFocus: 'Chat-only scam hint for users' })
    const { resolveWatchdogSystemPromptFromMode } = await import('../../../watchdog/watchdogService')
    const { WATCHDOG_SYSTEM_PROMPT } = await import(
      '../../../../../extension-chromium/src/shared/ui/watchdogPrompts'
    )
    expect(resolveWatchdogSystemPromptFromMode()).toBe(WATCHDOG_SYSTEM_PROMPT)
    expect(resolveWatchdogSystemPromptFromMode()).toContain('"threats"')
  })

  it('still resolves legacy bundled searchFocus to scan prompt for watchdog scan', async () => {
    const { updateMode } = await import('../customModesStore')
    const { SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS } = await import(
      '../../../../../extension-chromium/src/shared/ui/watchdogPrompts'
    )
    await updateMode(BUILTIN_SCAM_WATCHDOG_ID, { searchFocus: SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS })
    const { resolveWatchdogSystemPromptFromMode } = await import('../../../watchdog/watchdogService')
    const prompt = resolveWatchdogSystemPromptFromMode()
    expect(prompt).toContain('Respond ONLY with a JSON object')
    expect(prompt).toContain('"threats"')
  })

  it('reads modelName when set on built-in mode', async () => {
    const { updateMode } = await import('../customModesStore')
    await updateMode(BUILTIN_SCAM_WATCHDOG_ID, { modelName: 'vision-model-x' })
    const { resolveWatchdogEffectiveModelId } = await import('../../../watchdog/watchdogService')
    await expect(resolveWatchdogEffectiveModelId(undefined)).resolves.toBe('vision-model-x')
  })

  it('config modelId takes precedence over built-in mode modelName', async () => {
    const { updateMode } = await import('../customModesStore')
    await updateMode(BUILTIN_SCAM_WATCHDOG_ID, { modelName: 'mode-model' })
    const { resolveWatchdogEffectiveModelId } = await import('../../../watchdog/watchdogService')
    await expect(resolveWatchdogEffectiveModelId('config-model')).resolves.toBe('config-model')
  })

  it('empty built-in modelName does not force mode-model override', async () => {
    const { updateMode } = await import('../customModesStore')
    await updateMode(BUILTIN_SCAM_WATCHDOG_ID, { modelName: '' })
    const { resolveWatchdogEffectiveModelId } = await import('../../../watchdog/watchdogService')
    const resolved = await resolveWatchdogEffectiveModelId(undefined)
    expect(resolved).not.toBe('mode-model')
    expect(resolved.trim().length).toBeGreaterThan(0)
  })
})
