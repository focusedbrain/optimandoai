/**
 * Mail-fetcher account state machine (strategy §11.8).
 */

export type MailFetcherAccountState =
  | 'awaiting_key'
  | 'active'
  | 'degraded'
  | 'stopped';

export interface MailFetcherAccountStatus {
  readonly account_id: string;
  readonly provider: string;
  readonly state: MailFetcherAccountState;
  readonly last_fetch_at?: string;
  readonly last_error?: string;
}

export interface StartAccountBody {
  readonly account_id: string;
  readonly provider: string;
  readonly encrypted_bundle: string | import('@repo/email-fetch').EncryptedCredentialBundleWire;
  readonly wrapped_account_key: string;
}

export interface DeliverKeyBody {
  readonly account_id: string;
  /** 32-byte account key as hex — memory only after delivery. */
  readonly account_key: string;
  /** Optional per-replica quarantine encryption key (32-byte hex). */
  readonly quarantine_key?: string;
}

export interface DeliverQuarantineKeyBody {
  /** 32-byte quarantine key as hex — memory only after delivery. */
  readonly quarantine_key: string;
}

export interface StopAccountBody {
  readonly account_id: string;
}

export const MAIL_FETCHER_ACCOUNT_EVENT = 'mail_fetcher_account_event';

export interface MailFetcherStructuredLog {
  readonly type: typeof MAIL_FETCHER_ACCOUNT_EVENT;
  readonly account_id: string;
  readonly event: string;
  readonly category: 'auth' | 'network' | 'decrypt' | 'ingest' | 'internal';
}

/**
 * Allowed outbound egress (document for pod network policy — P4.5.6):
 *   - TCP 993  → IMAP (imap.gmail.com, outlook.office365.com, …)
 *   - TCP 443  → https://oauth2.googleapis.com/token
 *   - TCP 443  → https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   - TCP 443  → Microsoft Graph (future; not used in IMAP-first mode)
 *   - loopback → http://127.0.0.1:18100/ingest (ingestor, no TLS)
 */
export const MAIL_FETCHER_EGRESS_NOTE = 'imap:993 oauth/graph:443 loopback-ingest:18100';
