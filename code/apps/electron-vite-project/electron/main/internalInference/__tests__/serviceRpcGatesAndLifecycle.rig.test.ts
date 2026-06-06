/**
 * Phase-1 item 7 — internal inference request/result/error/cancel lifecycle + the
 * service-RPC access gates (`assertRecordForServiceRpc`). This is the gate the
 * RemoteHandshakeExecutor is modelled on; it must be airtight, so it is proven
 * directly against the real production function (no mocks).
 *
 * Single-box scope: the request/result/error/cancel STATE MACHINE (the sandbox
 * pending-request map) and the ACCESS GATES are fully deterministic in one process
 * and proven here. The live two-instance transport (WebRTC data channel / direct
 * HTTP between two real orchestrator processes with distinct instance ids) needs
 * two OS processes and is covered by the cross-machine runbook (see rig/README.md).
 *
 * Run under Electron's Node ABI: `pnpm test:native-db <thisFile>`.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import { assertRecordForServiceRpc } from '../policy'
import { InternalInferenceErrorCode } from '../errors'
import {
  registerInternalInferenceRequest,
  resolveInternalInferenceByRequestId,
  rejectInternalInferenceByRequestId,
  _resetPendingForTests,
  type PendingResult,
} from '../pendingRequests'
import type { HandshakeRecord } from '../../handshake/types'

/** Minimal record carrying only the fields `assertRecordForServiceRpc` inspects. */
function record(overrides: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_type: 'internal',
    state: 'ACTIVE',
    initiator: { wrdesk_user_id: 'same-user' },
    acceptor: { wrdesk_user_id: 'same-user' },
    internal_coordination_repair_needed: false,
    internal_coordination_identity_complete: true,
    ...overrides,
  } as unknown as HandshakeRecord
}

describe('service-RPC access gates (RemoteHandshakeExecutor template)', () => {
  it('accepts an ACTIVE internal same-principal record', () => {
    const g = assertRecordForServiceRpc(record())
    expect(g.ok).toBe(true)
  })

  it('REJECTS a non-ACTIVE handshake → POLICY_FORBIDDEN', () => {
    for (const state of ['REVOKED', 'ACCEPTED', 'PENDING_REVIEW', 'EXPIRED']) {
      const g = assertRecordForServiceRpc(record({ state } as Partial<HandshakeRecord>))
      expect(g.ok).toBe(false)
      expect((g as { code: string }).code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
    }
  })

  it('REJECTS a different-principal request → POLICY_FORBIDDEN', () => {
    const g = assertRecordForServiceRpc(
      record({
        initiator: { wrdesk_user_id: 'user-a' },
        acceptor: { wrdesk_user_id: 'user-b' },
      } as Partial<HandshakeRecord>),
    )
    expect(g.ok).toBe(false)
    expect((g as { code: string }).code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })

  it('REJECTS a non-internal handshake → POLICY_FORBIDDEN', () => {
    const g = assertRecordForServiceRpc(record({ handshake_type: 'normal' } as Partial<HandshakeRecord>))
    expect(g.ok).toBe(false)
    expect((g as { code: string }).code).toBe(InternalInferenceErrorCode.POLICY_FORBIDDEN)
  })

  it('REJECTS a missing record → NO_ACTIVE_INTERNAL_HOST_HANDSHAKE', () => {
    expect(assertRecordForServiceRpc(null).ok).toBe(false)
    expect((assertRecordForServiceRpc(undefined) as { code: string }).code).toBe(
      InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE,
    )
  })

  it('REJECTS when coordination identity is incomplete / repair needed', () => {
    expect((assertRecordForServiceRpc(record({ internal_coordination_identity_complete: false } as Partial<HandshakeRecord>)) as { code: string }).code).toBe(
      InternalInferenceErrorCode.POLICY_FORBIDDEN,
    )
    expect((assertRecordForServiceRpc(record({ internal_coordination_repair_needed: true } as Partial<HandshakeRecord>)) as { code: string }).code).toBe(
      InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE,
    )
  })
})

describe('inference request/result/error/cancel lifecycle (sandbox pending map)', () => {
  beforeEach(() => _resetPendingForTests())

  it('request → result settles the pending promise with the output', async () => {
    const rid = 'req-result-1'
    const pending = registerInternalInferenceRequest(rid, 5_000)
    const delivered = resolveInternalInferenceByRequestId(rid, { kind: 'result', output: 'pong', model: 'm', duration_ms: 5 })
    expect(delivered).toBe(true)
    const settled = (await pending) as Extract<PendingResult, { kind: 'result' }>
    expect(settled.kind).toBe('result')
    expect(settled.output).toBe('pong')
  })

  it('request → error settles the pending promise with the error verdict', async () => {
    const rid = 'req-error-1'
    const pending = registerInternalInferenceRequest(rid, 5_000)
    expect(resolveInternalInferenceByRequestId(rid, { kind: 'error', code: 'E_MODEL', message: 'model failed' })).toBe(true)
    const settled = (await pending) as Extract<PendingResult, { kind: 'error' }>
    expect(settled.kind).toBe('error')
    expect(settled.code).toBe('E_MODEL')
  })

  it('request → cancel rejects the pending promise', async () => {
    const rid = 'req-cancel-1'
    const pending = registerInternalInferenceRequest(rid, 5_000)
    const err = new Error('CANCELLED')
    ;(err as { code?: string }).code = 'CANCELLED'
    expect(rejectInternalInferenceByRequestId(rid, err)).toBe(true)
    await expect(pending).rejects.toThrow('CANCELLED')
  })

  it('resolving/cancelling an unknown request id is a no-op (idempotent, no double settle)', () => {
    expect(resolveInternalInferenceByRequestId('nope', { kind: 'result', output: 'x' })).toBe(false)
    expect(rejectInternalInferenceByRequestId('nope', new Error('x'))).toBe(false)

    const rid = 'req-once'
    void registerInternalInferenceRequest(rid, 5_000)
    expect(resolveInternalInferenceByRequestId(rid, { kind: 'result', output: 'first' })).toBe(true)
    // Second settle finds nothing pending → false (delivered exactly once).
    expect(resolveInternalInferenceByRequestId(rid, { kind: 'result', output: 'second' })).toBe(false)
  })
})
