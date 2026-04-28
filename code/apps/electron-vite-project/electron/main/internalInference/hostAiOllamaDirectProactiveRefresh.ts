/**
 * Host: periodic check for `ollama_direct` LAN advertisement changes; pushes unsolicited caps on DC when needed.
 */

import { randomUUID } from 'crypto'
import { getHandshakeRecord } from '../handshake/db'
import { getInstanceId, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { buildHostOllamaDirectAdvertisement } from './hostAiOllamaDirectAdvertisement'
import { extractPeerLanIpv4HintFromHttpUrl } from './hostAiOllamaDirectLanIp'
import { buildInternalInferenceCapabilitiesResult } from './hostInferenceCapabilities'
import { getHandshakeDbForInternalInference } from './dbAccess'
import {
  assertRecordForServiceRpc,
  coordinationDeviceIdForHandshakeDeviceRole,
  deriveInternalHostAiPeerRoles,
} from './policy'
import {
  invalidateHostCapsBuiltCacheForHandshake,
  sendProactiveInferenceCapabilitiesDcResult,
} from './p2pDc/p2pDcCapabilities'
import { getSessionState, listHandshakeIdsWithOpenP2pDataChannel } from './p2pSession/p2pInferenceSessionManager'

const lastOllamaDirectFingerprintByHandshake = new Map<string, string>()
let timerStarted = false

function proactiveIntervalMs(): number {
  const raw = (process.env.WRDESK_HOST_AI_OLLAMA_DIRECT_PROACTIVE_MS ?? '').trim()
  if (raw === '0') return 0
  if (!raw) return 30_000
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 30_000
  if (n === 0) return 0
  return Math.max(5_000, n)
}

export function startHostOllamaDirectProactiveRefreshTimer(): void {
  if (timerStarted) return
  timerStarted = true
  if (isSandboxMode()) return
  const ms = proactiveIntervalMs()
  if (ms <= 0) return
  setInterval(() => {
    void runHostOllamaDirectProactiveRefreshTick()
  }, ms)
}

async function runHostOllamaDirectProactiveRefreshTick(): Promise<void> {
  if (isSandboxMode()) return
  const hids = listHandshakeIdsWithOpenP2pDataChannel()
  if (hids.length === 0) return
  const db = await getHandshakeDbForInternalInference()
  if (!db) return
  const me = getInstanceId().trim()
  for (const hid of hids) {
    const row = getHandshakeRecord(db, hid)
    const ar = assertRecordForServiceRpc(row)
    if (!ar.ok) continue
    const r = ar.record
    const dr = deriveInternalHostAiPeerRoles(r, me)
    if (!dr.ok || dr.localRole !== 'host' || dr.peerRole !== 'sandbox') continue
    const peerSb = (coordinationDeviceIdForHandshakeDeviceRole(r, 'sandbox') ?? '').trim()
    if (!peerSb) continue
    const hint = extractPeerLanIpv4HintFromHttpUrl(r.p2p_endpoint)
    const adv = await buildHostOllamaDirectAdvertisement(hint, { peer_device_id: peerSb })
    const fp = `${adv.host_lan_ip ?? ''}|${adv.available}|${adv.base_url ?? ''}|${adv.models_count}`
    const prev = lastOllamaDirectFingerprintByHandshake.get(hid)
    if (prev === fp) continue
    lastOllamaDirectFingerprintByHandshake.set(hid, fp)
    invalidateHostCapsBuiltCacheForHandshake(hid)
    const { wire } = await buildInternalInferenceCapabilitiesResult(r, {
      request_id: randomUUID(),
      created_at: new Date().toISOString(),
    })
    const st = getSessionState(hid)
    const sid = st?.sessionId?.trim()
    if (!sid) continue
    console.log(
      `[HOST_AI_OLLAMA_DIRECT_PROACTIVE_REFRESH] ${JSON.stringify({
        handshake_id: hid,
        session_id: sid,
        selected_host_lan_ip: adv.host_lan_ip,
        ollama_direct_available: adv.available,
        ollama_direct_base_url: adv.base_url,
      })}`,
    )
    await sendProactiveInferenceCapabilitiesDcResult({ handshakeId: hid, p2pSessionId: sid, wire })
  }
}
