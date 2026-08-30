/**
 * WR Code® detection for the e-mail slice — Annex XVI v1.95 §XVI.7.5 (linkless
 * email carrier), grammar version 2.
 *
 * A plain e-mail body is scanned for textual references of every class
 * (P/I/C/SP/SI/SC/SE, prefix-aware) with the ingestion-core detector; only
 * check-verified candidates ever leave the scanner. The verdicts are merged
 * into the message's `depackaged_metadata` blob, which is BOUND INTO THE SEAL
 * beside the Channel Provenance Record — so a stored detection can no more be
 * edited after the fact than the channel verdict can.
 *
 * What a detection is NOT: it is not a submission, not a resolution, and not
 * an affordance by itself. §XVI.5.8 keeps completeness, submission, and
 * verification apart — a detected candidate is DISPLAY material for a capture
 * indicator until an explicit act submits it.
 *
 * The caller (messageRouter) runs this ONLY for a channel-authenticated
 * message, in the same structural position as BEAP carrier detection: when
 * `channel_pass` fails, this code is never reached rather than its result
 * being discarded.
 *
 * TODO [XVI.7.7]: capture-indicator surface + SUBMITTED state for detected
 *   candidates (explicit submission act; out of scope for this run).
 * TODO [XVI.7.6]: the six admission gates run at submission, not detection.
 * TODO [XVI.8.4]: one-time-use enforcement is resolver/grant state, never
 *   detection state.
 */

import { detectWrCodeReferences, type WrCodeClass } from '@repo/ingestion-core'

/** Metadata key under which detections live in `depackaged_metadata`. */
export const WR_CODE_DETECTION_METADATA_KEY = 'wr_code_detections'

/** Persisted per-detection verdict: identifier material only, never carrier bytes. */
export interface WrCodeEmailDetection {
  /** Grammar-v2 canonical (prefix + normalized body + check, ungrouped). */
  canonical: string
  cls: WrCodeClass
  /** Locally regenerated §XVI.5.1 grouping — NOT the carrier's rendering (P12). */
  display: string
  publisher: string
}

/**
 * Scan a plain e-mail body. Every entry is check-verified and re-framed from
 * the capture gate; a near-miss or old-format code contributes nothing.
 */
export function detectWrCodeReferencesInEmailBody(bodyText: string): WrCodeEmailDetection[] {
  return detectWrCodeReferences(bodyText ?? '').map((d) => ({
    canonical: d.reference.canonical,
    cls: d.reference.cls,
    display: d.reference.display,
    publisher: d.reference.publisher,
  }))
}

/**
 * Merge detections into a `depackaged_metadata` JSON blob (same contract as
 * `mergeChannelProvenanceMetadata`: unreadable existing metadata is kept under
 * a quarantine key, never dropped). No detections ⇒ the blob passes through
 * unchanged, so pre-existing rows and no-hit messages are byte-identical to
 * before this feature existed.
 */
export function mergeWrCodeDetectionMetadata(
  existingMetadataJson: string | null | undefined,
  detections: readonly WrCodeEmailDetection[],
): string | null {
  if (detections.length === 0) return existingMetadataJson ?? null
  let base: Record<string, unknown> = {}
  if (typeof existingMetadataJson === 'string' && existingMetadataJson.trim() !== '') {
    try {
      const parsed = JSON.parse(existingMetadataJson)
      if (typeof parsed === 'object' && parsed !== null) base = parsed as Record<string, unknown>
      else base = { unparsable_metadata: existingMetadataJson }
    } catch {
      base = { unparsable_metadata: existingMetadataJson }
    }
  }
  base[WR_CODE_DETECTION_METADATA_KEY] = detections
  return JSON.stringify(base)
}

/** Typed reader for consumers of persisted rows (capture indicator, tests). */
export function readWrCodeDetectionMetadata(
  metadataJson: string | null | undefined,
): WrCodeEmailDetection[] {
  if (typeof metadataJson !== 'string' || metadataJson.trim() === '') return []
  try {
    const parsed = JSON.parse(metadataJson) as Record<string, unknown>
    const raw = parsed?.[WR_CODE_DETECTION_METADATA_KEY]
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is WrCodeEmailDetection =>
        typeof e === 'object' && e !== null &&
        typeof (e as WrCodeEmailDetection).canonical === 'string' &&
        typeof (e as WrCodeEmailDetection).cls === 'string' &&
        typeof (e as WrCodeEmailDetection).display === 'string' &&
        typeof (e as WrCodeEmailDetection).publisher === 'string',
    )
  } catch {
    return []
  }
}
