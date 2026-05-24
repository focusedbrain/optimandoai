/**
 * Build UI-facing edge fetch snapshots from persisted account rows.
 */

import { emailGateway } from '../gateway.js'
import type { EdgeFetchAccountSnapshot } from './types.js'
import { mergeEdgeFetchState } from './edgeFetchRules.js'

export { mergeEdgeFetchState }

export function buildEdgeFetchSnapshots(): EdgeFetchAccountSnapshot[] {
  const rows = emailGateway.listAccountsSync()
  return rows.map((row) => {
    const local = row.edgeFetch?.state ?? 'not_on_edge'
    const remote = row.edgeFetch?.remoteState
    return {
      accountId: row.id,
      email: row.email,
      provider: row.provider,
      state: mergeEdgeFetchState(local, remote),
      remoteState: remote,
      lastError: row.edgeFetch?.lastError,
      replicaId: row.edgeFetch?.replicaId,
    }
  })
}
