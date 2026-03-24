/**
 * Verbose IMAP / sync logging ([IMAP-DEBUG], [SYNC-DEBUG], diagnoseImap stream).
 * Enable with `EMAIL_DEBUG=1` or a Vite dev build (`import.meta.env.DEV`).
 */

const viteEnv = typeof import.meta !== 'undefined' ? (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env : undefined

export const EMAIL_DEBUG = process.env.EMAIL_DEBUG === '1' || Boolean(viteEnv?.DEV)

/** Dev-only raw IMAP IPC (`email:diagnoseImap`) — production builds must not register the handler. */
export const DIAGNOSE_IMAP_IPC_DEV = Boolean(viteEnv?.DEV)

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
