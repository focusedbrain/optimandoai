/**
 * Shared post-result verification for the routing seam (Build A → L3).
 *
 * For depackage-style results, the dispatcher runs the FULL chain verification:
 *   1. `verifyJobResultSignature` — transport integrity (Ed25519).
 *   2. Host stage-N: detection on padded text, pad once more, produce host
 *      attestation (chained to prior).
 *   3. De-pad ALL layers → exact original raw text.
 *   4. `verifyAttestationChain` — chain links, CCH, stage count.
 *   5. `validateSafeText` — closed-schema re-validation on de-padded text.
 *   6. `detectThreats` — final raw-text detection.
 *   7. Only when ALL gates pass → text is trusted.
 *
 * The stage count is TOPOLOGY-DRIVEN: 2 for single-machine (sandbox stage 1 +
 * host stage 2), configurable to 3 for dedicated when the host-VM validator
 * lands. Passed as a parameter with a default of 2.
 */

import {
  verifyJobResultSignature,
  verifyDepackageEmailResultSignature,
  type DepackageEmailJobResult,
  type JobResult,
} from '../depackaging-microvm/hypervisorProvider'
import { validateSafeText, type SafeTextV1 } from '../depackaging-microvm/safeText'
import { pad, unpadLayers } from '../depackaging-microvm/padTransform'
import { detectThreats } from '../depackaging-microvm/paddingAwareDetection'
import {
  canonicalContentHash,
  createStageAttestation,
  verifyAttestationChain,
  type StageAttestation,
} from '../depackaging-microvm/stageAttestation'
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
      readonly code: 'E_SIGNATURE_INVALID' | 'E_SAFETEXT_REJECTED' | 'E_CHAIN_INVALID'
      readonly message: string
    }

/**
 * Verify a depackage result through the FULL validation chain (L3):
 *   1. Transport signature (Ed25519)
 *   2. Host detection on padded text → fail closed
 *   3. Host pads + attests (stage N, chained to prior)
 *   4. De-pad ALL layers → raw text
 *   5. verifyAttestationChain → fail closed
 *   6. validateSafeText on raw → fail closed
 *   7. detectThreats on raw → fail closed
 *
 * @param expectedStageCount  Topology-driven. Default 2 (sandbox + host).
 */
export function verifyDepackageResult(
  r: CriticalJobResult<'depackage'>,
  expectedStageCount: number = 2,
): DepackageVerification {
  const jr = reconstructJobResult(r)
  if (!verifyJobResultSignature(jr)) {
    return { ok: false, code: 'E_SIGNATURE_INVALID', message: 'job result signature invalid' }
  }

  const stage1Att = r.output?.stage_attestation
  if (!stage1Att) {
    return { ok: false, code: 'E_CHAIN_INVALID', message: 'missing stage-1 attestation' }
  }
  const paddedSafeText = jr.safeText
  if (!paddedSafeText) {
    return { ok: false, code: 'E_CHAIN_INVALID', message: 'missing safe-text in result' }
  }

  const chainResult = runHostFinalStage(
    paddedSafeText,
    [stage1Att],
    expectedStageCount,
  )
  if (!chainResult.ok) {
    return chainResult
  }

  const courier = toCourierRecord(
    { ...jr, safeText: chainResult.rawSafeText },
    chainResult.rawSafeText,
  )
  return {
    ok: true,
    output: {
      safeText: courier.safeText,
      artifacts: courier.artifacts,
      stage_attestation: stage1Att,
    },
  }
}

// ── Shared host final-stage logic ────────────────────────────────────────────

type ChainFailure = {
  readonly ok: false
  readonly code: 'E_CHAIN_INVALID' | 'E_SAFETEXT_REJECTED'
  readonly message: string
}

/**
 * The host's final validation stage. Shared by both B1 and B2 verification.
 *
 * 1. Detect on received padded text (host detection pass). Fail closed.
 * 2. Pad once more → host attestation (chained to prior).
 * 3. De-pad ALL layers → raw text.
 * 4. verifyAttestationChain.
 * 5. validateSafeText on raw.
 * 6. detectThreats on raw (final raw detection).
 */
