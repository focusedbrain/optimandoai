/**
 * Build C final leg — Part A rig proof (Prompt 5, 2026-06-10).
 *
 * Proves the full critical-job chain over a real direct-HTTP socket with the
 * receiver resolving to a real crosvm microVM:
 *
 *   workstation dispatcher
 *     → RemoteHandshakeExecutor
 *     → real httpCriticalJobTransport (fetch over localhost)
 *     → real HTTP server (p2pServer ingest branch)
 *     → tryHandleCriticalJobServiceP2P
 *     → receiver: sandbox/paid dispatcher + MicroVMExecutor
 *     → real crosvm microVM (overlay created and nuked per-action)
 *     → signed DepackageEmailJobResult travels back over the wire
 *     → sender-side signature + safe-text verification pass
 *
 * Configuration run: single box, two in-process dispatcher instances sharing a
 * real localhost HTTP socket.  (Two separate OS processes need the full two-box
 * cross-machine session — that dimension is the CROSS_MACHINE_RUNBOOK.)
 *
 * Auto-skips off-rig (non-Linux, missing /dev/kvm, /dev/vhost-vsock, crosvm
 * binary, golden image, or vsock client).
 *
 * INV-5: no plaintext email bodies logged; test fixture uses only public benign
 * content ("Build C rig test", no user data).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import http from 'http'
import { existsSync, accessSync, constants, readdirSync, readFileSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { x25519 } from '@noble/curves/ed25519'
import { fileURLToPath } from 'url'

import type { HandshakeRecord, PartyIdentity } from '../../../handshake/types'
import { CriticalJobDispatcher } from '../../dispatcher'
import { DEFAULT_RESOLUTION_TABLE, type ResolutionContext } from '../../resolution'
import { InProcessExecutor } from '../../executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from '../../executors/remoteHandshakeExecutor'
import { createCrosvmMicroVmExecutor } from '../../executors/microVmExecutor'
import type { CrosvmProviderConfig } from '../../../depackaging-microvm/crosvmProvider'
import { isCriticalJobServiceRpcShape } from '../wire'
import {
  tryHandleCriticalJobServiceP2P,
  _setCriticalJobReceiverDepsFactoryForTests,
} from '../criticalJobServiceDispatch'
import { buildReceiverDispatcher } from '../receiverDispatcher'
import { _resetReplayForTests } from '../receiver'
import { httpCriticalJobTransport } from '../send'
import type { CriticalJobSpec } from '../../types'

// ─── Rig availability ────────────────────────────────────────────────────────

const home = os.homedir()
const rig = path.join(home, 'build', 'rig')
const goldenRootfsPath = process.env.CROSVM_BIG ?? path.join(rig, 'golden-base.ext4')

const EXPECTED_BUNDLE_SHA256: string = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'depackaging-microvm', 'rig', 'dist', 'worker-bundle.provenance.json',
    ),
    'utf8',
  ),
).artifact_sha256

// Dedicated overlay dir so this file doesn't race the other microVM rig tests.
const cfg: CrosvmProviderConfig = {
  crosvmBin: process.env.CROSVM_BIN ?? path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
  goldenRootfsPath,
  kernelPath: process.env.CROSVM_KERNEL ?? path.join(rig, 'vmlinuz'),
  overlayDir: process.env.CROSVM_OVERLAY_DIR_BUILDC ?? path.join(rig, 'overlays-buildC'),
  vsockHostClientPath: process.env.CROSVM_VSOCK_CLIENT ?? path.join(rig, 'vsock-host-client'),
  expectedBundleSha256: EXPECTED_BUNDLE_SHA256,
  goldenImageMarkerPath: process.env.CROSVM_GOLDEN_MARKER ?? `${goldenRootfsPath}.marker`,
}

function rigAvailable(): boolean {
  if (process.platform !== 'linux') return false
  try {
    accessSync('/dev/kvm', constants.R_OK | constants.W_OK)
    accessSync('/dev/vhost-vsock', constants.R_OK | constants.W_OK)
    for (const p of [cfg.crosvmBin, cfg.goldenRootfsPath, cfg.kernelPath, cfg.vsockHostClientPath]) {
      if (!existsSync(p)) return false
    }
    return true
  } catch {
    return false
  }
}

const RIG = rigAvailable()
const VM_TIMEOUT = 90_000

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AUTH_TOKEN = 'buildC-rig-tok'

function party(uid: string): PartyIdentity {
  return { email: 'rig@test.dev', wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

/** Synthetic ACTIVE internal handshake record pointing at the rig server. */
function internalRecord(endpoint: string): HandshakeRecord {
  return {
    handshake_id: 'hs-buildC-rig',
    state: 'ACTIVE',
    initiator: party('rig-user'),
    acceptor: party('rig-user'),
    handshake_type: 'internal',
    internal_coordination_identity_complete: true,
    initiator_coordination_device_id: 'dev-workstation-rig',
    acceptor_coordination_device_id: 'dev-sandbox-rig',
    p2p_endpoint: endpoint,
    counterparty_p2p_token: AUTH_TOKEN,
  } as unknown as HandshakeRecord
}

