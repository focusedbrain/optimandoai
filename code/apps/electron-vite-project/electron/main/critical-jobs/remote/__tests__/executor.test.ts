/**
 * Phase 2 — RemoteHandshakeExecutor (spec 0017 §3.2, §4).
 * Unit behaviors with a canned/mock transport.
 */

import { describe, test, expect, vi } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), 'tmp-ev-critjob'), getAppPath: () => process.cwd() },
}))

import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import { RemoteHandshakeExecutor } from '../../executors/remoteHandshakeExecutor'
import { CRITICAL_JOB_SCHEMA_VERSION, type CriticalJobRequestWire } from '../wire'
import type { CriticalJobTransport } from '../send'
import type { CriticalJobSpec, CriticalJobResult } from '../../types'
import type { LinkedTopologyEntry } from '../../topology'
import { runDepackagingJob } from '../../../depackaging-microvm/depackagingWorker'
import { depackageJobResultToCriticalResult } from '../../verify'

function party(uid: string): PartyIdentity {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function record(over: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-1',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
    handshake_type: 'internal',
    internal_coordination_identity_complete: true,
    initiator_coordination_device_id: 'dev-ws-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    p2p_endpoint: 'http://10.0.0.2:51249/beap/ingest',
    counterparty_p2p_token: 'tok',
    ...over,
  } as unknown as HandshakeRecord
}

const linked: LinkedTopologyEntry[] = [
  { role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['depackage', 'depackage-email'] },
]

function spec(): CriticalJobSpec<'depackage'> {
  return {
    jobId: 'job-1',
    kind: 'depackage',
    input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody') },
    limits: { maxWallClockMs: 30_000 },
    flush: 'per-action',
  }
}

/** A transport that returns a canned result wire echoing the request_id. */
function resultTransport(result: CriticalJobResult): CriticalJobTransport {
  return async ({ wire }: { wire: CriticalJobRequestWire }) => ({
    ok: true,
    body: {
      type: 'critical_job_result',
      schema_version: CRITICAL_JOB_SCHEMA_VERSION,
      request_id: wire.request_id,
      handshake_id: wire.handshake_id,
      sender_device_id: 'dev-sand-1',
      target_device_id: wire.sender_device_id,
      created_at: new Date().toISOString(),
      result: result as unknown,
    },
  })
}

function exec(transport: CriticalJobTransport, topology = linked) {
  return new RemoteHandshakeExecutor({
    topology,
    getRecord: () => record(),
    thisDeviceId: () => 'dev-ws-1',
    transport,
  })
}

describe('RemoteHandshakeExecutor — supports / isAvailable', () => {
  test('supports all kinds except consumer-local decrypt-qbeap', () => {
    const e = exec(resultTransport({ jobId: 'x', ok: true }))
    expect(e.supports('depackage')).toBe(true)
    expect(e.supports('view-attachment')).toBe(true)
    expect(e.supports('decrypt-qbeap')).toBe(false)
  })

  test('isAvailable false with empty topology (workstation rows fail closed)', async () => {
    const e = exec(resultTransport({ jobId: 'x', ok: true }), [])
    expect(await e.isAvailable()).toBe(false)
  })

  test('isAvailable true with an ACTIVE linked handshake + endpoint', async () => {
    const e = exec(resultTransport({ jobId: 'x', ok: true }))
    expect(await e.isAvailable()).toBe(true)
  })

  test('isAvailable false when the linked handshake is not ACTIVE', async () => {
    const e = new RemoteHandshakeExecutor({
      topology: linked,
      getRecord: () => record({ state: 'REVOKED' as never }),
      thisDeviceId: () => 'dev-ws-1',
      transport: resultTransport({ jobId: 'x', ok: true }),
    })
    expect(await e.isAvailable()).toBe(false)
  })
})

