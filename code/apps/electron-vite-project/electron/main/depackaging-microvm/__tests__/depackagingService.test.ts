/**
 * Build 2b safe-slice — depackaging service seam.
 *
 * Pure tests: config resolution honors env overrides. Rig-guarded test: the
 * one-call seam routes untrusted bytes through the real microVM AND re-validates
 * safeText against the allowlist before producing the blind-courier record.
 */

import { describe, test, expect } from 'vitest'
import { existsSync, accessSync, constants } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { x25519 } from '@noble/curves/ed25519'
import { resolveCrosvmConfig, depackageUntrustedBytes, _resetDepackagingProviderForTests } from '../depackagingService'

describe('resolveCrosvmConfig — overridable paths', () => {
  test('defaults point at ~/build/rig', () => {
    const c = resolveCrosvmConfig({} as NodeJS.ProcessEnv)
    expect(c.goldenRootfsPath).toContain(path.join('build', 'rig', 'golden-base.ext4'))
    expect(c.vsockHostClientPath).toContain(path.join('build', 'rig', 'vsock-host-client'))
  })

  test('env vars override every path', () => {
    const env = {
      WR_CROSVM_BIN: '/x/crosvm',
      WR_CROSVM_GOLDEN: '/x/golden.ext4',
      WR_CROSVM_KERNEL: '/x/vmlinuz',
      WR_CROSVM_OVERLAY_DIR: '/x/ov',
      WR_CROSVM_VSOCK_CLIENT: '/x/client',
    } as unknown as NodeJS.ProcessEnv
    const c = resolveCrosvmConfig(env)
    expect(c).toMatchObject({
      crosvmBin: '/x/crosvm',
      goldenRootfsPath: '/x/golden.ext4',
      kernelPath: '/x/vmlinuz',
      overlayDir: '/x/ov',
      vsockHostClientPath: '/x/client',
    })
  })
})

const home = os.homedir()
const rig = path.join(home, 'build', 'rig')
function rigAvailable(): boolean {
  if (process.platform !== 'linux') return false
  try {
    accessSync('/dev/kvm', constants.R_OK | constants.W_OK)
    accessSync('/dev/vhost-vsock', constants.R_OK | constants.W_OK)
    return [
      path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
      path.join(rig, 'golden-base.ext4'),
      path.join(rig, 'vmlinuz'),
      path.join(rig, 'vsock-host-client'),
    ].every((p) => existsSync(p))
  } catch {
    return false
  }
}

describe.skipIf(!rigAvailable())('depackageUntrustedBytes — through the real microVM (rig)', () => {
  test(
    'routes bytes through the VM and returns a re-validated safe-text + courier record',
    async () => {
      _resetDepackagingProviderForTests()
      const priv = x25519.utils.randomPrivateKey()
      const pub = Buffer.from(x25519.getPublicKey(priv)).toString('base64')
      const boundary = 'SVC'
      const input = Buffer.from(
        [
          'Subject: service seam',
          'MIME-Version: 1.0',
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain',
          '',
          'routed through the depackaging service',
          `--${boundary}--`,
          '',
        ].join('\r\n'),
        'utf8',
      )
      const out = await depackageUntrustedBytes({
        jobId: 'svc-1',
        kind: 'depackaging',
        inputBytes: input,
        sandboxPeerX25519PubB64: pub,
      })
      expect(out.ok).toBe(true)
      expect(out.safeText?.schema).toBe('safe-text/v1')
      expect(out.safeText?.body_text).toContain('routed through the depackaging service')
      expect(out.courier).toBeTruthy()
    },
    90_000,
  )
})
