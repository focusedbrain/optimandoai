/**
 * After the relay WebSocket connects, publish local ACTIVE internal handshake health and compare
 * with the peer's last report on the coordination relay ([HANDSHAKE_HEALTH_REMOTE]).
 */

import { p2pEndpointKind } from '../internalInference/policy'
import { getInstanceId } from '../orchestrator/orchestratorModeStore'
import { classifyActiveHandshakeHealth } from './activeHandshakeHealth'
import { listHandshakeRecords } from './db'
import { HandshakeState } from './types'

let lastRemoteCheckAt = 0
const REMOTE_CHECK_MIN_MS = 90_000

function healthKey(ok: boolean, tier: string, reason: string | null): string {
  if (ok || tier === 'OK') return 'OK'
  return `${tier}:${reason ?? ''}`
}

function classifyRemoteDivergence(
  localOk: boolean,
  localTier: string,
  localReason: string | null,
  localEp: string,
  peer: { health_tier: string; reason: string | null; endpoint_kind: string | null } | null,
): { agreement: boolean; divergence: string | null } {
  if (!peer) {
    return { agreement: false, divergence: 'peer_does_not_have_handshake' }
  }
  const lk = healthKey(localOk, localTier, localReason)
  const pk = healthKey(peer.health_tier === 'OK', peer.health_tier, peer.reason)
  if (lk === pk) {
    return { agreement: true, divergence: null }
  }
  if (peer.reason === 'missing_counterparty_token') {
    return { agreement: false, divergence: 'peer_reports_local_token_missing' }
  }
  const peerEp = (peer.endpoint_kind ?? '').trim()
  if (localEp === 'relay' && peerEp === 'direct') {
    return { agreement: false, divergence: 'local_endpoint_kind_relay_peer_endpoint_kind_direct' }
  }
  return { agreement: false, divergence: 'health_mismatch' }
}

export async function runHandshakeHealthRemoteCheckAfterRelayConnect(
  db: unknown,
  coordinationHttpBase: string,
  oidcToken: string,
): Promise<void> {
  try {
    if (db == null || typeof (db as { prepare?: unknown }).prepare !== 'function') {
      return
    }
    const now = Date.now()
    if (now - lastRemoteCheckAt < REMOTE_CHECK_MIN_MS) {
      return
    }
    lastRemoteCheckAt = now

    const base = coordinationHttpBase.replace(/\/$/, '')
    const token = oidcToken.trim()
    if (!base || !token) {
      return
    }

    const d = db as Parameters<typeof listHandshakeRecords>[0]
    const rows = listHandshakeRecords(d, { state: HandshakeState.ACTIVE })
    const localId = getInstanceId().trim()
    if (!localId) {
      return
    }

    for (const r of rows) {
      if (r.handshake_type !== 'internal') continue
      const uidI = r.initiator?.wrdesk_user_id
      const uidA = r.acceptor?.wrdesk_user_id
      if (typeof uidI !== 'string' || typeof uidA !== 'string' || uidI !== uidA) {
        continue
      }

      const localClass = classifyActiveHandshakeHealth(d, r, localId)
      const localOk = localClass.ok
      const localTier = localOk ? 'OK' : localClass.health
      const localReason = localOk ? null : localClass.reason
      const localEp = p2pEndpointKind(d, r.p2p_endpoint)

      const postRes = await fetch(`${base}/beap/handshake-health-report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          handshake_id: r.handshake_id,
          device_id: localId,
          health_tier: localTier,
          reason: localReason,
          endpoint_kind: localEp,
        }),
      })
      if (!postRes.ok) {
        console.warn(
          '[HANDSHAKE_HEALTH_REMOTE] post_skipped',
          JSON.stringify({
            handshake_id: r.handshake_id,
            status: postRes.status,
            detail: (await postRes.text()).slice(0, 200),
          }),
        )
        continue
      }

      const q = new URLSearchParams({ handshake_id: r.handshake_id, device_id: localId })
      const getRes = await fetch(`${base}/beap/handshake-health-peer?${q.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!getRes.ok) {
        console.warn(
          '[HANDSHAKE_HEALTH_REMOTE] get_skipped',
          JSON.stringify({ handshake_id: r.handshake_id, status: getRes.status }),
        )
        continue
      }
      let peerPayload: {
        peer: { health_tier: string; reason: string | null; endpoint_kind: string | null } | null
      }
      try {
        peerPayload = (await getRes.json()) as typeof peerPayload
      } catch {
        continue
      }
      const peer = peerPayload?.peer ?? null
      const { agreement, divergence } = classifyRemoteDivergence(
        localOk,
        localTier,
        localReason,
        localEp,
        peer,
      )
      if (agreement) {
        continue
      }

      const peerHealthDisplay = peer ? peer.health_tier : 'UNKNOWN'
      console.log(
        `[HANDSHAKE_HEALTH_REMOTE] handshake=${r.handshake_id} local_health=${localTier} peer_health=${peerHealthDisplay} agreement=false divergence=${divergence}`,
      )
    }
  } catch (e) {
    console.warn('[HANDSHAKE_HEALTH_REMOTE] failed', (e as Error)?.message ?? e)
  }
}
