/**
 * Shared IMAP sync timeouts + last-known phase for outer sync timeout diagnostics.
 * Inner races must stay below `SYNC_ACCOUNT_EMAILS_MAX_MS` in syncOrchestrator (folder expand + N × list + fetches).
 */

/** LIST/STATUS-driven folder expansion before pull (ephemeral IMAP session). */
export const IMAP_SYNC_FOLDER_EXPAND_MS = 45_000

/**
 * Orchestrator `Promise.race` around `emailGateway.listMessages` per folder.
 * Bumped from 30s: slow servers often exceed 30s on SEARCH + UID FETCH chunks without being dead.
 */
export const IMAP_SYNC_LIST_MESSAGES_MS = 45_000

/**
 * `ImapProvider.fetchMessages` (openBox + seq fetch headers) — must not exceed list race budget unnecessarily.
 */
export const IMAP_PROVIDER_FETCH_MESSAGES_MS = 45_000

/** Standalone reliable fetch path (fresh connection). */
export const IMAP_FETCH_RELIABLE_MS = 45_000

export type ImapSyncProgressSnapshot = {
  accountId: string
  provider: string
  phase: string
  folder?: string
  detail?: string
  updatedAt: number
}

let progress: ImapSyncProgressSnapshot | null = null

export function setImapSyncProgress(patch: Partial<ImapSyncProgressSnapshot> & Pick<ImapSyncProgressSnapshot, 'phase'>): void {
  const base = progress ?? {
    accountId: patch.accountId ?? '',
    provider: patch.provider ?? 'unknown',
    phase: patch.phase,
    updatedAt: Date.now(),
  }
  progress = {
    accountId: patch.accountId ?? base.accountId,
    provider: patch.provider ?? base.provider,
    phase: patch.phase,
    folder: patch.folder !== undefined ? patch.folder : base.folder,
    detail: patch.detail !== undefined ? patch.detail : base.detail,
    updatedAt: Date.now(),
  }
}

export function clearImapSyncProgress(): void {
  progress = null
}

export function getImapSyncProgressSnapshot(): ImapSyncProgressSnapshot | null {
  return progress
}

/** Stable JSON line for main-process logs (grep `[IMAP-SYNC-PHASE]`). */
export function formatImapSyncPhaseLine(event: string, fields: Record<string, unknown>): string {
  return `[IMAP-SYNC-PHASE] ${event} ${JSON.stringify(fields)}`
}
