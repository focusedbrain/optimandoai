/**
 * Extension Stage-5 merge retry buffer — Phase B, PR B-5.1.
 *
 * When `mergeExtensionDepackaged` fails validation AND no sandbox is paired,
 * the original merge inputs are held here (in main-process memory only) until:
 *   - A sandbox becomes available and `drainExtensionMergeBuffer` is called, or
 *   - The retry count reaches MAX_EXTENSION_MERGE_RETRY (drop + loud log), or
 *   - The application is restarted (buffer clears; the extension can resend Stage-5
 *     results on reconnect as a recovery path).
 *
 * Architecture note: this module is a pure data store. It carries no DB access and
 * no merge logic. The drain function lives in `mergeExtensionDepackaged.ts` to avoid
 * circular dependencies.
 *
 * per Phase B Architecture, PR B-5.1, Decision C.
 */

export interface PendingExtensionMerge {
  /** Shell inbox_messages.id (row created by earlier ingestion path). */
  readonly rowId: string
  /** Original BEAP package JSON (for quarantine blob encryption). */
  readonly packageJson: string
  /** Extension's depackaged content JSON string. */
  readonly depackagedJson: string
  /** Wrapper metadata string (format, source, verifiedAt). */
  readonly depackagedMetadata: string | null
  /** Body text (truncated to 120k as in the merge function). */
  readonly bodyText: string | null
  /** Attachment inputs as received from the extension. */
  readonly attachments: ReadonlyArray<{
    content_id: string
    filename: string
    content_type: string
    size_bytes: number
    base64?: string | null
  }>
  /** Rejection reason code from the validator. */
  readonly rejectionReason: string
  /** Number of times a re-attempt has been triggered (starts at 0). */
  retryCount: number
  /** RFC 3339 UTC timestamp of the first failed attempt. */
  readonly firstAttemptAt: string
}

/**
 * Maximum number of re-attempts before dropping a buffered merge entry.
 * Matches B-3.1's `MAX_QUARANTINE_RETRY` constant.
 */
export const MAX_EXTENSION_MERGE_RETRY = 3

// In-memory buffer. Keyed by rowId (inbox_messages.id).
const _buffer = new Map<string, PendingExtensionMerge>()

/** Add (or replace) a pending merge entry. */
export function addPendingMerge(entry: PendingExtensionMerge): void {
  _buffer.set(entry.rowId, entry)
}

/** Remove a pending merge entry (after successful processing or retry limit). */
export function removePendingMerge(rowId: string): void {
  _buffer.delete(rowId)
}

/** Return all pending entries (safe snapshot). */
export function getAllPendingMerges(): PendingExtensionMerge[] {
  return [..._buffer.values()]
}

/** Number of pending entries. */
export function getPendingMergeCount(): number {
  return _buffer.size
}

/** Clear the entire buffer (test helper; also clears on app restart). */
export function clearPendingMergeBuffer(): void {
  _buffer.clear()
}
