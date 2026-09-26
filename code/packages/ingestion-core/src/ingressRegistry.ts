/**
 * WR Handshake ingress_path registry (Phase 3 — Q4 groundwork) [VII.4.6]
 *
 * Registry of the identifiers a formation MAY record as its `ingress_path`.
 * The field is LOG-ONLY forever — no semantic branch may read it (guarded by
 * ingressPathLogOnly.guard.test.ts); formation via different paths yields
 * semantically identical relationships.
 *
 * Values are recorded on NEW formations only from Phase 4 onward (the one
 * pipeline writes them per the Q4 mapping); backfilled rows keep
 * `ingress_path = null` with capture provenance `unknown_legacy` — never a
 * fabricated value.
 */

export interface IngressPathEntry {
  id: string
  /** Reserved entries are registered but not yet recordable by any pipeline. */
  reserved: boolean
  /** Rendering/evidence label only. */
  display_label: string
}

export const INGRESS_PATH_REGISTRY: readonly IngressPathEntry[] = Object.freeze([
  { id: 'wr_code_public', reserved: false, display_label: 'Public WR code scan' },
  { id: 'wr_code_red', reserved: false, display_label: 'Red WR code scan' },
  { id: 'beap_invitation', reserved: false, display_label: 'BEAP invitation (email/relay)' },
  { id: 'relay_code_claim', reserved: false, display_label: 'Relay code claim' },
  { id: 'optirando_code_entry', reserved: false, display_label: 'Manual code entry (6-digit pairing)' },
  { id: 'wr_ad', reserved: true, display_label: 'WR ad (reserved)' },
  { id: 'optirando.ingress.file_import', reserved: false, display_label: '.beap file import' },
] satisfies IngressPathEntry[])

const IDS = new Set(INGRESS_PATH_REGISTRY.map((e) => e.id))

/** Structural validity: is this a registered ingress identifier? */
export function isRegisteredIngressPath(id: string): boolean {
  return IDS.has(id)
}

/** Recordable = registered and not reserved (Phase-4 pipeline writes only these). */
export function isRecordableIngressPath(id: string): boolean {
  const entry = INGRESS_PATH_REGISTRY.find((e) => e.id === id)
  return !!entry && !entry.reserved
}