function eml(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, '', body].join('\r\n'), 'utf8')
}

/** Minimal p2p-server ingest branch (same shape as production p2pServer.ts). */
function startRigServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let data = ''
      req.on('data', (c: string) => (data += c))
      req.on('end', async () => {
        try {
          const ct = req.headers['content-type'] ?? ''
          if (!ct.includes('application/json')) { res.writeHead(415); res.end(); return }
          const auth = (req.headers.authorization ?? '') as string
          const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
          if (token !== AUTH_TOKEN) { res.writeHead(401); res.end(); return }
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
      resolve({ server, url: `http://127.0.0.1:${(addr as { port: number }).port}/beap/ingest` })
    })
    server.on('error', reject)
  })
}

// ─── Build C final-leg rig test ───────────────────────────────────────────────

describe.skipIf(!RIG)(
  'Build C final leg — depackage-email over real HTTP → MicroVMExecutor (Part A rig, on-rig)',
  () => {
    let ctx: { server: http.Server; url: string } | null = null

    beforeEach(async () => {
      _resetReplayForTests()
      ctx = await startRigServer()
      // Receiver: sandbox/paid → depackage-email routes to microvm (DEFAULT_RESOLUTION_TABLE).
      // Injects a MicroVMExecutor that uses the real crosvm rig.
      _setCriticalJobReceiverDepsFactoryForTests(() => ({
        getRecord: () => internalRecord(ctx!.url),
        dispatcher: new CriticalJobDispatcher(
          {
            'in-process': new InProcessExecutor('sandbox'),
            microvm: createCrosvmMicroVmExecutor(cfg),
          },
          DEFAULT_RESOLUTION_TABLE,
          { role: 'sandbox', tier: 'paid', topology: { linked: [] } } satisfies ResolutionContext,
        ),
      }))
    })

    afterEach(async () => {
      _setCriticalJobReceiverDepsFactoryForTests(null)
      if (ctx?.server) await new Promise<void>((r) => ctx!.server.close(() => r()))
      ctx = null
    })

    test(
      'plain mail: workstation→RemoteHandshake→HTTP→microVM; signed result verified; overlay nuked',
      async () => {
        const sandbox = { priv: x25519.utils.randomPrivateKey() }
        const custodyPubKeyB64 = Buffer.from(x25519.getPublicKey(sandbox.priv)).toString('base64')

        const linked = [{
          role: 'sandbox' as const,
          handshakeId: 'hs-buildC-rig',
          jobKinds: ['depackage-email' as const],
        }]
        const rctx: ResolutionContext = { role: 'workstation', tier: 'free', topology: { linked } }
        const workstation = new CriticalJobDispatcher(
          {
            'in-process': new InProcessExecutor('workstation'),
            'remote-handshake': new RemoteHandshakeExecutor({
              topology: linked,
              getRecord: () => internalRecord(ctx!.url),
              thisDeviceId: () => 'dev-workstation-rig',
              transport: httpCriticalJobTransport,
            }),
          },
          DEFAULT_RESOLUTION_TABLE,
          rctx,
        )

        const spec: CriticalJobSpec<'depackage-email'> = {
          jobId: 'buildC-rig-plain-1',
          kind: 'depackage-email',
          input: { inputBytes: eml(
            ['Subject: Build C rig test', 'Content-Type: text/plain'],
            'Build C final leg: workstation sends, sandbox microVM depackages.',
          ) },
          custodyPubKeyB64,
          limits: { maxWallClockMs: VM_TIMEOUT },
          flush: 'per-action',
        }

        const t0 = Date.now()
        const res = await workstation.dispatch(spec)
        const elapsed = Date.now() - t0
        console.log(`[PART_A_RIG] buildC plain mail: total RTT=${elapsed}ms executor=${res.meta?.executorId} flushed=${res.meta?.flushed}`)

        // ── Central proofs ────────────────────────────────────────────────────
        // ok=true implies the workstation dispatcher's verify.ts post-path ran:
        //   (a) sender-side signature valid (depackageResultSignatureValid /
        //       verifyDepackageEmailResult)
        //   (b) safe-text re-validated against closed schema (validateSafeText)
        expect(res.ok).toBe(true)
        // Remote-channel proof: workstation used RemoteHandshakeExecutor.
        // `executorId` is always stamped by the LOCAL dispatcher (remote-handshake
        // on workstation; microvm on the sandbox receiver — logged above).
        expect(res.meta?.executorId).toBe('remote-handshake')
        // MicroVM-execution proof: `flushed` is threaded from the receiver's
        // inner result (dispatcher.ts:131 `result.meta?.flushed`). Only
        // MicroVMExecutor sets flushed='per-action'; InProcessExecutor always
        // returns 'none'. Per-action here proves the receiver ran the microVM.
        expect(res.meta?.flushed).toBe('per-action')

        // Signed result shape
        if (!res.ok) return
        expect(res.output.ok).toBe(true)
        if (!res.output.ok) return
        expect(res.output.type).toBe('plain')
        if (res.output.type !== 'plain') return
        expect(res.output.safeText.schema).toBe('safe-text/v1')
        expect(res.output.safeText.subject).toContain('Build C rig test')
        expect(res.output.safeText.body_text).toContain('workstation sends')

        // Overlay nuked per-action (no file left behind in the dedicated dir).
        const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
        expect(leftover).toEqual([])
      },
      VM_TIMEOUT,
    )

    test(
      'carrier mail: opaque package round-trips byte-exact through HTTP + microVM',
      async () => {
        const custodyPubKeyB64 = Buffer.from(
          x25519.getPublicKey(x25519.utils.randomPrivateKey()),
        ).toString('base64')

        const QBEAP_PKG = JSON.stringify({
          header: { encoding: 'qBEAP', handshake_id: 'hs-buildC-carrier' },
          metadata: { created_at: '2026-06-10T00:00:00Z' },
          envelope: { kem_ct: 'AAAA' },
        })

        const linked = [{
          role: 'sandbox' as const,
          handshakeId: 'hs-buildC-rig',
          jobKinds: ['depackage-email' as const],
        }]
        const workstation = new CriticalJobDispatcher(
          {
            'in-process': new InProcessExecutor('workstation'),
            'remote-handshake': new RemoteHandshakeExecutor({
              topology: linked,
              getRecord: () => internalRecord(ctx!.url),
              thisDeviceId: () => 'dev-workstation-rig',
              transport: httpCriticalJobTransport,
            }),
          },
          DEFAULT_RESOLUTION_TABLE,
          { role: 'workstation', tier: 'free', topology: { linked } } satisfies ResolutionContext,
        )

        const spec: CriticalJobSpec<'depackage-email'> = {
          jobId: 'buildC-rig-carrier-1',
          kind: 'depackage-email',
          input: { inputBytes: eml(
            ['Subject: carrier', 'Content-Type: text/plain'],
            QBEAP_PKG,
          ) },
          custodyPubKeyB64,
          limits: { maxWallClockMs: VM_TIMEOUT },
          flush: 'per-action',
        }

        const res = await workstation.dispatch(spec)
        console.log(`[PART_A_RIG] buildC carrier: executor=${res.meta?.executorId} flushed=${res.meta?.flushed}`)

        expect(res.ok).toBe(true)
        expect(res.meta?.executorId).toBe('remote-handshake')
        // per-action flushed proves receiver ran microVM (not in-process).
        expect(res.meta?.flushed).toBe('per-action')
        if (!res.ok || !res.output.ok) return
        expect(res.output.type).toBe('beap-carrier')
        if (res.output.type !== 'beap-carrier') return
        // Opaque package bytes unchanged by the orchestrator (carrier proof).
        expect(Buffer.from(res.output.packages[0].bytesB64, 'base64').toString('utf8')).toBe(QBEAP_PKG)

        const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
        expect(leftover).toEqual([])
      },
      VM_TIMEOUT,
    )

    test(
      'wrong Bearer token → E_REMOTE_PROTOCOL/link error (auth gate on the direct channel)',
      async () => {
        const custodyPubKeyB64 = Buffer.from(
          x25519.getPublicKey(x25519.utils.randomPrivateKey()),
        ).toString('base64')
        const linked = [{
          role: 'sandbox' as const,
          handshakeId: 'hs-buildC-rig',
          jobKinds: ['depackage-email' as const],
        }]
        const workstation = new CriticalJobDispatcher(
          {
            'in-process': new InProcessExecutor('workstation'),
            'remote-handshake': new RemoteHandshakeExecutor({
              topology: linked,
              getRecord: () => ({
                ...internalRecord(ctx!.url),
                counterparty_p2p_token: 'WRONG-TOKEN',
              } as HandshakeRecord),
              thisDeviceId: () => 'dev-workstation-rig',
              transport: httpCriticalJobTransport,
            }),
          },
          DEFAULT_RESOLUTION_TABLE,
          { role: 'workstation', tier: 'free', topology: { linked } } satisfies ResolutionContext,
        )
        const res = await workstation.dispatch({
          jobId: 'buildC-rig-auth-1',
          kind: 'depackage-email',
          input: { inputBytes: Buffer.from('Subject: x\r\n\r\nbody') },
          custodyPubKeyB64,
          limits: { maxWallClockMs: 10_000 },
          flush: 'per-action',
        })
        expect(res.ok).toBe(false)
        if (!res.ok) expect(['E_REMOTE_PROTOCOL', 'E_REMOTE_LINK_DOWN']).toContain(res.error?.code)
      },
      30_000,
    )
  },
)
