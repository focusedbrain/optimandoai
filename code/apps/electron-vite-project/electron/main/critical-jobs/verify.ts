/**
 * Shared post-result verification for the routing seam (Build A, Deliverable 2).
 *
 * For depackage-style results, the dispatcher MUST run BOTH:
 *   1. `verifyJobResultSignature` — transport integrity (the result was not
 *      mutated after the worker signed it), and
 *   2. `validateSafeText` — the closed-schema re-validation the orchestrator
 *      owes regardless of who produced the result.
 *
 * This is the same pair the microVM design documents as required after a job;
 * centralizing it in the dispatcher's post-dispatch path closes the gap that
 * `crosvmProvider.runJob` verifies only the signature — no executor can skip it.
 *
 * This module also owns the bridge between the microVM `JobResult` (raw worker
 * output) and the seam's `CriticalJobResult<'depackage'>`, so in-process and
 * microVM executors emit an identical shape.
 */

import {
  verifyJobResultSignature,
  verifyDepackageEmailResultSignature,
  type DepackageEmailJobResult,
  type JobResult,
} from '../depackaging-microvm/hypervisorProvider'
import { validateSafeText } from '../depackaging-microvm/safeText'
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
    output: { safeText: job.safeText!, artifacts, stage_attestation: job.stage_attestation },
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
    stage_attestation: out?.stage_attestation,
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
 * Verify a depackage result (signature + safe-text) and project it into the
 * persistable courier output. The returned `output.safeText` is the
 * RE-VALIDATED copy (never the worker's claimed value passed through).
 */
export function verifyDepackageResult(r: CriticalJobResult<'depackage'>): DepackageVerification {
  const jr = reconstructJobResult(r)
  if (!verifyJobResultSignature(jr)) {
    return { ok: false, code: 'E_SIGNATURE_INVALID', message: 'job result signature invalid' }
  }
  const v = validateSafeText(jr.safeText)
  if (!v.ok) {
    return { ok: false, code: 'E_SAFETEXT_REJECTED', message: `safe-text rejected: ${v.reason}` }
  }
  const courier = toCourierRecord(jr, v.value)
  return { ok: true, output: { safeText: courier.safeText, artifacts: courier.artifacts } }
}

export type DepackageEmailVerification =
  | { readonly ok: true; readonly output: DepackageEmailResult }
  | {
      readonly ok: false
      readonly code: 'E_SIGNATURE_INVALID' | 'E_SAFETEXT_REJECTED'
      readonly message: string
    }

/**
 * Verify a `depackage-email` result the same way the B1 depackage path is
 * verified, generalized to the typed union:
 *   1. transport-integrity signature over the whole result, then
 *   2. closed-schema re-validation of EVERY safe-text present (the orchestrator
 *      never passes the guest's claimed safe-text through unchecked).
 *
 * A worker VERDICT failure (`result.ok === false`) is a valid, signed output (the
 * consumer quarantines it) — it has no safe-text, so only the signature is
 * checked. Success variants carry `safeText` (plain | mixed) or `carrierSafeText`
 * (beap-carrier); the validated copy replaces the worker's claimed value.
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
    // Signed worker-failure verdict — nothing to re-validate; consumer quarantines.
    return { ok: true, output: result }
  }
  if (result.type === 'beap-carrier') {
    if (!result.carrierSafeText) return { ok: true, output: result }
    const v = validateSafeText(result.carrierSafeText)
    if (!v.ok) {
      return { ok: false, code: 'E_SAFETEXT_REJECTED', message: `safe-text rejected: ${v.reason}` }
    }
    return { ok: true, output: { ...result, carrierSafeText: v.value } }
  }
  // plain | mixed both carry `safeText`.
  const v = validateSafeText(result.safeText)
  if (!v.ok) {
    return { ok: false, code: 'E_SAFETEXT_REJECTED', message: `safe-text rejected: ${v.reason}` }
  }
  return { ok: true, output: { ...result, safeText: v.value } }
}
