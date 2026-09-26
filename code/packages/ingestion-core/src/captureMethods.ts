/**
 * WR Handshake capture methods + invitation classes (Phase 4 — V2, C1–C3)
 * [IX.3.1, IX.3.2]
 *
 * Capture methods feed the ONE formation pipeline. Every method is a
 * registry entry; unimplemented methods are registered with
 * `shippable: false` and refuse FAIL-CLOSED when a formation attempts to
 * use them — an enum slot is not an implementation.
 *
 * Capture-method values are LOG/RENDER-ONLY beyond the shippable gate
 * [VII.4.6]: no semantic branch may read them; formation via different
 * capture methods yields semantically identical relationships (same
 * profile → same rights).
 */

import { isRecordableIngressPath } from './ingressRegistry.js'

// ── Capture methods ───────────────────────────────────────────────────────────

export type CaptureMethodId = 'scan' | 'manual_entry' | 'assisted_email' | 'assisted_discovery'

export interface CaptureMethodEntry {
  id: CaptureMethodId
  /**
   * Not-yet-shippable methods are enum slots with a fail-closed stub:
   * attempting to form through them refuses; there is no partial path.
   */
  shippable: boolean
  /**
   * Ingress-path identifiers (Q4 mapping) a formation captured via this
   * method may record. Log-only downstream.
   */
  ingress_paths: readonly string[]
  /** Rendering/evidence label only. */
  display_label: string
}

export const CAPTURE_METHOD_REGISTRY: readonly CaptureMethodEntry[] = Object.freeze([
  {
    // Not yet shippable — slot + fail-closed stub.
    id: 'scan',
    shippable: false,
    ingress_paths: ['wr_code_public', 'wr_code_red'],
    display_label: 'WR code scan',
  },
  {
    // Q5: the 6-digit pairing code is interim-conforming as
    // `optirando_code_entry` (Internal / Cross-Device). Manual .beap file
    // import is the same capture family with `optirando.ingress.file_import`.
    id: 'manual_entry',
    shippable: true,
    ingress_paths: ['optirando_code_entry', 'optirando.ingress.file_import'],
    display_label: 'Manual entry',
  },
  {
    // Q6: capsule-by-email remains a legitimate invitation transport for
    // non-Public profiles but ALWAYS terminates in the Connect-offer gate.
    id: 'assisted_email',
    shippable: true,
    ingress_paths: ['beap_invitation'],
    display_label: 'Assisted (email invitation)',
  },
  {
    // Not yet shippable — slot + fail-closed stub.
    id: 'assisted_discovery',
    shippable: false,
    ingress_paths: ['relay_code_claim'],
    display_label: 'Assisted (discovery)',
  },
] satisfies CaptureMethodEntry[])

const BY_ID = new Map(CAPTURE_METHOD_REGISTRY.map((e) => [e.id, e]))

export type CaptureMethodResolution =
  | { ok: true; entry: CaptureMethodEntry }
  | { ok: false; reason: 'unknown_capture_method' | 'capture_method_not_shippable'; captureMethod: string }

/**
 * FAIL-CLOSED resolution for formation use: unknown methods and registered
 * stubs both refuse. There is no fallback method.
 */
export function resolveCaptureMethodForFormation(id: string): CaptureMethodResolution {
  const entry = BY_ID.get(id as CaptureMethodId)
  if (!entry) return { ok: false, reason: 'unknown_capture_method', captureMethod: id }
  if (!entry.shippable) return { ok: false, reason: 'capture_method_not_shippable', captureMethod: id }
  return { ok: true, entry }
}

/**
 * Q4 mapping check: may a formation captured via `method` record
 * `ingressPath`? (Formation-time recording gate only; the recorded value is
 * log-only afterwards.)
 */
export function captureMethodPermitsIngressPath(method: CaptureMethodEntry, ingressPath: string): boolean {
  return method.ingress_paths.includes(ingressPath) && isRecordableIngressPath(ingressPath)
}

// ── Invitation classes [IX.3.2] ───────────────────────────────────────────────

export type InvitationClassId = 'public_bearer' | 'targeted_bound'

export interface InvitationClassEntry {
  id: InvitationClassId
  /** `refusal_only` classes are registered but refuse every formation attempt. */
  implemented: boolean
  display_label: string
}

export const INVITATION_CLASS_REGISTRY: readonly InvitationClassEntry[] = Object.freeze([
  { id: 'public_bearer', implemented: true, display_label: 'Public bearer invitation' },
  // Registered, refusal-only [IX.3.2]; namespace optirando.invitation.targeted_bound
  // stays reserved-inert in containers.ts.
  { id: 'targeted_bound', implemented: false, display_label: 'Targeted bound invitation' },
] satisfies InvitationClassEntry[])

const CLASS_BY_ID = new Map(INVITATION_CLASS_REGISTRY.map((e) => [e.id, e]))

export type InvitationClassResolution =
  | { ok: true; entry: InvitationClassEntry }
  | { ok: false; reason: 'unknown_invitation_class' | 'invitation_class_refusal_only'; invitationClass: string }

/** FAIL-CLOSED: unknown classes and registered refusal-only classes both refuse. */
export function resolveInvitationClassForFormation(id: string): InvitationClassResolution {
  const entry = CLASS_BY_ID.get(id as InvitationClassId)
  if (!entry) return { ok: false, reason: 'unknown_invitation_class', invitationClass: id }
  if (!entry.implemented) return { ok: false, reason: 'invitation_class_refusal_only', invitationClass: id }
  return { ok: true, entry }
}
