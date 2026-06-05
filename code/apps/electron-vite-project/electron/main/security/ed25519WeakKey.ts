import { ed25519 } from '@noble/curves/ed25519'

/**
 * Reject weak Ed25519 public keys BEFORE any signature verification.
 *
 * Background (verified empirically, not assumed — INV-7): both verification
 * stacks in this codebase accept the all-zero public key together with an
 * all-zero signature:
 *   - `@noble/curves` `ed25519.verify` (job-result signatures) accepts the
 *     all-zero key, the neutral element, AND small-order/torsion points
 *     (cofactored / ZIP215 verification).
 *   - Node's native `crypto.verify` (capsule signatures) accepts the all-zero
 *     key (a small-order point) though it rejects the neutral element and other
 *     small-order encodings.
 *
 * A small-order (torsion) public key has a trivially-known discrete log, so any
 * party can forge a signature that satisfies the verification equation under it.
 * At a trust boundary that ingests a counterparty-supplied key, accepting such a
 * key is a forgery vector. We therefore reject all torsion points (which includes
 * the identity / all-zero / small-order encodings) and any non-canonical or
 * undecodable point encoding, uniformly, at every verification boundary.
 *
 * This is intentionally minimal and boundary-local: it does not touch key
 * generation, storage, or transport — only the gate immediately before verify().
 */

const Point = (ed25519 as unknown as { Point?: PointCtor; ExtendedPoint?: PointCtor }).Point
  ?? (ed25519 as unknown as { ExtendedPoint: PointCtor }).ExtendedPoint

interface PointInstance {
  isSmallOrder(): boolean
}
interface PointCtor {
  fromHex(hex: Uint8Array | string): PointInstance
}

/** True if `pub` is NOT a safe full-order Ed25519 public key (reject before verify). */
export function isWeakEd25519PublicKey(pub: Uint8Array): boolean {
  if (!(pub instanceof Uint8Array) || pub.length !== 32) return true
  try {
    // `fromHex` rejects non-canonical encodings; `isSmallOrder` catches the
    // identity, the all-zero key, and every torsion-subgroup point.
    return Point.fromHex(pub).isSmallOrder()
  } catch {
    // Undecodable / off-curve / non-canonical → treat as weak (fail closed).
    return true
  }
}
