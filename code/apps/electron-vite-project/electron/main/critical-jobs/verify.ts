/**
 * Shared post-result verification for the routing seam (Build A → L3).
 *
 * After the padding teardown (Step 3), the host final stage is:
 *   1. `verifyJobResultSignature` — Ed25519 transport integrity, with optional
 *      VM-identity-bound provenance check (Step 1: host-provisioned key).
 *   2. `validateSafeText` — closed-schema re-validation (L5) + retained
 *      character blocklist (L2).
 *   3. `detectThreats` — defense-in-depth (L3). Non-load-bearing: findings
 *      log/flag but do NOT silently pass. The gate is provenance + schema.
 *
 * NO padding, NO de-pad, NO chain verification. The text arrives as the
 * SafeTextV1 the guest constructed; the host verifies, does not transform.
 */

import {
  verifyJobResultSignature,
  verifyDepackageEmailResultSignature,
  type DepackageEmailJobResult,
  type JobResult,
} from '../depackaging-microvm/hypervisorProvider'
import { validateSafeText, type SafeTextV1 } from '../depackaging-microvm/safeText'
import { detectThreats } from '../depackaging-microvm/defenseInDepthDetection'
import type { DepackageEmailResult } from '../depackaging-microvm/emailDepackage'
import { toCourierRecord, type CourierArtifactRecord } from '../depackaging-microvm/blindCourier'
import type { CriticalJobResult, DepackageOutput } from './types'

/**
 * Map a raw worker `JobResult` into the seam's depackage result shape WITHOUT
 * verifying it (verification is the dispatcher's job). `output.safeText` here is
 * the worker's claimed safe-text; the dispatcher re-validates it before the
 * caller ever sees it.
 */
export function depackageJobResultToCriticalResult(job: JobResult): CriticalJobResult<'depackage'> {
  if (!job.ok) {
    return {
      jobId: job.jobId,
      ok: false,
      error: { code: 'E_EXECUTION_ERROR', message: job.error ?? 'depackage job failed' },
    }
  }
  const artifacts: CourierArtifactRecord[] = (job.artifacts ?? []).map((a) => ({
    blob_id: a.blob_id,
    content_type: a.content_type,
    filename: a.filename,
    ciphertext: a.blob,
  }))
  return {
    jobId: job.jobId,
    ok: true,
    output: { safeText: job.safeText!, artifacts },
    result_signing_pub_b64: job.result_signing_pub_b64,
    result_signature_b64: job.result_signature_b64,
  }
}

/**
 * Reconstruct the exact `JobResult` the worker signed from a depackage result.
 * Valid because the canonical signed bytes commit only to `jobId`, `ok`,
 * `safeText`, and per-artifact `{blob_id, content_type, ciphertext_b64}` — all
 * of which survive the courier projection unchanged.
 */
function reconstructJobResult(r: CriticalJobResult<'depackage'>): JobResult {
  const out = r.output
  return {
    jobId: r.jobId,
    ok: r.ok,
    safeText: out?.safeText,
    artifacts: (out?.artifacts ?? []).map((a) => ({
      blob_id: a.blob_id,
      content_type: a.content_type,
      filename: a.filename,
      blob: a.ciphertext,
    })),
    result_signing_pub_b64: r.result_signing_pub_b64,
    result_signature_b64: r.result_signature_b64,
  }
}

/**
 * Signature-only check (Build C, spec 0017 §3.2): the RemoteHandshakeExecutor
 * verifies a remote depackage result's job-result signature locally before
 * returning it, so a tampered result is rejected by the SENDER (§4) without
 * waiting for the dispatcher post-path. This intentionally does NOT re-validate
 * or re-project safe-text (that is the dispatcher's single authoritative pass via
 * `verifyDepackageResult`) — it only proves transport integrity.
 */
export function depackageResultSignatureValid(r: CriticalJobResult<'depackage'>): boolean {
  return verifyJobResultSignature(reconstructJobResult(r))
}

export type DepackageVerification =
  | { readonly ok: true; readonly output: DepackageOutput }
  | {
      readonly ok: false
      readonly code: 'E_SIGNATURE_INVALID' | 'E_SAFETEXT_REJECTED'
      readonly message: string
    }

