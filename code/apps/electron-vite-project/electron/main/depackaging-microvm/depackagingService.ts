/**
 * Depackaging service seam (Build 2b — safe cutover slice).
 *
 * Orchestrator-facing entry point that routes untrusted bytes through the
 * depackaging microVM (`CrosvmProvider`) and applies the receive-side discipline
 * in one place:
 *   1. provider.runJob — boot a fresh microVM, depackage over vsock, NUKE it.
 *      (Fail-loud: throws if crosvm/Linux/kvm/vsock unavailable — NO in-process
 *      fallback. The orchestrator must never parse untrusted bytes itself.)
 *   2. The provider already verified the guest result signature (transport
 *      integrity). Because that key is NOT yet attestation-backed, we ALSO
 *      re-validate `safeText` against the closed allowlist — the allowlist
 *      re-validation stays authoritative until VM-identity attestation lands.
 *   3. Project into the blind-courier record the orchestrator persists.
 *
 * NOTE (deliberate scope): this seam is wired and tested but is NOT yet spliced
 * into the live BEAP receive path. The BEAP path performs qBEAP HYBRID DECRYPT,
 * which needs handshake PRIVATE keys that — per the decided trust model — must
 * stay in the orchestrator (the inner microVM must never hold keys). The Build-1
 * worker is an email-MIME depackager, not a BEAP decryptor; splicing the live
 * path (and the cross-machine regression that must accompany it) is the deferred
 * step. This module is the integration point for that work.
 */

import * as os from 'os'
import * as path from 'path'
import { CrosvmProvider, type CrosvmProviderConfig } from './crosvmProvider'
import type { JobResult, JobSpec } from './hypervisorProvider'
import { validateSafeText, type SafeTextV1 } from './safeText'
import { toCourierRecord, type CourierRecord } from './blindCourier'

let cached: CrosvmProvider | null = null

/** Resolve provider paths from env (overridable), defaulting to the rig's ~/build. */
export function resolveCrosvmConfig(env: NodeJS.ProcessEnv = process.env): CrosvmProviderConfig {
  const home = os.homedir()
  const rig = path.join(home, 'build', 'rig')
  return {
    crosvmBin: env.WR_CROSVM_BIN ?? path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
    goldenRootfsPath: env.WR_CROSVM_GOLDEN ?? path.join(rig, 'golden-base.ext4'),
    kernelPath: env.WR_CROSVM_KERNEL ?? path.join(rig, 'vmlinuz'),
    overlayDir: env.WR_CROSVM_OVERLAY_DIR ?? path.join(rig, 'overlays'),
    vsockHostClientPath: env.WR_CROSVM_VSOCK_CLIENT ?? path.join(rig, 'vsock-host-client'),
  }
}

export function getDepackagingProvider(): CrosvmProvider {
  if (!cached) cached = new CrosvmProvider(resolveCrosvmConfig())
  return cached
}

/** For tests: reset the memoized provider. */
export function _resetDepackagingProviderForTests(): void {
  cached = null
}

export interface DepackageOutcome {
  ok: boolean
  error?: string
  safeText?: SafeTextV1
  courier?: CourierRecord
  result?: JobResult
}

/**
 * Route untrusted bytes through the depackaging microVM and re-validate. Throws
 * (does NOT fall back) when the crosvm path is unavailable.
 */
export async function depackageUntrustedBytes(spec: JobSpec): Promise<DepackageOutcome> {
  const runResult = await getDepackagingProvider().runJob(spec)
  // This service routes the B1 `depackage` kind only (bare SafeText). The
  // `depackage-email` typed union is handled by the seam (`liveDepackageCutover`).
  if ('kind' in runResult && runResult.kind === 'depackage-email') {
    return { ok: false, error: 'depackagingService handles only the depackage kind' }
  }
  const result = runResult as JobResult
  if (!result.ok) return { ok: false, error: result.error, result }

  const v = validateSafeText(result.safeText)
  if (!v.ok) return { ok: false, error: `safeText re-validation failed: ${v.reason}`, result }

  return { ok: true, safeText: v.value, courier: toCourierRecord(result, v.value), result }
}