describe('RemoteHandshakeExecutor — run', () => {
  test('returns the remote result and sends a well-formed request (depackage-email: no sender sig gate)', async () => {
    let captured: CriticalJobRequestWire | null = null
    const transport: CriticalJobTransport = async (args) => {
      captured = args.wire
      return resultTransport({ jobId: 'job-e', ok: true, output: { kind: 'plain' } as never })(args)
    }
    const emailSpec: CriticalJobSpec<'depackage-email'> = {
      jobId: 'job-e',
      kind: 'depackage-email',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody') },
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await exec(transport).run(emailSpec)
    expect(r.ok).toBe(true)
    expect(captured!.type).toBe('critical_job_request')
    expect(captured!.handshake_id).toBe('hs-1')
    expect(captured!.sender_device_id).toBe('dev-ws-1')
    expect(captured!.target_device_id).toBe('dev-sand-1')
    // INV-2: serialized spec carries inputBytes as a $buf, never key material.
    expect(JSON.stringify(captured!.job)).toContain('$buf')
  })

  test('no linked entry for the kind → E_NO_EXECUTOR', async () => {
    const e = exec(resultTransport({ jobId: 'x', ok: true }), [
      { role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['validate-native-beap'] },
    ])
    await expect(e.run(spec())).rejects.toMatchObject({ code: 'E_NO_EXECUTOR' })
  })

  test('inactive linked handshake → E_REMOTE_HANDSHAKE_INACTIVE', async () => {
    const e = new RemoteHandshakeExecutor({
      topology: linked,
      getRecord: () => record({ state: 'REVOKED' as never }),
      thisDeviceId: () => 'dev-ws-1',
      transport: resultTransport({ jobId: 'x', ok: true }),
    })
    await expect(e.run(spec())).rejects.toMatchObject({ code: 'E_REMOTE_HANDSHAKE_INACTIVE' })
  })

  test('receiver typed refusal is surfaced (E_REMOTE_KIND_REFUSED)', async () => {
    const transport: CriticalJobTransport = async ({ wire }) => ({
      ok: true,
      body: {
        type: 'critical_job_error',
        schema_version: CRITICAL_JOB_SCHEMA_VERSION,
        request_id: wire.request_id,
        handshake_id: wire.handshake_id,
        sender_device_id: 'dev-sand-1',
        target_device_id: wire.sender_device_id,
        created_at: new Date().toISOString(),
        code: 'E_REMOTE_KIND_REFUSED',
        message: 'receiver table does not permit kind',
      },
    })
    await expect(exec(transport).run(spec())).rejects.toMatchObject({ code: 'E_REMOTE_KIND_REFUSED' })
  })

  test('link-down → E_REMOTE_LINK_DOWN', async () => {
    const transport: CriticalJobTransport = async () => ({ ok: false, code: 'E_REMOTE_LINK_DOWN', message: 'timeout' })
    await expect(exec(transport).run(spec())).rejects.toMatchObject({ code: 'E_REMOTE_LINK_DOWN' })
  })

  test('bad depackage signature rejected by the sender (E_SIGNATURE_INVALID)', async () => {
    // Genuinely-signed result, then tampered after signing → signature mismatch.
    const genuine = depackageJobResultToCriticalResult(
      runDepackagingJob({
        jobId: 'job-1',
        kind: 'depackage',
        inputBytes: Buffer.from('Subject: hi\r\n\r\nbody text'),
        sandboxPeerX25519PubB64: Buffer.alloc(32, 7).toString('base64'),
      }),
    )
    const tampered: CriticalJobResult = {
      ...genuine,
      output: { ...genuine.output!, safeText: { ...genuine.output!.safeText, body_text: 'MUTATED' } },
    }
    await expect(exec(resultTransport(tampered)).run(spec())).rejects.toMatchObject({ code: 'E_SIGNATURE_INVALID' })
  })

  test('missing-signature depackage result rejected by the sender (E_SIGNATURE_INVALID)', async () => {
    const transport = resultTransport({ jobId: 'job-1', ok: true, output: { safeText: {}, artifacts: [] } as never })
    await expect(exec(transport).run(spec())).rejects.toMatchObject({ code: 'E_SIGNATURE_INVALID' })
  })

  test('response request_id mismatch → E_REMOTE_PROTOCOL', async () => {
    const transport: CriticalJobTransport = async ({ wire }) => ({
      ok: true,
      body: {
        type: 'critical_job_result',
        schema_version: CRITICAL_JOB_SCHEMA_VERSION,
        request_id: 'WRONG',
        handshake_id: wire.handshake_id,
        sender_device_id: 'dev-sand-1',
        target_device_id: wire.sender_device_id,
        created_at: new Date().toISOString(),
        result: { jobId: 'job-1', ok: true },
      },
    })
    await expect(exec(transport).run(spec())).rejects.toMatchObject({ code: 'E_REMOTE_PROTOCOL' })
  })
})