/**
 * Verify a depackage result (post-padding-teardown):
 *   1. Transport signature (Ed25519) — proves transport integrity / VM provenance.
 *   2. validateSafeText — closed-schema re-validation (L5) + blocklist (L2).
 *   3. detectThreats — defense-in-depth (L3), non-load-bearing.
 *
 * Fail closed on signature or schema failure. Detection findings are logged
 * but treated as a hard gate per defense-in-depth policy.
 */
export function verifyDepackageResult(
  r: CriticalJobResult<'depackage'>,
): DepackageVerification {
  const jr = reconstructJobResult(r)
  if (!verifyJobResultSignature(jr)) {
    return { ok: false, code: 'E_SIGNATURE_INVALID', message: 'job result signature invalid' }
  }

  const safeText = jr.safeText
  if (!safeText) {
    return { ok: false, code: 'E_SAFETEXT_REJECTED', message: 'missing safe-text in result' }
  }

  const hostResult = runHostFinalStage(safeText)
  if (!hostResult.ok) {
    return hostResult
  }

  const courier = toCourierRecord(
    { ...jr, safeText: hostResult.safeText },
    hostResult.safeText,
  )
  return {
    ok: true,
    output: {
      safeText: courier.safeText,
      artifacts: courier.artifacts,
    },
  }
}

// ── Shared host final-stage logic ────────────────────────────────────────────

type HostStageFailure = {
  readonly ok: false
  readonly code: 'E_SAFETEXT_REJECTED'
  readonly message: string
}

/**
 * The host's final validation stage (post-padding-teardown).
 *
 * 1. validateSafeText — closed-schema re-validation (L5) + blocklist (L2).
 * 2. detectThreats — defense-in-depth (L3). Findings fail closed.
 *
 * The text is the raw SafeTextV1 the guest constructed. No padding, no de-pad,
 * no chain verification. The host verifies; it does not transform.
 */
function runHostFinalStage(
  safeText: SafeTextV1,
):
  | { readonly ok: true; readonly safeText: SafeTextV1 }
  | HostStageFailure {
  const v = validateSafeText(safeText)
  if (!v.ok) {
    return { ok: false, code: 'E_SAFETEXT_REJECTED', message: `safe-text rejected: ${v.reason}` }
  }

  const bodyDetection = detectThreats(safeText.body_text)
  if (!bodyDetection.pass) {
    return {
      ok: false,
      code: 'E_SAFETEXT_REJECTED',
      message: `defense-in-depth detection on body: ${bodyDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }
  const subjectDetection = detectThreats(safeText.subject)
  if (!subjectDetection.pass) {
    return {
      ok: false,
      code: 'E_SAFETEXT_REJECTED',
      message: `defense-in-depth detection on subject: ${subjectDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }

  return { ok: true, safeText: v.value }
}

// ── depackage-email verification ─────────────────────────────────────────────

export type DepackageEmailVerification =
  | { readonly ok: true; readonly output: DepackageEmailResult }
  | {
      readonly ok: false
      readonly code: 'E_SIGNATURE_INVALID' | 'E_SAFETEXT_REJECTED'
      readonly message: string
    }

/**
 * Verify a `depackage-email` result (post-padding-teardown).
 *
 * Same three gates as `verifyDepackageResult`: signature → schema → detection.
 */
export function verifyDepackageEmailResult(
  r: CriticalJobResult<'depackage-email'>,
): DepackageEmailVerification {
  const result = r.output
  if (!result) {
    return { ok: false, code: 'E_SIGNATURE_INVALID', message: 'missing depackage-email output' }
  }
  const jr: DepackageEmailJobResult = {
    jobId: r.jobId,
    kind: 'depackage-email',
    result,
    result_signing_pub_b64: r.result_signing_pub_b64,
    result_signature_b64: r.result_signature_b64,
  }
  if (!verifyDepackageEmailResultSignature(jr)) {
    return { ok: false, code: 'E_SIGNATURE_INVALID', message: 'job result signature invalid' }
  }
  if (!result.ok) {
    return { ok: true, output: result }
  }

  const safeText =
    result.type === 'beap-carrier' ? result.carrierSafeText : result.safeText
  if (!safeText) {
    return { ok: true, output: result }
  }

  const hostResult = runHostFinalStage(safeText)
  if (!hostResult.ok) {
    return hostResult
  }

  if (result.type === 'beap-carrier') {
    return { ok: true, output: { ...result, carrierSafeText: hostResult.safeText } }
  }
  return { ok: true, output: { ...result, safeText: hostResult.safeText } }
}
