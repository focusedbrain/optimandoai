export type EdgeFetchUiState =
  | 'not_on_edge'
  | 'migrating'
  | 'migrating_back'
  | 'awaiting_key'
  | 'active'
  | 'degraded'

export interface EdgeFetchAccountSnapshot {
  accountId: string
  email: string
  provider: string
  state: EdgeFetchUiState
  remoteState?: string
  lastError?: string
  replicaId?: string
}

export interface EdgeFetchStateLabel {
  fetchedBy: string
  detail?: string
  progress?: string
}

export function edgeFetchStateLabel(state: EdgeFetchUiState): EdgeFetchStateLabel {
  switch (state) {
    case 'not_on_edge':
      return { fetchedBy: 'This computer' }
    case 'migrating':
      return {
        fetchedBy: 'Edge (setting up…)',
        progress: 'Migrating to edge…',
      }
    case 'migrating_back':
      return {
        fetchedBy: 'This computer (restoring…)',
        progress: 'Moving back to this computer…',
      }
    case 'awaiting_key':
      return {
        fetchedBy: 'Edge (connecting…)',
        progress: 'Reconnecting…',
      }
    case 'active':
      return { fetchedBy: 'Edge VM' }
    case 'degraded':
      return {
        fetchedBy: 'Edge (needs attention)',
        detail: 'Edge fetch paused — re-authorize to resume.',
      }
    default:
      return { fetchedBy: 'This computer' }
  }
}

export const EDGE_FETCH_CONSENT_ITEMS = [
  'I understand my email provider credentials will be encrypted and stored on the edge VM',
  'I understand my email will arrive via the edge and may briefly pause during edge restarts',
  "I understand my provider may show a 'new sign-in' notification for the edge VM's location",
] as const

export const EDGE_FETCH_MOVE_BACK_WARNING =
  'Moving back disables the high-assurance property for this account. New email will be fetched by this computer and parsed locally before validation.'
