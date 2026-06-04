/**
 * Build 2b — ON-RIG INVARIANT PROOFS THROUGH THE REAL CrosvmProvider.
 *
 * Build 1 proved the invariants on the pure functions; 2a proved the substrate;
 * THIS proves them through the real microVM over vsock: untrusted bytes are
 * handed to a booted crosvm guest, the worker runs in-guest, and the signed
 * JobResult comes back over AF_VSOCK. No shared filesystem, no network.
 *
 * The VM-booting tests SKIP automatically off-rig (non-Linux, or missing
 * /dev/kvm / vhost-vsock / crosvm binary / golden image / vsock client) so the
 * suite is a no-op on Windows/CI. Run on the rig with:
 *   pnpm vitest run electron/main/depackaging-microvm/__tests__/crosvmProvider.rig.test.ts
 *
 * Paths are overridable via env (CROSVM_BIN, CROSVM_GOLDEN, CROSVM_KERNEL,
 * CROSVM_OVERLAY_DIR, CROSVM_VSOCK_CLIENT); defaults point at ~/build/rig.
 */

import { describe, test, expect } from 'vitest'
import { existsSync, accessSync, constants, readdirSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { x25519 } from '@noble/curves/ed25519'
import { CrosvmProvider, buildCrosvmArgs, type CrosvmProviderConfig } from '../crosvmProvider'
import { verifyJobResultSignature, type JobResult, type JobSpec } from '../hypervisorProvider'
import { validateSafeText } from '../safeText'
import { toCourierRecord } from '../blindCourier'
import { decryptQuarantineBlob } from '../../quarantine-encrypt/index'
import { assessSandboxKeyReadiness, ERR_HANDSHAKE_LOCAL_KEY_MISSING } from '../legacyRepair'

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
  const pub = x25519.getPublicKey(priv)
  return { privB64: Buffer.from(priv).toString('base64'), pubB64: Buffer.from(pub).toString('base64') }
}

function eml(parts: string[]): Buffer {
  return Buffer.from(parts.join('\r\n'), 'utf8')
}

async function runOne(provider: CrosvmProvider, inputBytes: Buffer, pubB64: string, jobId: string): Promise<JobResult> {
  const spec: JobSpec = { jobId, kind: 'depackage', inputBytes, sandboxPeerX25519PubB64: pubB64 }
  return provider.runJob(spec)
}

/* ─────────────────────── Pure invariants (always run) ─────────────────────── */

describe('Build 2b — provider launch invariants (no VM needed)', () => {
  test('ZERO EGRESS: launch argv never contains --net/--tap, and pins RO base + vsock', () => {
    const args = buildCrosvmArgs(cfg, 7, '/tmp/overlay.img')
    const joined = args.join(' ')
    expect(joined).not.toMatch(/--net|--tap|tap-name|tap-fd/)
    expect(joined).toContain('ro=true,root=true') // immutable golden base
    expect(joined).toContain('--vsock') // the only host<->guest channel
    expect(joined).not.toMatch(/shared-dir|virtio-fs|--fs|--shared/) // no shared FS
  })

  test('LEGACY RE-PAIR: a pre-v50 NULL-key handshake surfaces the affordance, not a silent fail', () => {
    const r = assessSandboxKeyReadiness({
      id: 'hs-legacy-1',
      deviceName: 'Old Sandbox',
      peer_x25519_public_key_b64: null,
      local_x25519_public_key_b64: null,
    })
    expect(r.ready).toBe(false)
    if (!r.ready) {
      expect(r.code).toBe(ERR_HANDSHAKE_LOCAL_KEY_MISSING)
      expect(r.repair.action).toBe('re_pair_sandbox')
      expect(r.repair.message.length).toBeGreaterThan(0)
    }
    const ok = assessSandboxKeyReadiness({ id: 'hs-new', peer_x25519_public_key_b64: makeSandboxKeys().pubB64 })
    expect(ok.ready).toBe(true)
  })
})

/* ──────────────── Real-microVM invariants (skip off-rig) ──────────────── */

