/**
 * Image/bundle consistency preflight (fail-fast, OFF-RIG).
 *
 * Proves the CrosvmProvider detects a STALE golden image at job-create time and
 * fails in MILLISECONDS with a typed `E_IMAGE_BUNDLE_MISMATCH` ("stale golden
 * image — rebuild required") — never booting a stale image into the 90s vsock
 * wall-clock. No /dev/kvm, no crosvm, no VM: `isAvailable()` is stubbed true so
 * the test runs everywhere, and the assertion is that we throw BEFORE any boot.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  CrosvmProvider,
  ImageBundleMismatchError,
  type CrosvmProviderConfig,
} from '../crosvmProvider'
import type { JobSpec } from '../hypervisorProvider'
import { MicroVMExecutor } from '../../critical-jobs/executors/microVmExecutor'
import { CriticalJobDispatcher } from '../../critical-jobs/dispatcher'
import { InProcessExecutor } from '../../critical-jobs/executors/inProcessExecutor'
import { DEFAULT_RESOLUTION_TABLE } from '../../critical-jobs/resolution'

const EXPECTED = 'a'.repeat(64) // sha256 the orchestrator expects
const STALE = 'b'.repeat(64) // what a stale image was stamped with

let tmp: string
let staleMarker: string
let matchMarker: string

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'crosvm-marker-'))
  staleMarker = path.join(tmp, 'stale.marker')
  matchMarker = path.join(tmp, 'match.marker')
  await writeFile(staleMarker, STALE + '\n', 'utf8')
  await writeFile(matchMarker, EXPECTED + '\n', 'utf8')
})
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function cfg(over: Partial<CrosvmProviderConfig>): CrosvmProviderConfig {
  return {
    crosvmBin: '/nonexistent/crosvm',
    goldenRootfsPath: '/nonexistent/golden.ext4',
    kernelPath: '/nonexistent/vmlinuz',
    overlayDir: tmp,
    vsockHostClientPath: '/nonexistent/vsock-host-client',
    ...over,
  }
}

const depackageSpec: JobSpec = {
  jobId: 'preflight-1',
  kind: 'depackage',
  inputBytes: Buffer.from('untrusted — must never be parsed in-process'),
  sandboxPeerX25519PubB64: 'AAAA',
}

describe('CrosvmProvider.preflightImageBundle', () => {
  it('throws E_IMAGE_BUNDLE_MISMATCH when the image marker differs (stale image)', async () => {
    const p = new CrosvmProvider(cfg({ expectedBundleSha256: EXPECTED, goldenImageMarkerPath: staleMarker }))
    await expect(p.preflightImageBundle()).rejects.toBeInstanceOf(ImageBundleMismatchError)
    await expect(p.preflightImageBundle()).rejects.toMatchObject({ code: 'E_IMAGE_BUNDLE_MISMATCH' })
    await expect(p.preflightImageBundle()).rejects.toThrow(/stale golden image — rebuild required/)
  })

  it('throws when the marker sidecar is missing (un-stamped / pre-marker image)', async () => {
    const p = new CrosvmProvider(
      cfg({ expectedBundleSha256: EXPECTED, goldenImageMarkerPath: path.join(tmp, 'does-not-exist.marker') }),
    )
    await expect(p.preflightImageBundle()).rejects.toBeInstanceOf(ImageBundleMismatchError)
  })

  it('resolves when the markers match', async () => {
    const p = new CrosvmProvider(cfg({ expectedBundleSha256: EXPECTED, goldenImageMarkerPath: matchMarker }))
    await expect(p.preflightImageBundle()).resolves.toBeUndefined()
  })

  it('is a no-op when the guard is unconfigured (back-compat)', async () => {
    const p = new CrosvmProvider(cfg({})) // no expectedBundleSha256
    await expect(p.preflightImageBundle()).resolves.toBeUndefined()
  })
})

describe('CrosvmProvider.runJob fails fast on a stale image (no boot, no 90s timeout)', () => {
  it('throws ImageBundleMismatchError in milliseconds — never reaches the VM', async () => {
    const p = new CrosvmProvider(cfg({ expectedBundleSha256: EXPECTED, goldenImageMarkerPath: staleMarker }))
    // Pretend the host is rig-capable so we get PAST availability into preflight;
    // the stale marker must then trip BEFORE any overlay/boot is attempted.
    vi.spyOn(p, 'isAvailable').mockResolvedValue(true)

    const t0 = Date.now()
    await expect(p.runJob(depackageSpec)).rejects.toBeInstanceOf(ImageBundleMismatchError)
    const elapsed = Date.now() - t0
    // Generously under any boot/vsock timeout — proves we never launched a VM.
    expect(elapsed).toBeLessThan(2_000)
  })
})

describe('dispatcher surfaces E_IMAGE_BUNDLE_MISMATCH (typed, fast, no fallback)', () => {
  it('paid-sandbox depackage-email → ok:false code=E_IMAGE_BUNDLE_MISMATCH via microVM', async () => {
    const provider = new CrosvmProvider(
      cfg({ expectedBundleSha256: EXPECTED, goldenImageMarkerPath: staleMarker }),
    )
    vi.spyOn(provider, 'isAvailable').mockResolvedValue(true)
    const dispatcher = new CriticalJobDispatcher(
      {
        'in-process': new InProcessExecutor('sandbox'),
        microvm: new MicroVMExecutor(provider),
      },
      DEFAULT_RESOLUTION_TABLE,
      { role: 'sandbox', tier: 'paid', topology: { linked: [] } },
    )

    const t0 = Date.now()
    const res = await dispatcher.dispatch({
      jobId: 'dispatch-mismatch-1',
      kind: 'depackage-email',
      input: { inputBytes: Buffer.from('Subject: x\r\n\r\nbody') },
      custodyPubKeyB64: 'AAAA',
      limits: { maxWallClockMs: 90_000 },
      flush: 'per-action',
    })
    const elapsed = Date.now() - t0

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error?.code).toBe('E_IMAGE_BUNDLE_MISMATCH')
    // The microVM executor owned the attempt — NOT an in-process parse of bytes.
    expect(res.meta?.executorId).toBe('microvm')
    // Fast: nowhere near the 90s wall-clock the spec would otherwise allow.
    expect(elapsed).toBeLessThan(2_000)
  })
})
