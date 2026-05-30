/**
 * HyperVProvider — STUB (capability detection only, build001).
 *
 * Tier: 'hyperv' — the preferred Windows isolation tier when available.
 * Transport (future): Hyper-V sockets (hvsocket / VMBus); the guest VM
 * exposes the pipeline on a well-known VSOCK GUID and the host side opens
 * an HV socket to send/receive bytes without going through TCP or a
 * published port. This completely avoids wslrelay and the dead TCP path.
 *
 * Status: callPipeline throws IsolationNotImplementedError.
 * detectCapability probes Hyper-V presence so the capability ladder can
 * prefer this tier once the hvsocket transport is wired in a future build.
 *
 * Detection strategy:
 *   Windows: look for %SystemRoot%\System32\vmcompute.exe (Hyper-V Compute
 *   service binary) — present when the Hyper-V platform feature is installed.
 *   Non-Windows: always available=false.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { CapabilityResult, IsolationProvider } from './IsolationProvider.js'
import { IsolationNotImplementedError } from './IsolationProvider.js'

/** Hyper-V Compute Service binary — present iff Hyper-V platform is installed. */
function resolveVmComputePath(): string {
  const sysRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return path.join(sysRoot, 'System32', 'vmcompute.exe')
}

export class HyperVProvider implements IsolationProvider {
  async detectCapability(): Promise<CapabilityResult> {
    if (process.platform !== 'win32') {
      return { available: false, implemented: false, tier: 'hyperv', details: 'Hyper-V is Windows-only' }
    }
    const vmcomputePath = resolveVmComputePath()
    const present = existsSync(vmcomputePath)
    if (!present) {
      return {
        available: false,
        implemented: false,
        tier: 'hyperv',
        details: `Hyper-V not detected (${vmcomputePath} not found)`,
      }
    }
    return {
      available: true,
      implemented: false,
      tier: 'hyperv',
      details:
        'Hyper-V platform detected (vmcompute.exe present) — hvsocket transport not yet implemented (build001 stub)',
    }
  }

  async ensurePipelineReady(): Promise<void> {
    throw new IsolationNotImplementedError('hyperv', 'hvsocket')
  }

  async callPipeline(_role: string, _op: string, _payloadBytes: Buffer): Promise<Buffer> {
    throw new IsolationNotImplementedError('hyperv', 'hvsocket')
  }

  async teardown(): Promise<void> {
    // nothing — stub
  }
}
