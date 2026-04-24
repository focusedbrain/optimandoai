/**
 * Placeholder registry for the cross-surface regression matrix.
 * @see ./handshakeCrossSurface.regressionMatrix.md
 *
 * Replace `it.todo` with real tests (I/E tier) or import shared suites.
 * Do not add business logic here — only test stubs / future automation hooks.
 */
import { describe, it, expect } from 'vitest'

describe('handshakeCrossSurface — INTERNAL + Electron (spec: regressionMatrix.md Flow 1)', () => {
  it.todo('regression_INT_EL_accept_phase_persists_initiate_imports_accept')
  it.todo('regression_INT_EL_local_role_initiator_acceptor')
  it.todo('regression_INT_EL_handshake_type_internal')
  it.todo('regression_INT_EL_X25519_strict_device_bound')
  it.todo('regression_INT_EL_context_sync_seq1_both')
  it.todo('regression_INT_EL_ACTIVE_after_roundtrip')
  it.todo('regression_INT_EL_transport_200_pushed_live')
  it.todo('regression_INT_EL_transport_202_drain')
  it.todo('regression_INT_EL_relay_internal_device_routing')
})

describe('handshakeCrossSurface — INTERNAL + Extension (if supported)', () => {
  it.todo('regression_INT_EXT_VAULT_rpc_accept_parity')
  it.todo('regression_INT_EXT_X25519_key_source')
  it.todo('regression_INT_EXT_context_sync_ACTIVE_parity')
})

describe('handshakeCrossSurface — NORMAL + Electron (spec: regressionMatrix.md Flow 3)', () => {
  it.todo('regression_NORM_EL_accept_persists_roles_types')
  it.todo('regression_NORM_EL_X25519_required_wire')
  it.todo('regression_NORM_EL_X25519_no_ephemeral_mint')
  it.todo('regression_NORM_EL_context_sync_seq1_both')
  it.todo('regression_NORM_EL_ACTIVE_both')
  it.todo('regression_NORM_EL_transport_200')
  it.todo('regression_NORM_EL_transport_202_drain')
  it.todo('regression_NORM_EL_relay_routes_by_receiver_wrdesk_user_id')
  it.todo('regression_NORM_EL_no_internal_routing_fields')
  it.todo('regression_NORM_EL_no_internal_coordination_identity_complete')
  it.todo('regression_NORM_EL_initiator_acceptor_ids_not_swapped')
  it.todo('regression_NORM_EL_receiverIdentity_quirks_ignored')
})

describe('handshakeCrossSurface — NORMAL + Extension', () => {
  it.todo('regression_NORM_EXT_parity_Electron_normal')
  it.todo('regression_NORM_EXT_X25519_wire')
})

describe('handshakeCrossSurface — failure invariants (X1–X3)', () => {
  it.todo('X1_ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_enforced_on_normal')
  it.todo('X2_relay_202_eventual_drain_and_ack')
  it.todo('X3_stuck_ACCEPTED_unacceptable_after_drain')
})

// Vitest: empty todo suites still load; this ensures the file is valid
describe('handshakeCrossSurface — matrix doc link', () => {
  it('references regression matrix', () => {
    expect('handshakeCrossSurface.regressionMatrix.md').toContain('regression')
  })
})
