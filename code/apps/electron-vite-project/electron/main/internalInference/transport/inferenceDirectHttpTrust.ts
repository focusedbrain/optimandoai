/**
 * Inference trust for internal Sandbox→Host targets (same user).
 *
 * Trust is **handshake-bound**: `trusted = state==ACTIVE && type==internal && same_principal
 * && roles sandbox→host && identity_complete && bearer_present`. The transport endpoint does
 * NOT gate trust — `sealed_relay` rows (endpoint null / sentinel `wrdesk.invalid` / relay URL)
 * are a fully trusted transport. The former private-LAN-URL check has been removed from this
 * gate; URL classification only decides whether a legacy direct-LAN URL is surfaced as
 * `normalizedUrl` for the deprecated LAN path. LAN deprecated, see Teil B.
 */

import type { HandshakeRecord } from '../../handshake/types'
import { HandshakeState } from '../../handshake/types'
import {
  type DeriveInternalHostAiPeerRolesResult,
  handshakeSamePrincipal,
} from '../policy'
import { normalizeP2pIngestUrl } from '../p2pEndpointRepair'

export type InferenceDirectHttpTrustReason =
  /** All handshake criteria satisfied (ACTIVE, internal, same principal, sandbox→host, identity complete, bearer). */
  | 'handshake_bound'
  | 'state_not_active'
  | 'handshake_type_not_internal'
  | 'not_same_principal'
  | 'not_sandbox_to_host'
  | 'identity_not_complete'
  | 'missing_bearer_token'
  | 'self_loop_detected'
  /** @deprecated LAN-era reason — no longer produced now that trust is handshake-bound (kept for log/consumer compat). LAN deprecated, see Teil B. */
  | 'peer_host_endpoint_missing'

/**
 * LAN deprecated, see Teil B — classification only. This no longer gates trust; it only decides
 * whether a legacy direct-LAN ingest URL is exposed as `normalizedUrl` for the deprecated
 * direct-HTTP path. Mirrors `isPrivateLanHttpBeapUrl` in `decideInternalInferenceTransport.ts`.
 */
function isPrivateLanHttpBeapUrl(p2pEndpoint: string | null | undefined): boolean {
  const raw = String(p2pEndpoint ?? '').trim()
  if (!raw) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  const c = Number(m[3])
  const d = Number(m[4])
  if ([a, b, c, d].some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function rolesSandboxToHost(roles: DeriveInternalHostAiPeerRolesResult): boolean {
  return roles.ok && roles.localRole === 'sandbox' && roles.peerRole === 'host'
}

export function inferenceDirectHttpTrust(input: {
  handshakeRecord: HandshakeRecord
  roles: DeriveInternalHostAiPeerRolesResult
  counterpartyP2pToken: string | null
  localBeapEndpoint: string | null
  /**
   * Sandbox→Host only: LAN ingest URL chosen by {@link resolveSandboxToHostHttpDirectIngest}
   * (peer header / relay / repaired ledger). When set, overrides `handshakeRecord.p2p_endpoint` for the
   * legacy `normalizedUrl` so the ledger row cannot force `self_loop_detected` when it wrongly holds
   * this sandbox’s BEAP URL. Trust itself is handshake-bound and independent of this URL.
   */
  sandboxPeerLanEndpoint?: string | null
}): {
  trusted: boolean
  reason: InferenceDirectHttpTrustReason
  normalizedUrl: string | null
} {
  const { handshakeRecord: r, roles, counterpartyP2pToken, localBeapEndpoint, sandboxPeerLanEndpoint } = input

  if (r.state !== HandshakeState.ACTIVE) {
    return { trusted: false, reason: 'state_not_active', normalizedUrl: null }
  }
  if (r.handshake_type !== 'internal') {
    return { trusted: false, reason: 'handshake_type_not_internal', normalizedUrl: null }
  }
  if (!handshakeSamePrincipal(r)) {
    return { trusted: false, reason: 'not_same_principal', normalizedUrl: null }
  }
  if (!rolesSandboxToHost(roles)) {
    return { trusted: false, reason: 'not_sandbox_to_host', normalizedUrl: null }
  }
  if (r.internal_coordination_identity_complete !== true) {
    return { trusted: false, reason: 'identity_not_complete', normalizedUrl: null }
  }

  const bearer =
    typeof counterpartyP2pToken === 'string' ? counterpartyP2pToken.trim() : ''
  if (!bearer) {
    return { trusted: false, reason: 'missing_bearer_token', normalizedUrl: null }
  }

  /**
   * LAN deprecated, see Teil B: the endpoint URL no longer gates trust. A missing / sentinel /
   * relay endpoint means `sealed_relay` transport (normalizedUrl null). Only a private-LAN BEAP
   * URL is surfaced as `normalizedUrl` for the legacy direct-HTTP path — and still rejected as a
   * self-loop when it equals this device’s own BEAP.
   */
  const overrideEp =
    typeof sandboxPeerLanEndpoint === 'string' && sandboxPeerLanEndpoint.trim()
      ? sandboxPeerLanEndpoint.trim()
      : ''
  const rawEp = overrideEp || (typeof r.p2p_endpoint === 'string' ? r.p2p_endpoint.trim() : '')
  let normalizedUrl: string | null = null
  if (rawEp && isPrivateLanHttpBeapUrl(rawEp)) {
    normalizedUrl = normalizeP2pIngestUrl(rawEp)
    const localRaw = typeof localBeapEndpoint === 'string' ? localBeapEndpoint.trim() : ''
    if (localRaw && normalizeP2pIngestUrl(localRaw) === normalizedUrl) {
      return { trusted: false, reason: 'self_loop_detected', normalizedUrl: null }
    }
  }

  return {
    trusted: true,
    reason: 'handshake_bound',
    normalizedUrl,
  }
}
