/**
 * WR Code® reference scan of an e-mail body — Annex XVI v1.95, grammar version 2.
 *
 * EXPLICIT TRIGGER ONLY. Annex XVI §XVI.3 and §XVI.7.4a: automatic detection
 * (and auto-insertion) from a web page or an e-mail requires that the
 * reference was placed there through the signed WR script block; loose
 * textual references remain capturable manually and are verified like any
 * other capture, but are never auto-detected. Ingest therefore never calls
 * this module — the only caller is a user-initiated scan
 * (`wrc.detectReferences`), whose candidates the user then submits through
 * `wrc.submitReference` and the one §XVI.7.6 pipeline.
 *
 * The scan is pure and local: prefix-aware, length-bounded, and every
 * candidate is re-framed by the grammar-v2 capture gate, so only
 * check-verified references are returned. A near-miss or old-format code
 * contributes nothing. A returned candidate is display material, never a
 * submission, resolution, or affordance by itself (§XVI.5.8).
 */

import { detectWrCodeReferences, type WrCodeClass } from '@repo/ingestion-core'

/** One check-verified candidate: identifier material only, never carrier bytes. */
export interface WrCodeEmailDetection {
  /** Grammar-v2 canonical (prefix + normalized body + check, ungrouped). */
  canonical: string
  cls: WrCodeClass
  /** Locally regenerated §XVI.5.1 grouping — NOT the carrier's rendering (P12). */
  display: string
  publisher: string
}

/** Scan a plain-text body on explicit user request. */
export function detectWrCodeReferencesInEmailBody(bodyText: string): WrCodeEmailDetection[] {
  return detectWrCodeReferences(bodyText ?? '').map((d) => ({
    canonical: d.reference.canonical,
    cls: d.reference.cls,
    display: d.reference.display,
    publisher: d.reference.publisher,
  }))
}
