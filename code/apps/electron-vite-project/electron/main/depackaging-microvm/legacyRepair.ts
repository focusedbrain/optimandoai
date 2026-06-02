/**
 * Legacy handshake re-pair affordance — Build 1, §3.
 *
 * Pre-schema-v50 handshakes were created before X25519 key material was
 * persisted: they have NULL `local_x25519_public_key_b64` / `peer_x25519_*` and
 * are refused for P2P with `ERR_HANDSHAKE_LOCAL_KEY_MISSING`. Blob custody needs
 * the sandbox's X25519 PUBLIC key to encrypt artifacts to. When it is missing we
 * MUST NOT silently fail — we surface a clear "re-establish this sandbox pairing"
 * affordance so the user can re-pair and obtain fully-keyed handshakes.
 *
 * New handshakes are fully keyed; for those we assume working delivery.
 */

/** Minimal handshake fields this assessment needs. */
export interface HandshakeKeyView {
  id: string
  deviceName?: string | null
  /** Sandbox's X25519 PUBLIC key (what custody encrypts to). v50+ only. */
  peer_x25519_public_key_b64?: string | null
  /** This party's local X25519 public key. NULL on pre-v50 records. */
  local_x25519_public_key_b64?: string | null
}

export const ERR_HANDSHAKE_LOCAL_KEY_MISSING = 'ERR_HANDSHAKE_LOCAL_KEY_MISSING' as const

export interface RepairAffordance {
  action: 're_pair_sandbox'
  handshakeId: string
  /** User-facing, primary-text copy (theme-agnostic; rendered by the trust UI). */
  message: string
}

export type SandboxKeyReadiness =
  | { ready: true; sandboxPeerX25519PubB64: string }
  | { ready: false; code: typeof ERR_HANDSHAKE_LOCAL_KEY_MISSING; repair: RepairAffordance }

function isValidX25519PubB64(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false
  try {
    return Buffer.from(v, 'base64').length === 32
  } catch {
    return false
  }
}

/**
 * Determine whether a handshake can be used for blob custody. If the required
 * X25519 key material is missing (pre-v50), return a re-pair affordance instead
 * of silently failing.
 */
export function assessSandboxKeyReadiness(hs: HandshakeKeyView): SandboxKeyReadiness {
  if (isValidX25519PubB64(hs.peer_x25519_public_key_b64)) {
    return { ready: true, sandboxPeerX25519PubB64: hs.peer_x25519_public_key_b64 as string }
  }
  const label = hs.deviceName ? `"${hs.deviceName}"` : 'this sandbox'
  return {
    ready: false,
    code: ERR_HANDSHAKE_LOCAL_KEY_MISSING,
    repair: {
      action: 're_pair_sandbox',
      handshakeId: hs.id,
      message:
        `Secure key material for ${label} is missing because it was paired before the ` +
        `current encryption upgrade. Re-establish this sandbox pairing to enable secure ` +
        `attachment handling.`,
    },
  }
}
