/**
 * Production logging rules for internal inference / P2P: metadata only, no bodies, no credentials.
 */

let _forceProdLogsForTests: boolean | null = null

/** @internal */
export function _setInternalInferenceLogPackagedForTests(v: boolean | null): void {
  _forceProdLogsForTests = v
}

export function isInternalInferenceProdPackagedLogging(): boolean {
  if (_forceProdLogsForTests != null) return _forceProdLogsForTests
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app: { isPackaged: boolean } }
    return app.isPackaged === true
  } catch {
    return true
  }
}

/** Truncate long UUIDs in logs in packaged builds. */
export function redactIdForLog(id: string): string {
  const s = String(id ?? '').trim()
  if (!s) return '(none)'
  if (!isInternalInferenceProdPackagedLogging()) return s
  if (s.length <= 12) return s
  return `${s.slice(0, 8)}…`
}
