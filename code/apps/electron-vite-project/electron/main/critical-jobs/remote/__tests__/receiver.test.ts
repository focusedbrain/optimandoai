/**
 * Phase 1 — receiving-side gate + sovereign re-dispatch + typed refusals
 * (spec 0017 §2.3–§2.4, §4 security obligations).
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { join } from 'path'
import { x25519 } from '@noble/curves/ed25519'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), 'tmp-ev-critjob'), getAppPath: () => process.cwd() },
}))

import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import { buildReceiverDispatcher } from '../receiverDispatcher'
import {
  handleCriticalJobRequest,
  _resetReplayForTests,
  type CriticalJobReceiverDeps,
} from '../receiver'
import { serializeCriticalJobSpec } from '../serialize'
import { CRITICAL_JOB_SCHEMA_VERSION, type CriticalJobRequestWire } from '../wire'
import type { CriticalJobKind, CriticalJobSpec } from '../../types'

function party(uid: string): PartyIdentity {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function record(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
    local_role: 'acceptor',
    handshake_type: 'internal',
    internal_coordination_identity_complete: true,
    initiator_coordination_device_id: 'dev-ws-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    p2p_endpoint: 'http://10.0.0.2:51249/beap/ingest',
    counterparty_p2p_token: 'tok',
    ...over,
  } as unknown as HandshakeRecord
}

function pubKey(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

function depackageSpec(over: Partial<CriticalJobSpec<'depackage'>> = {}): CriticalJobSpec<'depackage'> {
  return {
    jobId: `job-${Math.random().toString(36).slice(2)}`,
    kind: 'depackage',
    input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody text') },
    custodyPubKeyB64: pubKey(),
    limits: { maxWallClockMs: 30_000 },
    flush: 'per-action',
    ...over,
  }
}

function requestWire<K extends CriticalJobKind>(
  spec: CriticalJobSpec<K>,
  over: Partial<CriticalJobRequestWire> = {},
): CriticalJobRequestWire {
  const now = Date.now()
  return {
    type: 'critical_job_request',
    schema_version: CRITICAL_JOB_SCHEMA_VERSION,
    request_id: `req-${Math.random().toString(36).slice(2)}`,
    handshake_id: 'hs-1',
    sender_device_id: 'dev-ws-1',
    target_device_id: 'dev-sand-1',
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60_000).toISOString(),
    job: serializeCriticalJobSpec(spec),
    ...over,
  }
}

function sandboxDeps(over: Partial<CriticalJobReceiverDeps> = {}): CriticalJobReceiverDeps {
  return {
    getRecord: () => record(),
    dispatcher: buildReceiverDispatcher({ role: 'sandbox', tier: 'free', topology: { linked: [] } }),
    ...over,
  }
}

describe('critical-job receiver — gate + sovereign re-dispatch', () => {
  beforeEach(() => _resetReplayForTests())

  test('happy path: depackage runs and returns a signed critical_job_result', async () => {
    const out = await handleCriticalJobRequest(requestWire(depackageSpec()), 'dev-sand-1', sandboxDeps())
    expect(out.type).toBe('critical_job_result')
    if (out.type !== 'critical_job_result') return
    expect(out.sender_device_id).toBe('dev-sand-1')
    expect(out.target_device_id).toBe('dev-ws-1')
    const r = out.result as { ok: boolean; result_signature_b64?: string; meta?: { executorId: string } }
    expect(r.ok).toBe(true)
    expect(typeof r.result_signature_b64).toBe('string')
    expect(r.meta?.executorId).toBe('in-process')
  })

  test('same-principal violation refused (E_REMOTE_HANDSHAKE_INACTIVE)', async () => {
    const deps = sandboxDeps({ getRecord: () => record({ initiator: party('u1'), acceptor: party('u2') }) })
    const out = await handleCriticalJobRequest(requestWire(depackageSpec()), 'dev-sand-1', deps)
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_HANDSHAKE_INACTIVE')
  })

  test('non-ACTIVE handshake refused', async () => {
    const deps = sandboxDeps({ getRecord: () => record({ state: 'ACCEPTED' as never }) })
    const out = await handleCriticalJobRequest(requestWire(depackageSpec()), 'dev-sand-1', deps)
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_HANDSHAKE_INACTIVE')
  })

  test('non-internal handshake refused', async () => {
    const deps = sandboxDeps({ getRecord: () => record({ handshake_type: 'standard' as never }) })
    const out = await handleCriticalJobRequest(requestWire(depackageSpec()), 'dev-sand-1', deps)
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_HANDSHAKE_INACTIVE')
  })

  test('oversize request refused at the gate and never dispatched', async () => {
    const dispatchSpy = vi.fn()
    const dispatcher = buildReceiverDispatcher({ role: 'sandbox', tier: 'free', topology: { linked: [] } })
    const origDispatch = dispatcher.dispatch.bind(dispatcher)
    ;(dispatcher as unknown as { dispatch: unknown }).dispatch = (...a: unknown[]) => {
      dispatchSpy()
      return (origDispatch as (...x: unknown[]) => unknown)(...a)
    }
    const big = depackageSpec({ input: { inputBytes: Buffer.alloc(64) } })
    const out = await handleCriticalJobRequest(
      requestWire(big),
      'dev-sand-1',
      sandboxDeps({ dispatcher, maxInputBytes: 16 }),
    )
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_PAYLOAD_TOO_LARGE')
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  test('jobId replay deduped', async () => {
    const spec = depackageSpec()
    const first = await handleCriticalJobRequest(requestWire(spec), 'dev-sand-1', sandboxDeps())
    expect(first.type).toBe('critical_job_result')
    const second = await handleCriticalJobRequest(requestWire(spec), 'dev-sand-1', sandboxDeps())
    expect(second.type).toBe('critical_job_error')
    if (second.type === 'critical_job_error') expect(second.code).toBe('E_REMOTE_REPLAY')
  })

  test('remote decrypt-qbeap refused (E_KEY_LOCALITY)', async () => {
    const spec: CriticalJobSpec<'decrypt-qbeap'> = {
      jobId: 'dq-1',
      kind: 'decrypt-qbeap',
      input: { packageJson: '{}', handshakeId: 'hs-1' },
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const out = await handleCriticalJobRequest(requestWire(spec), 'dev-sand-1', sandboxDeps())
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_KEY_LOCALITY')
  })

  test('view-attachment without custody key refused (E_KEY_LOCALITY)', async () => {
    const spec: CriticalJobSpec<'view-attachment'> = {
      jobId: 'va-1',
      kind: 'view-attachment',
      input: { artifactRef: 'ref-1' },
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const out = await handleCriticalJobRequest(requestWire(spec), 'dev-sand-1', sandboxDeps())
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_KEY_LOCALITY')
  })

  test('receiver-table mismatch refused (E_REMOTE_KIND_REFUSED)', async () => {
    // free sandbox table has no `open-link` rule → the receiver refuses the kind.
    const spec: CriticalJobSpec<'open-link'> = {
      jobId: 'ol-1',
      kind: 'open-link',
      input: { url: 'https://example.com' },
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const out = await handleCriticalJobRequest(requestWire(spec), 'dev-sand-1', sandboxDeps())
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_KIND_REFUSED')
  })

  test('expired request refused', async () => {
    const wire = requestWire(depackageSpec(), { expires_at: new Date(Date.now() - 1000).toISOString() })
    const out = await handleCriticalJobRequest(wire, 'dev-sand-1', sandboxDeps())
    expect(out.type).toBe('critical_job_error')
    if (out.type === 'critical_job_error') expect(out.code).toBe('E_REMOTE_PROTOCOL')
  })
})
