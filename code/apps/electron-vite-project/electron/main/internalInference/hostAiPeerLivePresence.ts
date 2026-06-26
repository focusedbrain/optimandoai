/**
 * Host AI: identity-bound live peer presence for Sandbox list + routing gates.
 * Fail-closed — stale ledger hydration, ODL tag cache hits, and synthetic probes do not substitute.
 */

import { getHandshakeRecord } from '../handshake/db'
import { sessionMatchesParty } from '../handshake/handshakeAccountIsolation'
import { getCurrentSession } from '../handshake/ipc'
import type { HandshakeRecord, PartyIdentity, SSOSession } from '../handshake/types'
import { getHandshakeDbForInternalInference } from './dbAccess'
import { InternalInferenceErrorCode } from './errors'
import { assertRecordForServiceRpc, handshakeSamePrincipal } from './policy'

/** Match relay BEAP ad TTL — attestation expires when live proof is no longer fresh. */
export const HOST_PEER_LIVE_PRESENCE_TTL_MS = 86_400_000

export type HostPeerLivePresenceSource = 'http_policy' | 'webrtc_caps' | 'relay_ad' | 'http_header'

type HostPeerLivePresenceAttestation = {
  attestedAtMs: number
  expiresAtMs: number
  source: HostPeerLivePresenceSource
  hostParty: PartyIdentity
}

const attestationByHandshake = new Map<string, HostPeerLivePresenceAttestation>()

/** @internal vitest */
export function resetHostPeerLivePresenceForTests(): void {
  attestationByHandshake.clear()
}

export function hostPartyIdentityFromRecord(r: HandshakeRecord): PartyIdentity | null {
  if (r.initiator_device_role === 'host' && r.initiator) return r.initiator
  if (r.acceptor_device_role === 'host' && r.acceptor) return r.acceptor
  return r.initiator ?? r.acceptor ?? null
}

export function partyIdentityFromSession(session: SSOSession | null | undefined): PartyIdentity | null {
  if (!session) return null
  return {
    email: session.email,
    wrdesk_user_id: session.wrdesk_user_id,
    iss: session.iss,
    sub: session.sub,
  }
}

export function partyIdentityMatchesExpected(
  actual: PartyIdentity | null | undefined,
  expected: PartyIdentity | null | undefined,
): boolean {
  if (!actual || !expected) return false
  return sessionMatchesParty(
    {
      email: actual.email ?? '',
      wrdesk_user_id: actual.wrdesk_user_id,
      iss: actual.iss,
      sub: actual.sub,
    },
    expected,
  )
}

export function publisherIdentityFromWireFields(raw: {
  hostPublisherWrdeskUserId?: unknown
  hostPublisherIss?: unknown
  hostPublisherSub?: unknown
  host_publisher_wrdesk_user_id?: unknown
  publisher_wrdesk_user_id?: unknown
  publisher_iss?: unknown
  publisher_sub?: unknown
}): PartyIdentity | null {
  const wrdesk =
    (typeof raw.hostPublisherWrdeskUserId === 'string' ? raw.hostPublisherWrdeskUserId : '') ||
    (typeof raw.host_publisher_wrdesk_user_id === 'string' ? raw.host_publisher_wrdesk_user_id : '') ||
    (typeof raw.publisher_wrdesk_user_id === 'string' ? raw.publisher_wrdesk_user_id : '')
  const iss =
    (typeof raw.hostPublisherIss === 'string' ? raw.hostPublisherIss : '') ||
    (typeof raw.publisher_iss === 'string' ? raw.publisher_iss : '')
  const sub =
    (typeof raw.hostPublisherSub === 'string' ? raw.hostPublisherSub : '') ||
    (typeof raw.publisher_sub === 'string' ? raw.publisher_sub : '')
  const w = wrdesk.trim()
  const i = iss.trim()
  const s = sub.trim()
  if (!w && !(i && s)) return null
  return { email: '', wrdesk_user_id: w || undefined, iss: i || undefined, sub: s || undefined }
}

function storeAttestation(
  handshakeId: string,
  record: HandshakeRecord,
  source: HostPeerLivePresenceSource,
  publisher: PartyIdentity,
  expiresAtMs?: number | null,
): boolean {
  const hid = handshakeId.trim()
  const expected = hostPartyIdentityFromRecord(record)
  if (!hid || !expected || !partyIdentityMatchesExpected(publisher, expected)) {
    attestationByHandshake.delete(hid)
    console.log(
      `[HOST_AI_PEER_LIVE_PRESENCE] ${JSON.stringify({
        handshake_id: hid || null,
        ok: false,
        reason: 'publisher_identity_mismatch',
        source,
      })}`,
    )
    return false
  }
  const attestedAtMs = Date.now()
  const exp =
    typeof expiresAtMs === 'number' && Number.isFinite(expiresAtMs) && expiresAtMs > attestedAtMs
      ? expiresAtMs
      : attestedAtMs + HOST_PEER_LIVE_PRESENCE_TTL_MS
  attestationByHandshake.set(hid, { attestedAtMs, expiresAtMs: exp, source, hostParty: expected })
  console.log(
    `[HOST_AI_PEER_LIVE_PRESENCE] ${JSON.stringify({
      handshake_id: hid,
      ok: true,
      source,
      expires_at_ms: exp,
    })}`,
  )
  return true
}

