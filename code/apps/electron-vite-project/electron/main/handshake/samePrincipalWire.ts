/**
 * Legacy wire → profile compat boundary (Phase 4, Q9) [VII.4.6]
 *
 * The `handshake_type: 'internal' | 'standard'` discriminator is ELIMINATED
 * from records and from all semantic branching: the admission situation
 * "both endpoints belong to the same principal" is the profile-registry
 * parameter `same_principal` (profile `internal_device`).
 *
 * v2 wire capsules still carry `handshake_type` for old peers (dual-format
 * emission, Phase 2). This module is the ONLY place inbound code may read
 * that wire field — everything downstream consumes the mapped profile /
 * boolean. Guarded by handshakeTypeElimination.guard.test.ts.
 */

/**
 * Single permitted read of the legacy wire discriminator: does this wire
 * object (capsule, parsed input, IPC request) declare same-principal
 * device pairing?
 */
export function wireDeclaresSamePrincipal(
  x: { handshake_type?: unknown } | null | undefined,
): boolean {
  return typeof x?.handshake_type === 'string' && x.handshake_type.trim() === 'internal'
}

/**
 * Legacy wire value for OUTBOUND emission to old-build peers (dual-format):
 * same-principal relationships emit 'internal', everything else omits the
 * field (callers spread conditionally).
 */
export function legacyWireHandshakeType(samePrincipal: boolean | undefined): 'internal' | undefined {
  return samePrincipal === true ? 'internal' : undefined
}
