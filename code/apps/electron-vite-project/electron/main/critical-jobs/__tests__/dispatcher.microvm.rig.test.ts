/**
 * ON-RIG: a depackage job dispatched through `CriticalJobDispatcher.dispatch()`
 * (NOT through the provider directly) completes end-to-end via the real crosvm
 * microVM, passes the dispatcher's central signature + safe-text verification,
 * and leaves no overlay behind (per-action flush confirmed).
 *
 * SKIPS automatically off-rig (non-Linux or missing /dev/kvm, /dev/vhost-vsock,
 * crosvm binary, golden image, or vsock client). Paths overridable via the same
 * env vars as crosvmProvider.rig.test.ts.
 */

import { describe, test, expect } from 'vitest'
import { existsSync, accessSync, constants, readdirSync } from 'fs'
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

const cfg: CrosvmProviderConfig = {
  crosvmBin: process.env.CROSVM_BIN ?? path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
  goldenRootfsPath: process.env.CROSVM_GOLDEN ?? path.join(rig, 'golden-base.ext4'),
  kernelPath: process.env.CROSVM_KERNEL ?? path.join(rig, 'vmlinuz'),
  overlayDir: process.env.CROSVM_OVERLAY_DIR ?? path.join(rig, 'overlays'),
  vsockHostClientPath: process.env.CROSVM_VSOCK_CLIENT ?? path.join(rig, 'vsock-host-client'),
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
  return { privB64: Buffer.from(priv).toString('base64'), pubB64: Buffer.from(x25519.getPublicKey(priv)).toString('base64') }
}

describe.skipIf(!RIG)('Build A — depackage through dispatcher → microVM (vsock, on-rig)', () => {
  // Paid sandbox routes depackage to microVM with NO fallback (fail-closed).
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
    'dispatch() runs the job in the microVM, verifies it centrally, and nukes the overlay',
    async () => {
      const sandbox = makeSandboxKeys()
      const SECRET = 'DISPATCHER-RIG-SECRET-4b9c'
      const boundary = 'DISP'
      const input = Buffer.from(
        [
          'Subject: dispatched',
          'MIME-Version: 1.0',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain',
          '',
          'public dispatched body',
          `--${boundary}`,
          'Content-Type: application/octet-stream',
          'Content-Disposition: attachment; filename="s.bin"',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(SECRET).toString('base64'),
          `--${boundary}--`,
          '',
        ].join('\r\n'),
        'utf8',
      )

      const t0 = Date.now()
      const res = await dispatcher.dispatch({
        jobId: 'rig-dispatch-1',
        kind: 'depackage',
        input: { inputBytes: input },
        custodyPubKeyB64: sandbox.pubB64,
        limits: { maxWallClockMs: VM_TIMEOUT },
        flush: 'per-action',
      })
      console.log(`[perf] dispatcher→microVM depackage create→run→verify→nuke = ${Date.now() - t0} ms`)

      // ok implies BOTH central checks passed (signature + safe-text).
      expect(res.ok).toBe(true)
      expect(res.meta?.executorId).toBe('microvm')
      expect(res.meta?.flushed).toBe('per-action')

      const out = res.output!
      expect(out.safeText.schema).toBe('safe-text/v1')
      expect(out.safeText.body_text).toContain('public dispatched body')
      // Secret never leaks into safe-text.
      expect(JSON.stringify(out.safeText)).not.toContain(SECRET)
      expect(out.artifacts.some((a) => a.content_type === 'application/octet-stream')).toBe(true)

      // Overlay nuked — per-action flush confirmed.
      const leftover = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover).toEqual([])
    },
    VM_TIMEOUT,
  )
})
