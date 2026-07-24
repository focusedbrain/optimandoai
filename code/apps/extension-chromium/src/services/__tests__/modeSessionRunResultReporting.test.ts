import { describe, expect, it, vi } from 'vitest'
import { reportModeSessionRunResult } from '../modeSessionRunResultReporting'

describe('reportModeSessionRunResult', () => {
  it('is silent for genuine busy skips', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportModeSessionRunResult('Test', 'custom:abc', 'speech_bubble', {
      ok: false,
      error: 'Session run already in progress',
      phase: 'mode_run',
      busy: true,
      skipped: true,
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns on timeout failures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    reportModeSessionRunResult('Test', 'custom:abc', 'interval', {
      ok: false,
      error: 'Mode run timed out',
      phase: 'mode_run',
      timedOut: true,
    })
    expect(warn).toHaveBeenCalledWith(
      '[Test] Mode session run timed out (interval):',
      'custom:abc',
      'Mode run timed out',
    )
    warn.mockRestore()
  })
})