export function tryRecordHostPeerLivePresenceFromPolicyResponse(
  handshakeId: string,
  record: HandshakeRecord,
  payload: Record<string, unknown>,
  allowSandboxInference: boolean,
): boolean {
  if (!allowSandboxInference) {
    attestationByHandshake.delete(handshakeId.trim())
    return false
  }
  const publisher = publisherIdentityFromWireFields(payload)
  if (!publisher) return false
  return storeAttestation(handshakeId, record, 'http_policy', publisher)
}

export function tryRecordHostPeerLivePresenceFromCapabilitiesWire(
  handshakeId: string,
  record: HandshakeRecord,
  wire: Record<string, unknown>,
  policyEnabled: boolean,
): boolean {
  if (!policyEnabled) {
    attestationByHandshake.delete(handshakeId.trim())
    return false
  }
  const publisher = publisherIdentityFromWireFields(wire)
  if (!publisher) return false
  return storeAttestation(handshakeId, record, 'webrtc_caps', publisher)
}

export function tryRecordHostPeerLivePresenceFromRelayAd(
  handshakeId: string,
  record: HandshakeRecord,
  raw: Record<string, unknown>,
): boolean {
  const route = raw.host_ai_route
  const routeObj = route && typeof route === 'object' ? (route as Record<string, unknown>) : null
  const publisher = publisherIdentityFromWireFields(routeObj ?? raw)
  if (!publisher) return false
  const expRaw = typeof raw.expires_at === 'string' ? raw.expires_at.trim() : ''
  const expMs = expRaw ? Date.parse(expRaw) : NaN
  return storeAttestation(handshakeId, record, 'relay_ad', publisher, Number.isFinite(expMs) ? expMs : null)
}

export function hasHostPeerIdentityBoundLivePresence(handshakeId: string, record: HandshakeRecord): boolean {
  const hid = handshakeId.trim()
  const att = attestationByHandshake.get(hid)
  if (!att) return false
  if (Date.now() > att.expiresAtMs) {
    attestationByHandshake.delete(hid)
    return false
  }
  const expected = hostPartyIdentityFromRecord(record)
  return partyIdentityMatchesExpected(att.hostParty, expected)
}

export function assertHostMachineSessionMatchesHandshakeHostParty(
  record: HandshakeRecord,
): { ok: true } | { ok: false; code: typeof InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE | typeof InternalInferenceErrorCode.HOST_AI_IDENTITY_INCOMPLETE } {
  const session = getCurrentSession()
  if (!session) {
    return { ok: false, code: InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE }
  }
  // §2 anchor: Host AI is only ever served on an ACTIVE internal, same-principal handshake.
  // `handshakeSamePrincipal` means BOTH ends resolve to the same SSO account, so it is sufficient —
  // and more robust after the host/sandbox process-split — to match the session against EITHER party
  // rather than only the host-role party (whose identity JSON can be incomplete on one ledger copy
  // post-split, which previously produced spurious HOST_AI_IDENTITY_INCOMPLETE / *_OFFLINE denials).
  if (record.handshake_type !== 'internal' || !handshakeSamePrincipal(record)) {
    return { ok: false, code: InternalInferenceErrorCode.HOST_AI_IDENTITY_INCOMPLETE }
  }
  const matchesEitherParty =
    sessionMatchesParty(session, record.initiator) ||
    (record.acceptor != null && sessionMatchesParty(session, record.acceptor))
  if (!matchesEitherParty) {
    return { ok: false, code: InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE }
  }
  return { ok: true }
}

export function hostPublisherIdentityWireFields(session: SSOSession | null | undefined): {
  hostPublisherWrdeskUserId?: string
  hostPublisherIss?: string
  hostPublisherSub?: string
} {
  const party = partyIdentityFromSession(session)
  if (!party) return {}
  const w = (party.wrdesk_user_id ?? '').trim()
  const iss = (party.iss ?? '').trim()
  const sub = (party.sub ?? '').trim()
  return {
    ...(w ? { hostPublisherWrdeskUserId: w } : {}),
    ...(iss ? { hostPublisherIss: iss } : {}),
    ...(sub ? { hostPublisherSub: sub } : {}),
  }
}

export async function assertSandboxHostPeerLivePresenceForHandshake(
  handshakeId: string,
): Promise<{ ok: true; record: HandshakeRecord } | { ok: false; code: string }> {
  const hid = handshakeId.trim()
  if (!hid) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE }
  }
  const r = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    return { ok: false, code: ar.code }
  }
  if (!hasHostPeerIdentityBoundLivePresence(hid, ar.record)) {
    return { ok: false, code: InternalInferenceErrorCode.HOST_AI_PEER_IDENTITY_OFFLINE }
  }
  return { ok: true, record: ar.record }
}