function runHostFinalStage(
  paddedSafeText: SafeTextV1,
  priorAttestations: readonly StageAttestation[],
  expectedStageCount: number,
):
  | { readonly ok: true; readonly rawSafeText: SafeTextV1; readonly allAttestations: readonly StageAttestation[] }
  | ChainFailure {
  const hostStageId = priorAttestations.length + 1

  // Gate 1: host detection on padded text
  const bodyDetection = detectThreats(paddedSafeText.body_text)
  if (!bodyDetection.pass) {
    return {
      ok: false,
      code: 'E_CHAIN_INVALID',
      message: `host stage-${hostStageId} detection on padded body: ${bodyDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }
  const subjectDetection = detectThreats(paddedSafeText.subject)
  if (!subjectDetection.pass) {
    return {
      ok: false,
      code: 'E_CHAIN_INVALID',
      message: `host stage-${hostStageId} detection on padded subject: ${subjectDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }

  // Gate 2: host pads + attests
  const hostPaddedBody = pad(paddedSafeText.body_text)
  const lastPrior = priorAttestations[priorAttestations.length - 1]
  const cch = lastPrior.canonical_content_hash
  const hostAttestation = createStageAttestation(
    hostStageId,
    'host',
    cch,
    hostPaddedBody,
    lastPrior,
  )
  const allAttestations = [...priorAttestations, hostAttestation]

  // Gate 3: de-pad ALL layers → raw
  let rawBody: string
  let rawSubject: string
  try {
    rawBody = unpadLayers(paddedSafeText.body_text, priorAttestations.length)
    rawSubject = unpadLayers(paddedSafeText.subject, priorAttestations.length)
  } catch (err) {
    return {
      ok: false,
      code: 'E_CHAIN_INVALID',
      message: `de-pad integrity error: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // Gate 4: verify attestation chain
  const chainResult = verifyAttestationChain(allAttestations, rawBody, expectedStageCount)
  if (!chainResult.ok) {
    return { ok: false, code: 'E_CHAIN_INVALID', message: `chain verification: ${chainResult.reason}` }
  }

  // Gate 5: validateSafeText on de-padded raw text
  const rawSafeText: SafeTextV1 = {
    schema: paddedSafeText.schema,
    subject: rawSubject,
    body_text: rawBody,
    attachment_refs: paddedSafeText.attachment_refs,
  }
  const v = validateSafeText(rawSafeText)
  if (!v.ok) {
    return { ok: false, code: 'E_SAFETEXT_REJECTED', message: `safe-text rejected: ${v.reason}` }
  }

  // Gate 6: final raw-text detection
  const rawBodyDetection = detectThreats(rawBody)
  if (!rawBodyDetection.pass) {
    return {
      ok: false,
      code: 'E_CHAIN_INVALID',
      message: `final raw detection on body: ${rawBodyDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }
  const rawSubjectDetection = detectThreats(rawSubject)
  if (!rawSubjectDetection.pass) {
    return {
      ok: false,
      code: 'E_CHAIN_INVALID',
      message: `final raw detection on subject: ${rawSubjectDetection.findings.map((f) => `${f.category}:${f.detail}`).join(', ')}`,
    }
  }

  return { ok: true, rawSafeText: v.value, allAttestations }
}

// ── depackage-email verification ─────────────────────────────────────────────

export type DepackageEmailVerification =
  | { readonly ok: true; readonly output: DepackageEmailResult }
  | {
      readonly ok: false
      readonly code: 'E_SIGNATURE_INVALID' | 'E_SAFETEXT_REJECTED' | 'E_CHAIN_INVALID'
      readonly message: string
    }

/**
 * Verify a `depackage-email` result through the full chain (L3).
 *
 * @param expectedStageCount  Topology-driven. Default 2.
 */
export function verifyDepackageEmailResult(
  r: CriticalJobResult<'depackage-email'>,
  expectedStageCount: number = 2,
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

  const stage1Att = result.stage_attestation
  if (!stage1Att) {
    return { ok: false, code: 'E_CHAIN_INVALID', message: 'missing stage-1 attestation in email result' }
  }

  const paddedSafeText =
    result.type === 'beap-carrier' ? result.carrierSafeText : result.safeText
  if (!paddedSafeText) {
    return { ok: true, output: result }
  }

  const chainResult = runHostFinalStage(paddedSafeText, [stage1Att], expectedStageCount)
  if (!chainResult.ok) {
    return chainResult
  }

  if (result.type === 'beap-carrier') {
    return { ok: true, output: { ...result, carrierSafeText: chainResult.rawSafeText } }
  }
  return { ok: true, output: { ...result, safeText: chainResult.rawSafeText } }
}
