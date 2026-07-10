/**
 * Cross-process BEAP delivery confirmation: recipient POSTs to sender `/beap/delivery-ack`
 * after inbox persistence (works when coordination `beap_ingest_ack` WS forward is unavailable).
 */

import { getHandshakeRecord } from '../handshake/db'
import {
  normalizeP2pIngestUrl,
  peekHostAdvertisedMvpDirectEntry,
} from '../internalInference/p2pEndpointRepair'

const DELIVERY_ACK_TIMEOUT_MS = 4000

function isDirectBeapIngestEndpoint(endpoint: string): boolean {
  return endpoint.trim().toLowerCase().includes('/beap/ingest')
}

function deliveryAckUrlFromIngestUrl(ingestUrl: string): string | null {
  const t = ingestUrl.trim()
  if (!isDirectBeapIngestEndpoint(t)) return null
  const base = normalizeP2pIngestUrl(t)
  return base.replace(/\/beap\/ingest\/?$/i, '/beap/delivery-ack')
}

/** Counterparty LAN ingest → `/beap/delivery-ack` on the sender device. */
export function resolveSenderDeliveryAckEndpoint(db: any, handshakeId: string): string | null {
  const hid = String(handshakeId ?? '').trim()
  if (!hid || !db) return null
  const seen = new Set<string>()
  const tryOne = (raw: string | null | undefined): string | null => {
    const u = deliveryAckUrlFromIngestUrl(typeof raw === 'string' ? raw : '')
    if (!u || seen.has(u)) return null
    seen.add(u)
    return u
  }
  const adv = peekHostAdvertisedMvpDirectEntry(hid)?.url
  const fromAdv = tryOne(adv)
  if (fromAdv) return fromAdv
  const rec = getHandshakeRecord(db, hid)
  return tryOne(rec?.p2p_endpoint)
}

/**
 * Typed `boolean` (not literal `true`) so the retired direct-dial body stays
 * type-checked but never runs.
 */
const RETIRE_DIRECT_PEER_DELIVERY_ACK: boolean = true

/**
 * Fire-and-forget: notify sender over direct HTTP (Bearer = counterparty_p2p_token on recipient ledger).
 *
 * RETIRED LANE: every caller of this function already calls
 * `publishBeapIngestAckOverCoordinationRelay` (the `beap_ingest_ack` message
 * over the coordination WebSocket) unconditionally immediately beforehand —
 * that is the live, relay-mediated delivery-ack path. This direct-HTTP
 * fallback dials the same retired direct-LAN advertisement
 * (`peekHostAdvertisedMvpDirectEntry` / `p2p_endpoint`) as
 * `sandboxEmailDelivery.ts`'s transport, which is permanently unpublished
 * (Schema v71) and so already resolves to no endpoint in practice. Fail
 * closed at entry so a stale/legacy ledger `p2p_endpoint` can never cause a
 * direct dial between peers; the relay ack above is sufficient on its own.
 */
export function postPeerDeliveryAckToSender(
  db: any,
  handshakeId: string,
  rowId: string,
  extras?: { status?: 'ok' | 'error'; reasonCode?: string; retryable?: boolean },
): void {
  const hid = String(handshakeId ?? '').trim()
  const rid = String(rowId ?? '').trim()
  if (!hid || !rid || !db) return
  if (RETIRE_DIRECT_PEER_DELIVERY_ACK) {
    console.log(`[BEAP_DELIVERY] peer_ack_skip handshake=${hid} reason=direct_peer_ack_retired`)
    return
  }
  const url = resolveSenderDeliveryAckEndpoint(db, hid)
  if (!url) {
    console.log(`[BEAP_DELIVERY] peer_ack_skip handshake=${hid} reason=no_sender_direct_endpoint`)
    return
  }
  const record = getHandshakeRecord(db, hid)
  const token = record?.counterparty_p2p_token?.trim()
  if (!token) {
    console.log(`[BEAP_DELIVERY] peer_ack_skip handshake=${hid} reason=no_counterparty_token`)
    return
  }
  void (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DELIVERY_ACK_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-BEAP-Handshake': hid,
        },
        body: JSON.stringify({
          handshake_id: hid,
          row_id: rid,
          status: extras?.status ?? 'ok',
          ...(extras?.reasonCode ? { reason_code: extras.reasonCode } : {}),
          ...(extras?.retryable === true ? { retryable: true } : {}),
        }),
        signal: controller.signal,
      })
      if (res.ok) {
        console.log(`[BEAP_DELIVERY] peer_ack_http_ok handshake=${hid} rowId=${rid} url=${url}`)
      } else {
        const text = await res.text().catch(() => '')
        console.warn(
          `[BEAP_DELIVERY] peer_ack_http_fail handshake=${hid} status=${res.status} body=${text.slice(0, 200)}`,
        )
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[BEAP_DELIVERY] peer_ack_http_error handshake=${hid} error=${msg}`)
    } finally {
      clearTimeout(timer)
    }
  })()
}
