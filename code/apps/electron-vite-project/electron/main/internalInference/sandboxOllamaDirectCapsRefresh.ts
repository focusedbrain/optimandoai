/**
 * Force a fresh Host capabilities DC exchange (sandbox) so `ollama_direct` candidate can update.
 */

import { getHandshakeRecord } from '../handshake/db'
import { assertRecordForServiceRpc, outboundP2pBearerToCounterpartyIngest } from './policy'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { listHostCapabilities } from './transport/internalInferenceTransport'
import { invalidateSbxAiCapsTerminalCache } from './p2pDc/p2pDcCapabilities'
import { invalidateSandboxOllamaDirectTagsCacheForHandshake } from './sandboxHostAiOllamaDirectTags'

const CAP_REFRESH_TIMEOUT_MS = 15_000

/**
 * Invalidates sandbox caps terminal cache and re-runs `listHostCapabilities` (which reapplies
 * `evaluateSandboxHostAiOllamaDirectFromCapabilitiesWire` on success).
 */
export async function refreshSandboxOllamaDirectFromHostCapabilities(p: {
  handshakeId: string
}): Promise<{ ok: boolean }> {
  const hid = String(p.handshakeId ?? '').trim()
  if (!hid) return { ok: false }
  invalidateSbxAiCapsTerminalCache(hid)
  const db = await getHandshakeDbForInternalInference()
  if (!db) return { ok: false }
  const recRow = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(recRow)
  if (!ar.ok) return { ok: false }
  const tok = outboundP2pBearerToCounterpartyIngest(ar.record)
  if (!tok?.trim()) return { ok: false }
  const cap = await listHostCapabilities(hid, {
    record: ar.record,
    token: tok.trim(),
    timeoutMs: CAP_REFRESH_TIMEOUT_MS,
  })
  if (!cap.ok) return { ok: false }
  invalidateSandboxOllamaDirectTagsCacheForHandshake(hid)
  return { ok: true }
}
