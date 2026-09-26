/**
 * What a `handshake:accept` from the desktop UI accepts.
 *
 * Since Phase 4 every inbound initiate is staged as a Connect offer and only the
 * consent event creates its relationship record [IX.3.1]. The target is
 * therefore an existing record OR a staged offer; an offer the pending list
 * shows must never answer "not found".
 */

import { getHandshakeRecord } from './db'
import { pendingOfferForHandshake } from './formationPipeline'

export type DesktopAcceptTarget =
  | { kind: 'record'; samePrincipal: boolean; localRole: string | null }
  | { kind: 'staged_offer'; samePrincipal: boolean; localRole: 'acceptor' }

export function resolveDesktopAcceptTarget(db: unknown, handshakeId: string): DesktopAcceptTarget | null {
  const record = db ? getHandshakeRecord(db, handshakeId) : null
  if (record) {
    return { kind: 'record', samePrincipal: record.same_principal === true, localRole: record.local_role ?? null }
  }
  const offer = pendingOfferForHandshake(handshakeId)
  if (offer) {
    // Same derivation as the pending-list display record (`connectOfferToDisplayRecord`).
    return { kind: 'staged_offer', samePrincipal: offer.profile_id === 'internal_device', localRole: 'acceptor' }
  }
  return null
}

const PREVIEW_HASH_RE = /^[0-9a-f]{64}$/

/**
 * HC5 [IX.3.4]: a staged offer is consented to only against the preview the
 * user was shown. The desktop UI renders the preview `handshake.list` carries
 * and returns its hash; consent recomputes the hash from the staged row and
 * refuses a mismatch (`prepareFormationConsent`). This gate makes the hash
 * required on the desktop path, so no desktop accept consents unpinned.
 */
export function desktopAcceptPreviewPinError(
  target: DesktopAcceptTarget,
  expectedPreviewHash: unknown,
): 'PREVIEW_HASH_REQUIRED' | null {
  if (target.kind !== 'staged_offer') return null
  return isPreviewHash(expectedPreviewHash) ? null : 'PREVIEW_HASH_REQUIRED'
}

function isPreviewHash(value: unknown): boolean {
  return typeof value === 'string' && PREVIEW_HASH_RE.test(value)
}

export const PREVIEW_HASH_REQUIRED_COPY = 'Open the handshake request again and review it before accepting.'

/**
 * The same pin on the product RPC routes (renderer `vaultRpc`, extension
 * WebSocket): `handshake.accept` of a staged offer and
 * `handshake.consentToOffer` need the hash of the preview the surface
 * rendered. Null lets the call through; `handleHandshakeRPC` itself stays
 * permissive for internal callers.
 */
export function productRoutePreviewPinRefusal(
  db: unknown,
  method: string,
  params: unknown,
): { success: false; reason: 'PREVIEW_HASH_REQUIRED'; error: string } | null {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  let required = false
  if (method === 'handshake.accept' && typeof p.handshake_id === 'string' && p.handshake_id) {
    const target = resolveDesktopAcceptTarget(db, p.handshake_id)
    required = target !== null && desktopAcceptPreviewPinError(target, p.expected_preview_hash) !== null
  } else if (method === 'handshake.consentToOffer') {
    required = !isPreviewHash(p.expected_preview_hash)
  }
  return required ? { success: false, reason: 'PREVIEW_HASH_REQUIRED', error: PREVIEW_HASH_REQUIRED_COPY } : null
}
