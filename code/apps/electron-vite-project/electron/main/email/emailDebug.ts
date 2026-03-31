/**
 * Verbose IMAP / sync logging ([IMAP-DEBUG], [SYNC-DEBUG], diagnoseImap stream).
 * Production IMAP pull timelines: grep main-process logs for `[IMAP-SYNC-PHASE]` (see `imapSyncTelemetry.ts`).
 * Enable with `EMAIL_DEBUG=1` or a Vite dev build (`import.meta.env.DEV`).
 *
 * Main-process bundle: avoid bare `import.meta` / `typeof import.meta` at top level — some
 * toolchains or runtimes can throw; a failed import here breaks the entire email IPC tree.
 */

let isDev = false
try {
  isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } })?.env?.DEV)
} catch {
  isDev = false
}

export const EMAIL_DEBUG = process.env.EMAIL_DEBUG === '1' || isDev

/** Verbose email account persistence / list / decrypt traces — quiet unless DEBUG_EMAIL_ACCOUNTS=1 or dev. */
export const EMAIL_ACCOUNTS_DEBUG =
  process.env.DEBUG_EMAIL_ACCOUNTS === '1' || EMAIL_DEBUG

/** Dev-only raw IMAP IPC (`email:diagnoseImap`) — production builds must not register the handler. */
export const DIAGNOSE_IMAP_IPC_DEV = isDev

export function emailDebugLog(...args: unknown[]): void {
  if (EMAIL_DEBUG) {
    // eslint-disable-next-line no-console -- gated diagnostic
    console.log(...args)
  }
}

export function emailDebugWarn(...args: unknown[]): void {
  if (EMAIL_DEBUG) {
    // eslint-disable-next-line no-console -- gated diagnostic
    console.warn(...args)
  }
}

export function emailAccountsDebugLog(...args: unknown[]): void {
  if (EMAIL_ACCOUNTS_DEBUG) {
    // eslint-disable-next-line no-console -- gated diagnostic
    console.log('[EmailAccountsDebug]', ...args)
  }
}
