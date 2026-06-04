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
  type JobResult,
} from '../depackaging-microvm/hypervisorProvider'
import { validateSafeText } from '../depackaging-microvm/safeText'
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
