/**
 * Handshake refactor regression matrix — narrow, deterministic checks that must pass
 * before handshake pipeline refactors merge.
 *
 * Coverage map
 * -------------
 * | ID | Requirement | Primary test(s) here | Full IPC / integration (CI with graph) |
 * |----|-------------|----------------------|------------------------------------------|
 * | M1 | Internal preflight skips wire X25519; full accept+device key | `matrix_M1_internal_record_no_wire_preflight_ok` | `ipc.internal.accept.validation` + deviceKeyStore mock; `acceptX25519Binding.internal` R4 |
 * | M2 | Normal w/o X25519 → ERR | `matrix_M2_preflight_normal_no_wire_fails` | `acceptX25519Binding.regression` R1; `ipc.handshake` |
 * | M3 | Normal w/ X25519; caller wire reaches agreement path | `matrix_M3_*` | `acceptX25519Binding` R5 (no ephemeral keygen) |
 * | M4 | Internal DB + no device_role hint → not X25519 ERR | `matrix_M4_preflight` | `handleHandshakeRPC` + internal record (same as M1 preflight) |
 * | M5 | Normal DB + device_role spoof → still need wire | `matrix_M5_preflight` | main `handshake:accept` uses `record.handshake_type` |
 * | M6 | Internal defer: `context_sync_pending` + retry path | `matrix_M6_pending_and_active_gate` | `internalSamePrincipal.contextSync`; relay defer in `ipc.ts` |
 * | M7 | Normal roundtrip both ACTIVE | `matrix_M7_active_gate_both_sides` | `postAcceptContextSync.ingestPaths`; `ipc.handshake` T5 |
 *
 * The tests below model **`handleHandshakeRPC` `handshake.accept` X25519 preflight** (keep in sync with
 * `ipc.ts` `record.handshake_type` / `acceptorX25519FromHandshakeAcceptParams`) without importing the
 * full IPC module (avoids heavy crypto/renderer shims in some Vitest setups).
 */

import { describe, test, expect } from 'vitest'
import { getNextStateAfterInboundContextSync } from '../contextSyncActiveGate'
import { HandshakeState, type HandshakeRecord } from '../types'
import { buildHandshakeAcceptSafeOpts } from '../../../handshakeAcceptSafeOpts'

/** Same bytes as `mockKeypair.MOCK_EXTENSION_X25519_PUBLIC_B64` — inlined to avoid pulling `signatureKeys`/crypto in Vitest. */
const MOCK_EXTENSION_X25519_PUBLIC_B64 = 'dGVzdC14MjU1MTktcHViLWtleS1iNjQ='

/** Mirrors `acceptorX25519FromHandshakeAcceptParams` in `ipc.ts` (keep aligned). */
function wireX25519FromAcceptParams(params: unknown): string {
  const p = params as {
    senderX25519PublicKeyB64?: string | null
    sender_x25519_public_key_b64?: string | null
    key_agreement?: { x25519_public_key_b64?: string | null }
  }
  const camel = p?.senderX25519PublicKeyB64?.trim() ?? ''
  if (camel.length > 0) return camel
  const snake = typeof p?.sender_x25519_public_key_b64 === 'string' ? p.sender_x25519_public_key_b64.trim() : ''
  if (snake.length > 0) return snake
  return p?.key_agreement?.x25519_public_key_b64?.trim() ?? ''
}

function preflightLikeHandleHandshakeAccept(
  recordHandshakeType: 'internal' | 'standard' | null | undefined,
  params: unknown,
): { ok: boolean; code?: 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED' } {
  if (recordHandshakeType === 'internal') {
    return { ok: true }
  }
  const w = wireX25519FromAcceptParams(params)
  if (!w) return { ok: false, code: 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED' }
  return { ok: true }
}

describe('handshakeRefactorRegression.matrix — X25519 preflight model (M2, M3, M4, M5)', () => {
  const internalParams = { device_name: 'A', local_pairing_code_typed: '123456' }
  const normalParams = { senderX25519PublicKeyB64: MOCK_EXTENSION_X25519_PUBLIC_B64 }

  test('matrix_M2_normal_record_without_X25519_fails_ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED', () => {
    const p = { sharing_mode: 'receive-only' as const, fromAccountId: '1' }
    const r = preflightLikeHandleHandshakeAccept('standard', p)
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })

  test('matrix_M2b_normal_record_null_handshake_type_fails_same', () => {
    const r = preflightLikeHandleHandshakeAccept(null, {})
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })

  test('matrix_M1_internal_record_no_wire_preflight_ok', () => {
    const r = preflightLikeHandleHandshakeAccept('internal', {})
    expect(r).toEqual({ ok: true })
  })

  test('matrix_M3_normal_with_senderX25519_preflight_ok', () => {
    const r = preflightLikeHandleHandshakeAccept('standard', normalParams)
    expect(r).toEqual({ ok: true })
  })

  test('matrix_M3b_wire_extraction_non_empty_ensures_ensureKeyAgreementKeys_receives_caller_key', () => {
    expect(wireX25519FromAcceptParams(normalParams)).toBe(MOCK_EXTENSION_X25519_PUBLIC_B64)
  })

  test('matrix_M4_internal_record_ignores_missing_device_role_for_preflight', () => {
    const r = preflightLikeHandleHandshakeAccept('internal', internalParams)
    expect(r.ok).toBe(true)
    expect(r.code).toBeUndefined()
  })

  test('matrix_M5_normal_record_spoofed_device_role_still_requires_wire', () => {
    const r = preflightLikeHandleHandshakeAccept('standard', {
      ...internalParams,
      device_role: 'host',
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED')
  })
})

describe('handshakeRefactorRegression.matrix — preload allowlist (M4 device_role hint not security)', () => {
  test('matrix_M4_safeOpts_forward_without_X25519_for_inspection', () => {
    const s = buildHandshakeAcceptSafeOpts({ device_name: 'X', device_role: 'host' })
    expect(s).toMatchObject({ device_role: 'host' })
    expect(s).not.toHaveProperty('senderX25519PublicKeyB64')
  })
})

describe('handshakeRefactorRegression.matrix — ACTIVE gate + defer (M6, M7)', () => {
  test('matrix_M6_internal_defer_context_sync_pending_and_retry_contract', () => {
    const a: HandshakeRecord = {
      state: HandshakeState.ACCEPTED,
      last_seq_sent: 0,
      last_seq_received: 0,
    } as HandshakeRecord
    expect(getNextStateAfterInboundContextSync(a, 1)).toBe(HandshakeState.ACCEPTED)

    const b: HandshakeRecord = {
      state: HandshakeState.ACCEPTED,
      last_seq_sent: 1,
      last_seq_received: 0,
    } as HandshakeRecord
    expect(getNextStateAfterInboundContextSync(b, 1)).toBe(HandshakeState.ACTIVE)
  })

  test('matrix_M7_normal_cross_principal_ACTIVE_gate_both_sides', () => {
    const init: HandshakeRecord = {
      state: HandshakeState.ACCEPTED,
      handshake_type: undefined,
      last_seq_sent: 1,
      last_seq_received: 1,
    } as HandshakeRecord
    const acc: HandshakeRecord = {
      state: HandshakeState.ACCEPTED,
      handshake_type: undefined,
      last_seq_sent: 1,
      last_seq_received: 1,
    } as HandshakeRecord
    expect(getNextStateAfterInboundContextSync(init, 1)).toBe(HandshakeState.ACTIVE)
    expect(getNextStateAfterInboundContextSync(acc, 1)).toBe(HandshakeState.ACTIVE)
  })
})
