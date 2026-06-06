/**
 * Live-path adapter for the B2 email-depackage cutover (build spec 0007, Phase 3).
 *
 * This is the ONLY place the live email path talks to the seam for depackaging.
 * It builds a dispatcher from the current `ResolutionContext` (role/tier env
 * honored) and routes ONE `depackage-email` job through it. The orchestrator
 * hands in only opaque `inputBytes` (raw RFC822 or provider-structured-json) +
 * the public custody key (INV-2: a PUBLIC X25519 key only); it never parses the
 * bytes itself.
 *
 * INV-7 / INV-3: `dispatchDepackageEmail` NEVER throws and NEVER inline-parses.
 *   - dispatch-level failure  → { ok: false, code }            (quarantine)
 *   - worker typed failure    → { ok: true, result: {ok:false} } (quarantine)
 *   - worker success union    → { ok: true, result: plain|carrier|mixed }
 * The consumer maps every non-success to a quarantine reason; there is no
 * best-effort fallback while the flag is on.
 */

import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import * as os from 'os'
import * as path from 'path'
import { CriticalJobDispatcher } from './dispatcher'
import { DEFAULT_RESOLUTION_TABLE } from './resolution'
import { buildResolutionContext } from './context'
import { InProcessExecutor } from './executors/inProcessExecutor'
import { RemoteHandshakeExecutor } from './executors/remoteHandshakeExecutor'
import { createCrosvmMicroVmExecutor } from './executors/microVmExecutor'
import type { CrosvmProviderConfig } from '../depackaging-microvm/crosvmProvider'
import type { CriticalJobErrorCode } from './types'
import type { DepackageEmailResult } from '../depackaging-microvm/emailDepackage'

/**
 * Wall-clock ceiling for a single email depackage. Generous so it never fails
 * valid mail (which would break parity); it only guards a truly hung executor.
 */
const DEPACKAGE_WALL_CLOCK_MS = 60_000

/** Defense-in-depth input ceiling handed to the guest (guest also re-checks). */
const DEPACKAGE_MAX_INPUT_BYTES = 8 * 1024 * 1024

export type DepackageDispatchOutcome =
  | { readonly ok: true; readonly result: DepackageEmailResult }
  | { readonly ok: false; readonly code: CriticalJobErrorCode; readonly message: string }

/**
 * Resolve the crosvm backend paths for the microVM executor. Env vars win (the
 * same ones the rig tests honor); otherwise the rig defaults under `~/build`.
 * The executor's `isAvailable()` (a real fs/device probe) gates selection, so on
 * a host without crosvm/kvm/vhost-vsock or the golden image, `exec=microvm`
 * routing fails closed (E_NO_EXECUTOR) rather than ever parsing in-process.
 */
/**
 * The sha256 of the worker bundle this orchestrator was BUILT with — the value
 * the golden image's baked bundle must match. Env override wins (deployments
 * set it explicitly); otherwise we read the committed bundle provenance next to
 * the source. Best-effort: if it can't be resolved the guard simply stays off
 * (a stale image then still fails, just by the slower vsock timeout) — we never
 * crash the live path over a missing marker.
 */
function resolveExpectedBundleSha256(): string | undefined {
  const env = process.env.CROSVM_EXPECTED_BUNDLE_SHA256?.trim()
  if (env) return env
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const provenancePath = path.join(
      here,
      '..',
      'depackaging-microvm',
      'rig',
      'dist',
      'worker-bundle.provenance.json',
    )
    const sha = JSON.parse(readFileSync(provenancePath, 'utf8'))?.artifact_sha256
    return typeof sha === 'string' && sha.length > 0 ? sha : undefined
  } catch {
    return undefined
  }
}

function resolveCrosvmConfig(): CrosvmProviderConfig {
  const home = os.homedir()
  const rig = path.join(home, 'build', 'rig')
  const goldenRootfsPath = process.env.CROSVM_GOLDEN ?? path.join(rig, 'golden-base.ext4')
  return {
    crosvmBin: process.env.CROSVM_BIN ?? path.join(home, 'build', 'crosvm', 'target', 'release', 'crosvm'),
    goldenRootfsPath,
    kernelPath: process.env.CROSVM_KERNEL ?? path.join(rig, 'vmlinuz'),
    overlayDir: process.env.CROSVM_OVERLAY_DIR ?? path.join(rig, 'overlays'),
    vsockHostClientPath: process.env.CROSVM_VSOCK_CLIENT ?? path.join(rig, 'vsock-host-client'),
    // Image/bundle consistency guard (fail fast on a stale image, never a 90s
    // boot-then-timeout). Marker sidecar defaults to `${goldenRootfsPath}.marker`.
    expectedBundleSha256: resolveExpectedBundleSha256(),
    goldenImageMarkerPath: process.env.CROSVM_GOLDEN_MARKER ?? `${goldenRootfsPath}.marker`,
  }
}

function buildDispatcher(): CriticalJobDispatcher {
  const ctx = buildResolutionContext()
  // in-process (sandbox/appliance free-tier floor) + the rig-proven microVM
  // executor (paid/appliance, or any tier under WRDESK_CRITICAL_EXEC=microvm) +
  // the Build C topology-aware remote executor. The microVM executor's
  // `isAvailable()` probes the host, so absent crosvm/kvm/vhost-vsock/golden the
  // microVM rows fail closed (E_NO_EXECUTOR) — never an in-process fallback.
  // Absent linked topology, the workstation remote rows are unavailable
  // → E_NO_EXECUTOR (exactly Build A behavior).
  return new CriticalJobDispatcher(
    {
      'in-process': new InProcessExecutor(ctx.role),
      microvm: createCrosvmMicroVmExecutor(resolveCrosvmConfig()),
      'remote-handshake': new RemoteHandshakeExecutor({ topology: ctx.topology.linked }),
    },
    DEFAULT_RESOLUTION_TABLE,
    ctx,
  )
}

/** Which guest parser runs on the opaque bytes (routing, not a content parse). */
export interface DepackageInputForm {
  /** `'rfc822'` (default) → bounded MIME parser; else the D4 structured walker. */
  readonly inputForm?: 'rfc822' | 'provider-structured-json'
  /** schema adapter for the structured-json walker (default `'outlook'`). */
  readonly provider?: string
}

/**
 * Route a single email payload through `dispatch({kind:'depackage-email'})`.
 *
 * @param inputBytes   the opaque provider payload (orchestrator never parses it)
 * @param custodyPubKeyB64 the paired sandbox PUBLIC X25519 key (sealing target)
 * @param maxInputBytes optional spec ceiling (wins over the guest default, C4)
 * @param form         input-form discriminator (default: rfc822)
 */
export async function dispatchDepackageEmail(
  inputBytes: Buffer,
  custodyPubKeyB64: string,
  maxInputBytes: number = DEPACKAGE_MAX_INPUT_BYTES,
  form: DepackageInputForm = {},
): Promise<DepackageDispatchOutcome> {
  const result = await buildDispatcher().dispatch({
    jobId: randomUUID(),
    kind: 'depackage-email',
    input: { inputBytes, maxInputBytes, inputForm: form.inputForm, provider: form.provider },
    custodyPubKeyB64,
    limits: { maxWallClockMs: DEPACKAGE_WALL_CLOCK_MS, maxInputBytes },
    flush: 'per-action',
  })
  if (result.ok && result.output) return { ok: true, result: result.output }
  return {
    ok: false,
    code: result.error?.code ?? 'E_EXECUTION_ERROR',
    message: result.error?.message ?? 'depackage-email dispatch failed',
  }
}
