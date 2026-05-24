/**
 * Per-account edge email fetch state (strategy §11.8).
 *
 * Desktop-local states `migrating` / `migrating_back` cover SSH + OAuth work in flight.
 * Mail-fetcher states (`awaiting_key`, `active`, `degraded`, `stopped`) come from the
 * remote supervisor and are merged into the UI-facing snapshot.
 */

export type EdgeFetchLocalState =
  | 'not_on_edge'
  | 'migrating'
  | 'migrating_back'
  | 'awaiting_key'
  | 'active'
  | 'degraded'

export type MailFetcherRemoteState = 'awaiting_key' | 'active' | 'degraded' | 'stopped'

export interface EdgeFetchAccountMeta {
  /** REMOTE_EDGE replica that owns this account fetch loop. */
  replicaId: string
  /** Desktop-local state machine position. */
  state: EdgeFetchLocalState
  /** Last merged remote supervisor state, when known. */
  remoteState?: MailFetcherRemoteState
  lastError?: string
  /** ISO timestamp of last successful remote status poll. */
  lastRemoteSyncAt?: string
  updatedAt: number
}

export interface EdgeFetchAccountSnapshot {
  accountId: string
  email: string
  provider: string
  /** UI-facing merged state. */
  state: EdgeFetchLocalState
  remoteState?: MailFetcherRemoteState
  lastError?: string
  replicaId?: string
  lastFetchAt?: string
}

export interface EdgeFetchEligibility {
  canMigrate: boolean
  reason?: string
  /** Paid tier + edge enabled + ≥1 replica. */
  edgeReady: boolean
  isPaidTier: boolean
  replicas: Array<{ edge_pod_id: string; host: string; port: number }>
}

export interface EdgeFetchSshCredentials {
  readonly sshUser: string
  readonly sshPort: number
  readonly sshKey: string
  readonly passphrase?: string
}

export interface EdgeFetchMigrationInput extends EdgeFetchSshCredentials {
  readonly accountId: string
  readonly replicaId: string
}

export interface MailFetcherAccountStatusWire {
  account_id: string
  provider: string
  state: MailFetcherRemoteState
  last_fetch_at?: string
  last_error?: string
}
