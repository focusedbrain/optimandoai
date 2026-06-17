/**
 * Stage attestation types + verification (Phase 1.3).
 *
 * Two-tier hash attestation proving:
 *   (a) content unchanged across all validation stages (canonical-content hash)
 *   (b) all stages ran in the correct order (chained per-stage attestations)
 *
 * TIER 1 — Canonical-content hash (CCH):
 *   SHA-256 of the NFC-normalized, LF-normalized UTF-8 of the ORIGINAL unpadded
 *   text. Normalization matches safeText.ts toPlainTextField (NFC + \r\n?→\n).
 *   Computed once at stage 1 on raw text; forwarded (not recomputed) by later
 *   stages; re-derived by the host on the final de-padded text and compared.
 *
 * TIER 2 — Per-stage proof-of-execution:
 *   Each stage produces an attestation committing to the prior stage's hash,
 *   forming an ordered chain. Stage 1's prior = SHA-256("genesis").
 *
 * Pure crypto (Node SHA-256), no I/O.
 */

import { createHash } from 'node:crypto'

// ── Types ──────────────────────────────────────────────────────────────────

export type DetectionOutcome = 'pass' | 'reject'

export interface StageAttestation {
  readonly stage_id: number
  readonly stage_location: string
  readonly canonical_content_hash: string
  readonly padded_form_hash: string
  readonly detection_result: DetectionOutcome
  readonly prior_attestation_hash: string
  readonly timestamp: number
}

export type VerificationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * The prior_attestation_hash for stage 1 — SHA-256 of the literal string
 * "genesis" encoded as UTF-8.
 */
export const GENESIS_HASH: string = createHash('sha256').update('genesis', 'utf-8').digest('hex')

// ── Canonical-content hash (CCH) ─────────────────────────────────────────

/**
 * Compute the canonical-content hash of unpadded text.
 *
 * Normalization (matches safeText.ts toPlainTextField steps 1–2):
 *   1. Unicode NFC normalization
 *   2. CRLF / CR → LF
 *
 * Then SHA-256 over the UTF-8 encoding.
 *
 * This hash is CONSTANT across all validation stages for the same content —
 * it proves the underlying text was not tampered with between validators.
 */
export function canonicalContentHash(text: string): string {
  let normalized = text
  try {
    normalized = normalized.normalize('NFC')
  } catch {
    /* normalize can throw on lone surrogates; fall through with original */
  }
  normalized = normalized.replace(/\r\n?/g, '\n')
  return createHash('sha256').update(Buffer.from(normalized, 'utf-8')).digest('hex')
}

// ── Attestation hashing (deterministic JSON) ─────────────────────────────

/**
 * Produce a deterministic JSON representation of an attestation with a
 * fixed key order. Used for computing `prior_attestation_hash` in the chain.
 */
function canonicalAttestationJson(att: StageAttestation): string {
  return JSON.stringify({
    stage_id: att.stage_id,
    stage_location: att.stage_location,
    canonical_content_hash: att.canonical_content_hash,
    padded_form_hash: att.padded_form_hash,
    detection_result: att.detection_result,
    prior_attestation_hash: att.prior_attestation_hash,
    timestamp: att.timestamp,
  })
}

/**
 * SHA-256 of the canonical JSON of an attestation.
 * This is the value that the NEXT stage's `prior_attestation_hash` must equal.
 */
export function hashAttestation(att: StageAttestation): string {
  return createHash('sha256').update(canonicalAttestationJson(att), 'utf-8').digest('hex')
}

// ── Attestation creation ─────────────────────────────────────────────────

/**
 * Build a stage attestation.
 *
 * @param stageId        1-indexed stage number.
 * @param stageLocation  Where this stage runs (e.g. 'dedicated_sandbox',
 *                       'host_vm', 'host').
 * @param cch            The canonical-content hash (forwarded from stage 1,
 *                       or freshly computed at stage 1).
 * @param paddedText     The padded text AFTER this stage applied its padding
 *                       layer (SHA-256'd for the attestation).
 * @param priorAttestation  The preceding stage's attestation (null for stage 1,
 *                          which uses GENESIS_HASH).
 * @param timestamp      Epoch milliseconds (defaults to Date.now()).
 */
