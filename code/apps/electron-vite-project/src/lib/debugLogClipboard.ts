/**
 * Clipboard helpers for DebugLogViewer — extracted for testability.
 * Formatting mirrors the on-screen rendering exactly (same slices, same casing).
 */

export interface LogEntry {
  ts: string
  level: string
  line: string
}

/**
 * Display format: "HH:MM:SS [LEVEL] payload" — mirrors on-screen rendering.
 * ts.slice(11,19) gives "HH:MM:SS" from an ISO-8601 string.
 */
export function formatLineDisplay(entry: LogEntry): string {
  return `${entry.ts.slice(11, 19)} [${entry.level.toUpperCase()}] ${entry.line}`
}

/**
 * Plain format: payload only — strips the timestamp and level prefix.
 * Useful for large buffers pasted into chat (reduces character count).
 */
export function formatLinePlain(entry: LogEntry): string {
  return entry.line
}

/** Build a newline-joined string from a list of entries. */
export function buildClipboardText(entries: LogEntry[], plain: boolean): string {
  if (entries.length === 0) return ''
  const fmt = plain ? formatLinePlain : formatLineDisplay
  return entries.map(fmt).join('\n')
}

/**
 * Filter log entries — mirrors DebugLogViewer's inline filter predicate exactly.
 * Kept here so the component and tests share one implementation.
 */
export function filterLogEntries(logs: LogEntry[], filter: string): LogEntry[] {
  if (!filter) return logs
  return logs.filter((l) => {
    const q = filter.toLowerCase()
    if (filter === 'Error') {
      return l.level === 'error' || l.line.toLowerCase().includes('error')
    }
    return l.line.toLowerCase().includes(q) || l.level.toLowerCase().includes(q)
  })
}