describe.skipIf(!RIG)('Build 2b — invariants through the real crosvm microVM (vsock)', () => {
  const provider = new CrosvmProvider(cfg)

  test('availability gate is true on the rig', async () => {
    expect(await provider.isAvailable()).toBe(true)
  })

  test(
    'TEXT-PURITY: active content is ABSENT from emitted safe-text (positive construction, not sanitized)',
    async () => {
      const sandbox = makeSandboxKeys()
      const boundary = 'PURITY'
      const input = eml([
        'Subject: hi',
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain',
        '',
        // bidi override + zero-width injected into the *plain* part
        'safe line\u202Eevil\u200B end',
        `--${boundary}`,
        'Content-Type: text/html',
        '',
        '<script>steal()</script><img src=x onerror="fetch(\'//evil\')"> data:text/html,<b>x</b>',
        `--${boundary}--`,
        '',
      ])
      const t0 = Date.now()
      const res = await runOne(provider, input, sandbox.pubB64, 'purity-1')
      // PERF NOTE (recorded in test output): real create->run->nuke time.
      console.log(`[perf] text-purity job create->run->nuke = ${Date.now() - t0} ms`)

      expect(res.ok).toBe(true)
      expect(verifyJobResultSignature(res)).toBe(true)
      const v = validateSafeText(res.safeText)
      expect(v.ok).toBe(true)

      const blob = JSON.stringify(res.safeText)
      // Active content discarded, not present as markup in the text fields.
      expect(blob).not.toContain('<script')
      expect(blob).not.toContain('onerror')
      expect(blob).not.toContain('data:text/html')
      // Bidi/zero-width control chars stripped by toPlainTextField.
      expect(blob).not.toMatch(/[\u202A-\u202E\u200B-\u200F\u2066-\u2069]/)
      // The HTML lives ONLY as an encrypted artifact, never inline.
      expect((res.artifacts ?? []).some((a) => a.content_type === 'text/html')).toBe(true)
    },
    VM_TIMEOUT,
  )

  test(
    'BLIND-COURIER: orchestrator-stored record has no plaintext; only the sandbox key decrypts',
    async () => {
      const sandbox = makeSandboxKeys()
      const SECRET = 'TOP-SECRET-OVER-VSOCK-7e21'
      const boundary = 'CUST'
      const input = eml([
        'Subject: custody',
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain',
        '',
        'public body',
        `--${boundary}`,
        'Content-Type: application/octet-stream',
        'Content-Disposition: attachment; filename="secret.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(SECRET).toString('base64'),
        `--${boundary}--`,
        '',
      ])
      const res = await runOne(provider, input, sandbox.pubB64, 'custody-1')
      expect(res.ok).toBe(true)
      expect(verifyJobResultSignature(res)).toBe(true)

      const v = validateSafeText(res.safeText)
      expect(v.ok).toBe(true)
      const record = toCourierRecord(res, (v as { ok: true; value: any }).value)

      // Everything the orchestrator stores: no plaintext, no private key.
      const stored = JSON.stringify(record)
      expect(stored).not.toContain(SECRET)
      expect(stored.toLowerCase()).not.toContain('private')

      const artifact = record.artifacts.find((a) => a.content_type === 'application/octet-stream')!
      expect(decryptQuarantineBlob(artifact.ciphertext, makeSandboxKeys().privB64).ok).toBe(false)
      const opened = decryptQuarantineBlob(artifact.ciphertext, sandbox.privB64)
      expect(opened.ok).toBe(true)
      if (opened.ok) expect(opened.plaintext.toString('utf8')).toBe(SECRET)
    },
    VM_TIMEOUT,
  )

  test(
    'EPHEMERALITY: no overlay persists after a job, and consecutive jobs share no state',
    async () => {
      const sandbox = makeSandboxKeys()
      const input = eml(['Subject: e', '', 'ephemeral body'])

      const r1 = await runOne(provider, input, sandbox.pubB64, 'ephem-1')
      expect(r1.ok).toBe(true)
      const leftover1 = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover1).toEqual([]) // overlay discarded on nuke

      const r2 = await runOne(provider, input, sandbox.pubB64, 'ephem-2')
      expect(r2.ok).toBe(true)
      const leftover2 = readdirSync(cfg.overlayDir).filter((f) => f.startsWith('overlay-'))
      expect(leftover2).toEqual([])

      // Each job is a fresh VM: per-job result-signing key differs => no carry-over.
      expect(r1.result_signing_pub_b64).not.toBe(r2.result_signing_pub_b64)
    },
    VM_TIMEOUT,
  )
})
