/**
 * Deliver quarantine encryption key to mail-fetcher on REMOTE_EDGE (P5.5).
 */

import type { ReplicaActionSshRunner } from './replicaActions.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { ensureQuarantineKeyHex } from './quarantineKeyStorage.js'
import { mailFetcherRemoteRequest } from '../email/edgeFetch/mailFetcherRemote.js'

export async function deliverQuarantineKeyToReplica(
  ssh: ReplicaActionSshRunner,
  replicaId: string,
  vault: EdgeTierPodVault,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const quarantineKeyHex = ensureQuarantineKeyHex(replicaId, vault)
  const res = await mailFetcherRemoteRequest(ssh, 'POST', '/quarantine/deliver_key', {
    quarantine_key: quarantineKeyHex,
  })
  return {
    ok: res.status === 200,
    status: res.status,
    error: res.status !== 200 ? String(res.json.error ?? `HTTP ${res.status}`) : undefined,
  }
}
