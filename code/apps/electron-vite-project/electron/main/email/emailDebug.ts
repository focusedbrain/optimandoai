/**
 * Verbose IMAP / sync logging ([IMAP-DEBUG], [SYNC-DEBUG], diagnoseImap stream).
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

/** Forced on for IMAP pull diagnostics — revert to `process.env.EMAIL_DEBUG === '1' || isDev` after debugging. */
export const EMAIL_DEBUG = true

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
