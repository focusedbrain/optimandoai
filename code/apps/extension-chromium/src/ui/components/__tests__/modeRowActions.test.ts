/**
 * Mode row edit/delete affordances — built-in edit allowed, delete blocked.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openModeEditWizard, confirmDeleteMode } from '../modeRowActions'
import { WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT } from '../wrMultiTrigger/WrMultiTriggerBar'
import { isModeDeletable, normalizeCustomModeFields } from '../../../shared/ui/customModeTypes'
import { BUILTIN_SCAM_WATCHDOG_ID, createDefaultScamWatchdogBuiltInMode } from '../../../shared/ui/scamWatchdogBuiltIn'

describe('modeRowActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('openModeEditWizard dispatches edit event with mode id', () => {
    const handler = vi.fn()
    window.addEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, handler)
    openModeEditWizard(BUILTIN_SCAM_WATCHDOG_ID)
    expect(handler).toHaveBeenCalledTimes(1)
    const ev = handler.mock.calls[0][0] as CustomEvent<{ editModeId?: string }>
    expect(ev.detail?.editModeId).toBe(BUILTIN_SCAM_WATCHDOG_ID)
    window.removeEventListener(WRCHAT_OPEN_CUSTOM_MODE_WIZARD_EVENT, handler)
  })

  it('built-in Scam Watchdog is editable target but not deletable', () => {
    const builtIn = createDefaultScamWatchdogBuiltInMode()
    expect(isModeDeletable(builtIn)).toBe(false)
    const remove = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(confirmDeleteMode(builtIn, remove)).toBe(false)
    expect(remove).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('confirmDeleteMode deletes custom mode after confirm', () => {
    const custom = normalizeCustomModeFields({
      id: 'custom:test-delete',
      type: 'custom',
      name: 'Dashboard Refinement',
    })
    expect(isModeDeletable(custom)).toBe(true)
    const remove = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(confirmDeleteMode(custom, remove)).toBe(true)
    expect(remove).toHaveBeenCalledWith('custom:test-delete')
    confirmSpy.mockRestore()
  })
})
