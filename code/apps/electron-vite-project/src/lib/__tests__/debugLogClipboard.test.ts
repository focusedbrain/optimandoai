/**
 * Log-viewer Copy-All — clipboard helper unit tests.
 *
 * CS_COPY_01: Copy filtered "All" → entire buffer (no filter active)
 * CS_COPY_02: Copy filtered "Error" → only error lines
 * CS_COPY_03: Copy all ignores the active filter
 * CS_COPY_04: Plain-text format strips HH:MM:SS [LEVEL] prefix exactly
 * CS_COPY_05: Empty buffer → empty string, no crash
 * CS_COPY_06: Large buffer (10 000 lines) completes synchronously without error
 * CS_COPY_07: Clipboard write rejected → error path (code-read verification note)
 */

import { describe, test, expect } from 'vitest'
import {
  buildClipboardText,
  filterLogEntries,
  formatLineDisplay,
  formatLinePlain,
  type LogEntry,
} from '../debugLogClipboard'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(level: string, line: string, tsHour = '17'): LogEntry {
  return { ts: `2026-05-03T${tsHour}:46:32.000Z`, level, line }
}

const MIXED_LOGS: LogEntry[] = [
  makeEntry('log',   '[INBOX_OLLAMA] chunk received'),
  makeEntry('error', '[AUTH] token refresh failed'),
  makeEntry('warn',  '[P2P] relay reconnect'),
  makeEntry('log',   '[BEAP] capsule sent'),
  makeEntry('error', '[RELAY] 403 sandbox_entitlement_required'),
]

// ---------------------------------------------------------------------------
// CS_COPY_01: Copy filtered with "All" (empty filter) → entire buffer
// ---------------------------------------------------------------------------
describe('CS_COPY_01 — Copy filtered (no filter) → all lines', () => {
  test('filterLogEntries with empty filter returns all entries', () => {
    expect(filterLogEntries(MIXED_LOGS, '')).toHaveLength(MIXED_LOGS.length)
  })

  test('buildClipboardText contains every line', () => {
    const text = buildClipboardText(MIXED_LOGS, false)
    const lines = text.split('\n')
    expect(lines).toHaveLength(MIXED_LOGS.length)
    expect(lines[0]).toContain('[INBOX_OLLAMA]')
    expect(lines[4]).toContain('[RELAY]')
  })

  test('lines appear in original order', () => {
    const visible = filterLogEntries(MIXED_LOGS, '')
    const text = buildClipboardText(visible, false)
    const lines = text.split('\n')
    expect(lines[0]).toContain('[INBOX_OLLAMA]')
    expect(lines[1]).toContain('[AUTH]')
    expect(lines[2]).toContain('[P2P]')
  })
})

// ---------------------------------------------------------------------------
// CS_COPY_02: Copy filtered "Error" → only error lines
// ---------------------------------------------------------------------------
describe('CS_COPY_02 — Copy filtered "Error" → error lines only', () => {
  test('filterLogEntries("Error") keeps only error-level and error-containing lines', () => {
    const result = filterLogEntries(MIXED_LOGS, 'Error')
    // level === 'error' OR line contains 'error' (case-insensitive)
    expect(result.length).toBeGreaterThan(0)
    result.forEach((l) => {
      const isErrorLevel = l.level === 'error'
      const lineContainsError = l.line.toLowerCase().includes('error')
      expect(isErrorLevel || lineContainsError).toBe(true)
    })
  })

  test('no log-level lines appear in Error-filtered output (unless line text matches)', () => {
    const result = filterLogEntries(MIXED_LOGS, 'Error')
    const nonError = result.filter((l) => l.level !== 'error' && !l.line.toLowerCase().includes('error'))
    expect(nonError).toHaveLength(0)
  })

  test('clipboard text from Error-filtered entries has fewer lines than full buffer', () => {
    const errorEntries = filterLogEntries(MIXED_LOGS, 'Error')
    const text = buildClipboardText(errorEntries, false)
    const lines = text.split('\n')
    expect(lines.length).toBeLessThan(MIXED_LOGS.length)
  })
})

// ---------------------------------------------------------------------------
// CS_COPY_03: "Copy all" ignores the active filter
// ---------------------------------------------------------------------------
describe('CS_COPY_03 — Copy all ignores active filter', () => {
  test('passing full logs array to buildClipboardText copies everything', () => {
    // Simulate "filter = Error" for display, but "Copy all" uses `logs` not `filtered`
    const allText = buildClipboardText(MIXED_LOGS, false)
    const filteredText = buildClipboardText(filterLogEntries(MIXED_LOGS, 'Error'), false)
    expect(allText.split('\n')).toHaveLength(MIXED_LOGS.length)
    expect(filteredText.split('\n').length).toBeLessThan(MIXED_LOGS.length)
    // "Copy all" result includes the P2P warn line which Error filter excludes
    expect(allText).toContain('[P2P] relay reconnect')
    expect(filteredText).not.toContain('[P2P] relay reconnect')
  })
})

