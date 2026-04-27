/**
 * Inference-only direct HTTP trust (Sandbox→Host, same user).
 * Does not read BEAP advertisement state — handshake row + bearer + URL shape only.
 */

import type { HandshakeRecord } from '../../handshake/types'
import { HandshakeState } from '../../handshake/types'
import {
  type DeriveInternalHostAiPeerRolesResult,
  handshakeSamePrincipal,
} from '../policy'
import { normalizeP2pIngestUrl } from '../p2pEndpointRepair'

type InferenceDirectHttpTrustReason =
  | 'handshake_inference_trust'
  | 'state_not_active'
  | 'handshake_type_not_internal'
  | 'not_same_principal'
  | 'not_sandbox_to_host'
  | 'identity_not_complete'
  | 'url_not_private_lan'
  | 'missing_bearer_token'
  | 'self_loop_detected'

/**
 * Mirrors `isPrivateLanHttpBeapUrl` in `decideInternalInferenceTransport.ts`.
 * Not exported from `p2pEndpointRepair.ts`; kept local to avoid editing that module.
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
}): {
  trusted: boolean
  reason: InferenceDirectHttpTrustReason
  normalizedUrl: string | null
} {
  const { handshakeRecord: r, roles, counterpartyP2pToken, localBeapEndpoint } = input

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

  const rawEp = typeof r.p2p_endpoint === 'string' ? r.p2p_endpoint.trim() : ''
  if (!rawEp || !isPrivateLanHttpBeapUrl(rawEp)) {
    return { trusted: false, reason: 'url_not_private_lan', normalizedUrl: null }
  }

  const bearer =
    typeof counterpartyP2pToken === 'string' ? counterpartyP2pToken.trim() : ''
  if (!bearer) {
    return { trusted: false, reason: 'missing_bearer_token', normalizedUrl: null }
  }

  const normalizedUrl = normalizeP2pIngestUrl(rawEp)
  const localRaw = typeof localBeapEndpoint === 'string' ? localBeapEndpoint.trim() : ''
  if (localRaw && normalizeP2pIngestUrl(localRaw) === normalizedUrl) {
    return { trusted: false, reason: 'self_loop_detected', normalizedUrl: null }
  }

  return {
    trusted: true,
    reason: 'handshake_inference_trust',
    normalizedUrl,
  }
}
