/**
 * Stage-1 validation gate (inside the sandbox boundary).
 *
 * After a depackage worker constructs a SafeTextV1, this function runs
 * the first stage of the validation chain: threat detection on raw text,
 * padding, and attestation creation. The result carries padded text +
 * a stage-1 attestation that proves detection passed and binds the content
 * to a canonical-content hash (CCH).
 *
 * Shared by both B1 `depackage` and B2 `depackage-email` workers.
 *
 * COVERAGE DECISION (subject vs body):
 *   The CCH tracks body_text only (the primary security surface; subject
 *   is already length-bounded by constructSafeText to 2000 chars).
 *   Detection runs on BOTH body_text AND subject — any finding in either
 *   field fails closed. Padding is applied to both fields independently.
 */

import { pad } from './padTransform'
import { detectThreats } from './paddingAwareDetection'
import {
  canonicalContentHash,
  createStageAttestation,
  type StageAttestation,
} from './stageAttestation'
import type { SafeTextV1 } from './safeText'

export class Stage1DetectionError extends Error {
  readonly code = 'E_STAGE1_DETECTION' as const
  constructor(
    readonly field: 'body_text' | 'subject',
    readonly findings: readonly { category: string; detail: string }[],
  ) {
    super(
      `stage-1 detection on ${field}: ${findings.length} threat(s): ` +
        findings.map((f) => `${f.category}:${f.detail}`).join(', '),
    )
    this.name = 'Stage1DetectionError'
  }
}

export interface Stage1Result {
  readonly paddedSafeText: SafeTextV1
  readonly attestation: StageAttestation
}

/**
 * Apply stage-1 of the validation chain to a constructed SafeTextV1.
 *
 * 1. Detect threats on RAW body_text and subject. Fail closed on any finding.
 * 2. Compute CCH on raw body_text (the chain's content binding).
 * 3. Pad body_text and subject independently.
 * 4. Create stage-1 attestation (genesis prior, padded_form_hash of body, pass).
 *
 * @param safeText       The raw (unpadded) SafeTextV1 from constructSafeText.
 * @param stageLocation  Where this stage runs (e.g. 'crosvm-guest', 'sandbox-worker').
 * @throws Stage1DetectionError if detection finds any threat (fail closed).
 */
export function applyStage1Validation(
  safeText: SafeTextV1,
  stageLocation: string = 'sandbox-worker',
): Stage1Result {
  const bodyDetection = detectThreats(safeText.body_text)
  if (!bodyDetection.pass) {
    throw new Stage1DetectionError('body_text', bodyDetection.findings)
  }
  const subjectDetection = detectThreats(safeText.subject)
  if (!subjectDetection.pass) {
    throw new Stage1DetectionError('subject', subjectDetection.findings)
  }

  const cch = canonicalContentHash(safeText.body_text)

  const paddedBodyText = pad(safeText.body_text)
  const paddedSubject = pad(safeText.subject)

  const paddedSafeText: SafeTextV1 = {
    ...safeText,
    body_text: paddedBodyText,
    subject: paddedSubject,
  }

  const attestation = createStageAttestation(
    1,
    stageLocation,
    cch,
    paddedBodyText,
    null,
  )

  return { paddedSafeText, attestation }
}
