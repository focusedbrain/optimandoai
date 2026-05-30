/**
 * FirecrackerProvider — STUB (capability detection only, build001).
 *
 * Tier: 'firecracker' — the preferred Linux isolation tier when /dev/kvm is
 * available (hardware-assisted virtualisation).
 * Transport (future): VSOCK (virtio socket); the Firecracker guest exposes the
 * pipeline on a CID/port and the host sends/receives bytes via AF_VSOCK without
 * going through TCP. This completely avoids the rootlessport+pasta ECONNRESET
 * issue on rootless Podman.
 *
 * Status: callPipeline throws IsolationNotImplementedError.
 * detectCapability probes /dev/kvm so the capability ladder can prefer this
 * tier once the vsock transport is wired in a future build.
 *
 * Detection strategy:
 *   Linux: check /dev/kvm is readable+writable by the current process.
 *   Non-Linux: always available=false.
 */

import { access, constants as fsConstants } from 'node:fs/promises'
import type { CapabilityResult, IsolationProvider } from './IsolationProvider.js'
import { IsolationNotImplementedError } from './IsolationProvider.js'

const KVM_DEVICE = '/dev/kvm'

export class FirecrackerProvider implements IsolationProvider {
  async detectCapability(): Promise<CapabilityResult> {
    if (process.platform !== 'linux') {
      return { available: false, implemented: false, tier: 'firecracker', details: 'Firecracker is Linux-only' }
    }
    try {
      await access(KVM_DEVICE, fsConstants.R_OK | fsConstants.W_OK)
      return {
        available: true,
        implemented: false,
        tier: 'firecracker',
        details:
          `${KVM_DEVICE} accessible — KVM hardware virtualisation present; ` +
          'vsock transport not yet implemented (build001 stub)',
      }
    } catch (e) {
      return {
        available: false,
        implemented: false,
        tier: 'firecracker',
        details: `${KVM_DEVICE} not accessible: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  async ensurePipelineReady(): Promise<void> {
    throw new IsolationNotImplementedError('firecracker', 'vsock')
  }

  async callPipeline(_role: string, _op: string, _payloadBytes: Buffer): Promise<Buffer> {
    throw new IsolationNotImplementedError('firecracker', 'vsock')
  }

  async teardown(): Promise<void> {
    // nothing — stub
  }
}