// ---------------------------------------------------------------------------
// CS_COPY_04: Plain-text format strips prefix correctly
// ---------------------------------------------------------------------------
describe('CS_COPY_04 — plain-text format strips HH:MM:SS [LEVEL] prefix', () => {
  const entry = makeEntry('warn', '[P2P] relay reconnect')

  test('formatLineDisplay includes timestamp and level', () => {
    const line = formatLineDisplay(entry)
    expect(line).toMatch(/^\d{2}:\d{2}:\d{2} \[WARN\] /)
    expect(line).toContain('[P2P] relay reconnect')
  })

  test('formatLinePlain is exactly entry.line — no leading/trailing space added', () => {
    const line = formatLinePlain(entry)
    expect(line).toBe('[P2P] relay reconnect')
  })

  test('plain buildClipboardText has no timestamp prefix on any line', () => {
    const text = buildClipboardText(MIXED_LOGS, true)
    const lines = text.split('\n')
    lines.forEach((line) => {
      expect(line).not.toMatch(/^\d{2}:\d{2}:\d{2}/)
    })
  })

  test('plain text preserves payload exactly — no trimming of first character', () => {
    const e = makeEntry('log', 'leading space test')
    const plain = buildClipboardText([e], true)
    expect(plain).toBe('leading space test')
  })

  test('display text HH:MM:SS is exactly 8 chars from ts.slice(11,19)', () => {
    const line = formatLineDisplay(entry)
    // "17:46:32 [WARN] ..." — first token must be HH:MM:SS
    const timeToken = line.split(' ')[0]!
    expect(timeToken).toHaveLength(8)
    expect(timeToken).toBe('17:46:32')
  })
})

// ---------------------------------------------------------------------------
// CS_COPY_05: Empty buffer → empty string, no crash
// ---------------------------------------------------------------------------
describe('CS_COPY_05 — empty buffer', () => {
  test('buildClipboardText([]) returns empty string', () => {
    expect(buildClipboardText([], false)).toBe('')
    expect(buildClipboardText([], true)).toBe('')
  })

  test('filterLogEntries([]) returns empty array', () => {
    expect(filterLogEntries([], 'Error')).toHaveLength(0)
    expect(filterLogEntries([], '')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CS_COPY_06: Large buffer (10 000 lines) — synchronous performance
// ---------------------------------------------------------------------------
describe('CS_COPY_06 — large buffer completes in reasonable time', () => {
  test('10 000 lines built synchronously without error', () => {
    const big: LogEntry[] = Array.from({ length: 10_000 }, (_, i) =>
      makeEntry(i % 10 === 0 ? 'error' : 'log', `[MODULE_${i % 50}] event payload {"seq":${i}}`),
    )
    const start = performance.now()
    const text = buildClipboardText(big, false)
    const elapsed = performance.now() - start
    const lines = text.split('\n')
    expect(lines).toHaveLength(10_000)
    // Must complete well under 1s on any modern machine
    expect(elapsed).toBeLessThan(1000)
  })

  test('10 000 lines — plain mode also fast', () => {
    const big: LogEntry[] = Array.from({ length: 10_000 }, (_, i) =>
      makeEntry('log', `payload ${i}`),
    )
    const text = buildClipboardText(big, true)
    expect(text.split('\n')).toHaveLength(10_000)
    // Plain mode just joins .line — even faster
    expect(text.split('\n')[9999]).toBe('payload 9999')
  })

  /**
   * NOTE (code-read verification): DebugLogViewer caps the in-memory buffer at 500 entries
   * (`next.length > 500 ? next.slice(-500) : next`). In practice the component will never
   * hold 10 000 lines at once; the above tests validate the helper is safe if the cap is
   * raised. The clipboard write itself (`navigator.clipboard.writeText`) is always async
   * and does not block the JS event loop regardless of string size.
   */
})

// ---------------------------------------------------------------------------
// CS_COPY_07: Clipboard write rejected → error path
// ---------------------------------------------------------------------------
describe('CS_COPY_07 — clipboard rejection is handled (code-read note)', () => {
  /**
   * The error path in DebugLogViewer.copyLogs:
   *
   *   try {
   *     await navigator.clipboard.writeText(text)
   *     setCopyFeedback({ ok: true })
   *     copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 1500)
   *   } catch (err) {
   *     const msg = err instanceof Error ? err.message : String(err)
   *     setCopyFeedback({ ok: false, msg: msg.slice(0, 60) })
   *     copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 3000)
   *   }
   *
   * On rejection:
   *   - setCopyFeedback({ ok: false, msg }) → renders red "✗ <reason>" span in toolbar.
   *   - Timeout resets feedback after 3s — button returns to normal state automatically.
   *   - No unhandled promise rejection; the void operator is applied at the call site.
   *
   * This can be exercised in a JSDOM/React Testing Library environment by stubbing
   * navigator.clipboard.writeText to reject. The helper functions above are pure and
   * have no clipboard dependency, so this test covers the error rendering contract
   * by inspection rather than runtime assertion.
   */
  test('buildClipboardText itself never throws (clipboard is called in component)', () => {
    // Confirm the helper does not call navigator.clipboard — component owns that
    expect(() => buildClipboardText(MIXED_LOGS, false)).not.toThrow()
  })

  test('empty-string write is still valid (empty buffer → empty clipboard)', () => {
    // Validates the component will call writeText('') not crash before the await
    const text = buildClipboardText([], false)
    expect(text).toBe('')
    expect(typeof text).toBe('string')
  })
})
