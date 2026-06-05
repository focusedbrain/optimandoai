/**
 * §5.2 — loopback round-trip over a REAL HTTP socket (one box).
 *
 * A localhost HTTP server replicates the ingest branch the production server runs
 * for a critical job (Content-Type gate + Bearer auth against the handshake token
 * + `isCriticalJobServiceRpcShape` → `tryHandleCriticalJobServiceP2P`) and the
 * sender drives it with the REAL `httpCriticalJobTransport` (fetch). This proves
 * the direct critical-job channel end-to-end over a real socket: real transport →
 * real ingest dispatch → real receiver → real depackage worker + Ed25519 signing →
 * real Buffer-aware serialization across the wire → real sender-side signature
 * verification → dispatcher verify.ts post-path.
 *
 * SCOPE / boundary (recorded in 0018): this is a single-process, real-socket
 * loopback of the DIRECT channel. The literal "two orchestrator PROCESSES with a
 * live coordination-relay handshake" is NOT hosted by the existing unit harness
 * (createP2PServer is one in-process server; there is no two-process + relay
 * pairing harness) — hand-rolling that would be the flaky harness spec §5.2 warns
 * against, so it is deferred to the real-hardware W-series (§7).
 */

import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest'
import http from 'http'
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
import { isCriticalJobServiceRpcShape } from '../wire'
import {
  tryHandleCriticalJobServiceP2P,
  _setCriticalJobReceiverDepsFactoryForTests,
} from '../criticalJobServiceDispatch'
import { buildReceiverDispatcher } from '../receiverDispatcher'
import { _resetReplayForTests } from '../receiver'
import { httpCriticalJobTransport } from '../send'
import type { CriticalJobSpec } from '../../types'

const AUTH_TOKEN = 'loopback-tok'

function party(uid: string): PartyIdentity {
  return { email: 'a@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

function internalRecord(endpoint: string): HandshakeRecord {
  return {
    handshake_id: 'hs-loop',
    state: 'ACTIVE',
    initiator: party('u1'),
    acceptor: party('u1'),
    handshake_type: 'internal',
    internal_coordination_identity_complete: true,
    initiator_coordination_device_id: 'dev-ws-1',
    acceptor_coordination_device_id: 'dev-sand-1',
    p2p_endpoint: endpoint,
    counterparty_p2p_token: AUTH_TOKEN,
  } as unknown as HandshakeRecord
}

function startServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', async () => {
        try {
          if (req.headers['content-type'] !== 'application/json') {
            res.writeHead(415); res.end(); return
          }
          const auth = (req.headers.authorization ?? '') as string
          const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
          if (token !== AUTH_TOKEN) {
            res.writeHead(401); res.end(); return
          }
          const parsed = JSON.parse(data)
          if (isCriticalJobServiceRpcShape(parsed)) {
            await tryHandleCriticalJobServiceP2P({}, parsed, res)
            return
          }
          res.writeHead(404); res.end()
        } catch {
          res.writeHead(400); res.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') return reject(new Error('no addr'))
      resolve({ server, url: `http://127.0.0.1:${addr.port}/beap/ingest` })
    })
    server.on('error', reject)
  })
}

describe('§5.2 real-socket loopback round-trip', () => {
  let ctx: { server: http.Server; url: string } | null = null

  beforeEach(async () => {
    _resetReplayForTests()
    ctx = await startServer()
    // Receiver runs as a free sandbox; getRecord returns the synthetic internal
    // record (the gate logic itself is unit-tested in receiver.test.ts).
    _setCriticalJobReceiverDepsFactoryForTests(() => ({
      getRecord: () => internalRecord(ctx!.url),
      dispatcher: buildReceiverDispatcher({ role: 'sandbox', tier: 'free', topology: { linked: [] } }),
    }))
  })

  afterEach(async () => {
    _setCriticalJobReceiverDepsFactoryForTests(null)
    if (ctx?.server) await new Promise<void>((r) => ctx!.server.close(() => r()))
    ctx = null
  })

  test('depackage end-to-end over a real socket verifies green', async () => {
    const linked = [{ role: 'sandbox' as const, handshakeId: 'hs-loop', jobKinds: ['depackage' as const] }]
    const rctx: ResolutionContext = { role: 'workstation', tier: 'free', topology: { linked } }
    const dispatcher = new CriticalJobDispatcher(
      {
        'in-process': new InProcessExecutor('workstation'),
        'remote-handshake': new RemoteHandshakeExecutor({
          topology: linked,
          getRecord: () => internalRecord(ctx!.url),
          thisDeviceId: () => 'dev-ws-1',
          transport: httpCriticalJobTransport, // REAL fetch over the socket
        }),
      },
      DEFAULT_RESOLUTION_TABLE,
      rctx,
    )

    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'loop-depackage',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody text over the wire') },
      custodyPubKeyB64: Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64'),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await dispatcher.dispatch(spec)
    expect(r.ok).toBe(true)
    expect(r.meta?.executorId).toBe('remote-handshake')
    if (r.ok) expect((r.output as { safeText: { body_text: string } }).safeText.body_text).toContain('over the wire')
  })

  test('wrong Bearer token is rejected (real-socket auth) → E_REMOTE_PROTOCOL/link error', async () => {
    const linked = [{ role: 'sandbox' as const, handshakeId: 'hs-loop', jobKinds: ['depackage' as const] }]
    const rctx: ResolutionContext = { role: 'workstation', tier: 'free', topology: { linked } }
    const dispatcher = new CriticalJobDispatcher(
      {
        'in-process': new InProcessExecutor('workstation'),
        'remote-handshake': new RemoteHandshakeExecutor({
          topology: linked,
          // Record presents the WRONG token → server returns 401 (no body).
          getRecord: () => ({ ...internalRecord(ctx!.url), counterparty_p2p_token: 'WRONG' }) as HandshakeRecord,
          thisDeviceId: () => 'dev-ws-1',
          transport: httpCriticalJobTransport,
        }),
      },
      DEFAULT_RESOLUTION_TABLE,
      rctx,
    )
    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'loop-auth',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: x\r\n\r\nbody') },
      custodyPubKeyB64: Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64'),
      limits: { maxWallClockMs: 30_000 },
      flush: 'per-action',
    }
    const r = await dispatcher.dispatch(spec)
    expect(r.ok).toBe(false)
    // 401 has an empty body → the sender surfaces a typed remote error (no insert).
    if (!r.ok) expect(['E_REMOTE_PROTOCOL', 'E_REMOTE_LINK_DOWN']).toContain(r.error?.code)
  })
})
