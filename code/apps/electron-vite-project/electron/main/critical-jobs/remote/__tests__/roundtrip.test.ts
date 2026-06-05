/**
 * Phase 2 — mocked-transport round-trip per routable kind (spec 0017 §5.1) +
 * the no-topology regression (spec 0017 §3.3).
 *
 * A workstation dispatcher routes `depackage` / `depackage-email` to the
 * RemoteHandshakeExecutor; a loopback transport hands the wire to the REAL
 * receiver (sandbox context) which re-dispatches in-process and returns a signed
 * result; the sender verifies the signature and the workstation dispatcher's
 * verify.ts post-path projects it. Green proves the opaque-package channel
 * (artifact ciphertext Buffers) survives the wire byte-for-byte.
 */

import { describe, test, expect, vi } from 'vitest'
import { join } from 'path'
import { x25519 } from '@noble/curves/ed25519'

vi.mock('electron', () => ({
  app: { getPath: () => join(process.cwd(), 'tmp-ev-critjob'), getAppPath: () => process.cwd() },
}))

import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import { CriticalJobDispatcher } from '../../dispatcher'
import { DEFAULT_RESOLUTION_TABLE, type ResolutionContext } from '../../resolution'
import { InProcessExecutor } from '../../executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from '../../executors/remoteHandshakeExecutor'
import { buildReceiverDispatcher } from '../receiverDispatcher'
import { handleCriticalJobRequest, _resetReplayForTests } from '../receiver'
import type { CriticalJobTransport } from '../send'
import type { CriticalJobSpec } from '../../types'

function party(uid: string): PartyIdentity {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function record(): HandshakeRecord {
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
  } as unknown as HandshakeRecord
}

function pubKey(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

/** Loopback transport: hands the wire to the real sandbox receiver, in-process. */
function loopbackTransport(): CriticalJobTransport {
  const sandboxDeps = {
    getRecord: () => record(),
    dispatcher: buildReceiverDispatcher({ role: 'sandbox', tier: 'free', topology: { linked: [] } }),
  }
  return async ({ wire }) => {
    const outcome = await handleCriticalJobRequest(wire, wire.target_device_id, sandboxDeps)
    return { ok: true, body: outcome }
  }
}

function workstationDispatcher(topologyLinked: ResolutionContext['topology']['linked']): CriticalJobDispatcher {
  const ctx: ResolutionContext = { role: 'workstation', tier: 'free', topology: { linked: topologyLinked } }
  return new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor('workstation'),
      'remote-handshake': new RemoteHandshakeExecutor({
        topology: topologyLinked,
        getRecord: () => record(),
        thisDeviceId: () => 'dev-ws-1',
        transport: loopbackTransport(),
      }),
    },
    DEFAULT_RESOLUTION_TABLE,
    ctx,
  )
}

const LINKED = [{ role: 'sandbox' as const, handshakeId: 'hs-1', jobKinds: ['depackage' as const, 'depackage-email' as const] }]

const multipartCarrier = [
  'From: a@b.com',
  'To: c@d.com',
  'Subject: carrier',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="X"',
  '',
  '--X',
  'Content-Type: text/plain',
  '',
  'hello body text',
  '',
  '--X',
  'Content-Type: application/octet-stream',
  'Content-Disposition: attachment; filename="a.bin"',
  'Content-Transfer-Encoding: base64',
  '',
  'AAECAwQF',
  '',
  '--X--',
  '',
].join('\r\n')

describe('mocked-transport round-trip (workstation → sandbox)', () => {
  test('depackage: signed result returns and verifies green end-to-end', async () => {
    _resetReplayForTests()
    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'rt-depackage',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody text') },
      custodyPubKeyB64: pubKey(),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await workstationDispatcher(LINKED).dispatch(spec)
    expect(r.ok).toBe(true)
    expect(r.meta?.executorId).toBe('remote-handshake')
    if (r.ok) expect((r.output as { safeText: { body_text: string } }).safeText.body_text).toContain('body text')
  })

  test('depackage carrier fixture: opaque artifact ciphertext survives the wire (signature green)', async () => {
    _resetReplayForTests()
    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'rt-carrier',
      kind: 'depackage',
      input: { inputBytes: Buffer.from(multipartCarrier) },
      custodyPubKeyB64: pubKey(),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await workstationDispatcher(LINKED).dispatch(spec)
    // Green ⇒ the artifact ciphertext Buffers round-tripped byte-for-byte (else
    // the job-result signature, which commits to ciphertext digests, would fail).
    expect(r.ok).toBe(true)
    if (r.ok) {
      const out = r.output as { safeText: { attachment_refs: unknown[] }; artifacts: unknown[] }
      expect(out.artifacts.length).toBeGreaterThanOrEqual(1)
    }
  })

  test('depackage-email: result returns over the wire', async () => {
    _resetReplayForTests()
    const spec: CriticalJobSpec<'depackage-email'> = {
      jobId: 'rt-email',
      kind: 'depackage-email',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nplain body') },
      custodyPubKeyB64: pubKey(),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await workstationDispatcher(LINKED).dispatch(spec)
    expect(r.ok).toBe(true)
    expect(r.meta?.executorId).toBe('remote-handshake')
  })
})

describe('no-topology regression (spec §3.3)', () => {
  test('workstation depackage with empty topology fails closed with E_NO_EXECUTOR', async () => {
    _resetReplayForTests()
    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'rt-notopo',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody') },
      custodyPubKeyB64: pubKey(),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await workstationDispatcher([]).dispatch(spec)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error?.code).toBe('E_NO_EXECUTOR')
  })
})