export function createStageAttestation(
  stageId: number,
  stageLocation: string,
  cch: string,
  paddedText: string,
  priorAttestation: StageAttestation | null,
  timestamp: number = Date.now(),
): StageAttestation {
  const priorHash = priorAttestation === null
    ? GENESIS_HASH
    : hashAttestation(priorAttestation)

  const paddedFormHash = createHash('sha256')
    .update(Buffer.from(paddedText, 'utf-8'))
    .digest('hex')

  return {
    stage_id: stageId,
    stage_location: stageLocation,
    canonical_content_hash: cch,
    padded_form_hash: paddedFormHash,
    detection_result: 'pass',
    prior_attestation_hash: priorHash,
    timestamp,
  }
}

// ── Chain verification ───────────────────────────────────────────────────

/**
 * Verify the full attestation chain at the final (host) stage.
 *
 * Checks (all must pass — fail-closed):
 *   1. Exactly `expectedStageCount` attestations are present.
 *   2. Stage IDs are sequential 1..N.
 *   3. Stage 1's prior_attestation_hash === GENESIS_HASH.
 *   4. Each subsequent stage's prior_attestation_hash ===
 *      SHA-256(canonicalJSON(prior attestation)).
 *   5. All canonical_content_hash values are identical across stages.
 *   6. canonical_content_hash === canonicalContentHash(finalDepaddedText)
 *      (content survived intact through the chain).
 *   7. All detection_result === 'pass'.
 */
export function verifyAttestationChain(
  attestations: readonly StageAttestation[],
  finalDepaddedText: string,
  expectedStageCount: number,
): VerificationResult {
  if (attestations.length !== expectedStageCount) {
    return {
      ok: false,
      reason: `expected ${expectedStageCount} stages, got ${attestations.length}`,
    }
  }

  if (expectedStageCount === 0) {
    return { ok: false, reason: 'expected at least 1 stage' }
  }

  // Check 2: sequential stage IDs 1..N
  for (let i = 0; i < attestations.length; i++) {
    if (attestations[i].stage_id !== i + 1) {
      return {
        ok: false,
        reason: `stage ${i + 1} has stage_id ${attestations[i].stage_id}`,
      }
    }
  }

  // Check 3: all detection_result === 'pass'
  // (checked before chain links: tampering detection_result also breaks the
  // chain hash, but the detection failure is the more informative reason)
  for (let i = 0; i < attestations.length; i++) {
    if (attestations[i].detection_result !== 'pass') {
      return {
        ok: false,
        reason: `stage ${i + 1} detection_result is '${attestations[i].detection_result}', not 'pass'`,
      }
    }
  }

  // Check 4: stage 1 prior === genesis
  if (attestations[0].prior_attestation_hash !== GENESIS_HASH) {
    return { ok: false, reason: 'stage 1 prior_attestation_hash is not genesis' }
  }

  // Check 5: chain links
  for (let i = 1; i < attestations.length; i++) {
    const expectedPrior = hashAttestation(attestations[i - 1])
    if (attestations[i].prior_attestation_hash !== expectedPrior) {
      return {
        ok: false,
        reason: `stage ${i + 1} prior_attestation_hash does not match hash of stage ${i}`,
      }
    }
  }

  // Check 6: all CCH identical
  const cch = attestations[0].canonical_content_hash
  for (let i = 1; i < attestations.length; i++) {
    if (attestations[i].canonical_content_hash !== cch) {
      return {
        ok: false,
        reason: `stage ${i + 1} canonical_content_hash differs from stage 1`,
      }
    }
  }

  // Check 7: CCH === hash of final de-padded text
  const finalHash = canonicalContentHash(finalDepaddedText)
  if (cch !== finalHash) {
    return {
      ok: false,
      reason: 'canonical_content_hash does not match hash of final de-padded text',
    }
  }

  return { ok: true }
}
