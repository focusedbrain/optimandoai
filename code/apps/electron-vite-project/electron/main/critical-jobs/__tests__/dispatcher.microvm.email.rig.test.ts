/**
 * ON-RIG (Build B1, exit criterion 3): a LIVE `depackage-email` job dispatched
 * through `CriticalJobDispatcher.dispatch()` completes end-to-end via the real
 * crosvm microVM, passes the dispatcher's central signature + safe-text
 * verification, returns the typed `plain | beap-carrier` union, and leaves no
 * overlay behind. Plus the fail-closed proof: when the microVM backend is
 * unavailable, paid-sandbox routing fails closed (E_NO_EXECUTOR) — the
 * orchestrator NEVER parses the untrusted bytes in-process (INV-1 / INV-7).
 *
 * SKIPS automatically off-rig (non-Linux or missing /dev/kvm, /dev/vhost-vsock,
 * crosvm binary, golden image, or vsock client). Paths overridable via the same
 * env vars as crosvmProvider.rig.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { existsSync, accessSync, constants, readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import * as os from 'os'
import * as path from 'path'
import { x25519 } from '@noble/curves/ed25519'
import type { CrosvmProviderConfig } from '../../depackaging-microvm/crosvmProvider'
import { createCrosvmMicroVmExecutor } from '../executors/microVmExecutor'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from '../executors/remoteHandshakeExecutor'
import { CriticalJobDispatcher } from '../dispatcher'
import { DEFAULT_RESOLUTION_TABLE } from '../resolution'

const home = os.homedir()
const rig = path.join(home, 'build', 'rig')

// The sha256 of the worker bundle this checkout ships — i.e. what the golden
// image MUST have baked. Read from the committed provenance so the happy-path
// tests below exercise the real image/bundle consistency guard (markers match),
// and the mismatch test can prove a stale image fails fast.
const goldenRootfsPath = process.env.CROSVM_GOLDEN ?? path.join(rig, 'golden-base.ext4')
const EXPECTED_BUNDLE_SHA256: string = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'depackaging-microvm',
      'rig',
      'dist',
      'worker-bundle.provenance.json',
    ),
    'utf8',
  ),
).artifact_sha256

const cfg: CrosvmProviderConfig = {
  crosvmBin: process.env.CROSVM_BIN ?? path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
  goldenRootfsPath,
  kernelPath: process.env.CROSVM_KERNEL ?? path.join(rig, 'vmlinuz'),
  // DEDICATED overlay dir: vitest runs test files in parallel workers, and the
  // overlay-nuke assertion reads the whole dir — a shared dir would race the B1
  // depackage rig test. The provider mkdir's this recursively.
  overlayDir: process.env.CROSVM_OVERLAY_DIR_EMAIL ?? path.join(rig, 'overlays-email'),
  vsockHostClientPath: process.env.CROSVM_VSOCK_CLIENT ?? path.join(rig, 'vsock-host-client'),
  // Image/bundle consistency guard active on the real path: the rebuilt golden
  // image is stamped with this same sha, so the happy-path runs below prove the
  // guard passes valid images; the mismatch test below proves it fails fast.
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

function makeSandboxKeys() {
  const priv = x25519.utils.randomPrivateKey()
  return {
    privB64: Buffer.from(priv).toString('base64'),
    pubB64: Buffer.from(x25519.getPublicKey(priv)).toString('base64'),
  }
}

function eml(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, '', body].join('\r\n'), 'utf8')
}

const QBEAP_PKG = JSON.stringify({
  header: { encoding: 'qBEAP', handshake_id: 'hs-rig-1' },
  metadata: { created_at: '2026-01-01T00:00:00Z' },
  envelope: { kem_ct: 'AAAA' },
})

describe.skipIf(!RIG)('Build B1 — depackage-email through dispatcher → microVM (vsock, on-rig)', () => {
  // Paid sandbox routes depackage-email to microVM with NO fallback (fail-closed).
  const dispatcher = new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor('sandbox'),
      microvm: createCrosvmMicroVmExecutor(cfg),
      'remote-handshake': new RemoteHandshakeExecutor(),
    },
    DEFAULT_RESOLUTION_TABLE,
    { role: 'sandbox', tier: 'paid', topology: { linked: [] } },
  )

  test(
    'plain mail: runs in microVM, centrally verified, typed plain union, overlay nuked',
    async () => {
      const sandbox = makeSandboxKeys()
      const t0 = Date.now()
      const res = await dispatcher.dispatch({
        jobId: 'rig-email-plain-1',
        kind: 'depackage-email',
        input: { inputBytes: eml(['Subject: live plain', 'Content-Type: text/plain'], 'public live body') },
        custodyPubKeyB64: sandbox.pubB64,
        limits: { maxWallClockMs: VM_TIMEOUT },
        flush: 'per-action',
      })
      console.log(`[perf] dispatcher→microVM depackage-email(plain) create→run→verify→nuke = ${Date.now() - t0} ms`)

      // ok implies BOTH central checks passed (signature + safe-text re-validation).
      expect(res.ok).toBe(true)
      // INLINE-PARSE GUARD: the verdict came from the microVM executor — the only
      // venue that parsed the untrusted bytes — NOT from any in-process fallback.
      expect(res.meta?.executorId).toBe('microvm')
      expect(res.meta?.flushed).toBe('per-action')

      const out = res.output!
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.type).toBe('plain')
      if (out.type !== 'plain') return
      expect(out.safeText.schema).toBe('safe-text/v1')
      expect(out.safeText.body_text).toContain('public live body')

      const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover).toEqual([])
    },
    VM_TIMEOUT,
  )

  test(
    'carrier mail: typed beap-carrier union with opaque package, overlay nuked',
    async () => {
      const sandbox = makeSandboxKeys()
      const res = await dispatcher.dispatch({
        jobId: 'rig-email-carrier-1',
        kind: 'depackage-email',
        input: { inputBytes: eml(['Subject: carrier', 'Content-Type: text/plain'], QBEAP_PKG) },
        custodyPubKeyB64: sandbox.pubB64,
        limits: { maxWallClockMs: VM_TIMEOUT },
        flush: 'per-action',
      })

      expect(res.ok).toBe(true)
      expect(res.meta?.executorId).toBe('microvm')
      const out = res.output!
      expect(out.ok).toBe(true)
      if (!out.ok || out.type !== 'beap-carrier') return
      expect(out.packages.length).toBe(1)
      // The opaque carrier bytes round-trip exactly (the orchestrator never parsed them).
      expect(Buffer.from(out.packages[0].bytesB64, 'base64').toString('utf8')).toBe(QBEAP_PKG)

      const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover).toEqual([])
    },
    VM_TIMEOUT,
  )

  test(
    'stale golden image (marker mismatch) → fast E_IMAGE_BUNDLE_MISMATCH, never a 90s boot/timeout',
    async () => {
      // Same REAL, available rig backend — only the EXPECTED bundle sha is wrong,
      // simulating an orchestrator newer than the on-disk golden image. The
      // provider must trip its cheap preflight BEFORE booting.
      const staleDispatcher = new CriticalJobDispatcher(
        {
          'in-process': new InProcessExecutor('sandbox'),
          microvm: createCrosvmMicroVmExecutor({ ...cfg, expectedBundleSha256: 'f'.repeat(64) }),
          'remote-handshake': new RemoteHandshakeExecutor(),
        },
        DEFAULT_RESOLUTION_TABLE,
        { role: 'sandbox', tier: 'paid', topology: { linked: [] } },
      )
      const sandbox = makeSandboxKeys()
      const t0 = Date.now()
      const res = await staleDispatcher.dispatch({
        jobId: 'rig-email-stale-image-1',
        kind: 'depackage-email',
        input: { inputBytes: eml(['Subject: x', 'Content-Type: text/plain'], 'never parsed') },
        custodyPubKeyB64: sandbox.pubB64,
        limits: { maxWallClockMs: VM_TIMEOUT },
        flush: 'per-action',
      })
      const elapsed = Date.now() - t0
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error?.code).toBe('E_IMAGE_BUNDLE_MISMATCH')
      expect(res.meta?.executorId).toBe('microvm')
      // Fast: the preflight read a sidecar, it never booted a VM. Way under VM_TIMEOUT.
      expect(elapsed).toBeLessThan(5_000)
      // And it left no overlay behind (it never created one).
      const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover).toEqual([])
    },
    VM_TIMEOUT,
  )
})

// This block runs ALWAYS (even off-rig): a microVM backend pointed at a
// nonexistent binary is unavailable, so paid-sandbox depackage-email MUST fail
// closed — never silently degrade to an in-process parse of untrusted bytes.
describe('Build B1 — depackage-email fails closed when the microVM is unavailable', () => {
  const deadCfg: CrosvmProviderConfig = {
    ...cfg,
    crosvmBin: '/nonexistent/crosvm-binary-for-failclosed-proof',
    goldenRootfsPath: '/nonexistent/golden.ext4',
    kernelPath: '/nonexistent/vmlinuz',
    vsockHostClientPath: '/nonexistent/vsock-host-client',
  }
  const dispatcher = new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor('sandbox'),
      microvm: createCrosvmMicroVmExecutor(deadCfg),
      'remote-handshake': new RemoteHandshakeExecutor(),
    },
    DEFAULT_RESOLUTION_TABLE,
    { role: 'sandbox', tier: 'paid', topology: { linked: [] } },
  )

  test('unavailable microVM → E_NO_EXECUTOR, never an in-process fallback', async () => {
    const sandbox = makeSandboxKeys()
    const res = await dispatcher.dispatch({
      jobId: 'rig-email-failclosed-1',
      kind: 'depackage-email',
      input: { inputBytes: eml(['Subject: x', 'Content-Type: text/plain'], 'should never be parsed in-process') },
      custodyPubKeyB64: sandbox.pubB64,
      limits: { maxWallClockMs: 10_000 },
      flush: 'per-action',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    // No fallback declared for sandbox/paid depackage-email → fail closed.
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
    // The chosen executor was never in-process (untrusted bytes never parsed here).
    expect(res.meta?.executorId).not.toBe('in-process')
  })
})
