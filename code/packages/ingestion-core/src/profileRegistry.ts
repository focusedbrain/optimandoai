/**
 * WR Handshake profile registry with fail-closed dispatch
 * (Phase 3 — B1–B4, B7) [VII.4.1–4.2]
 *
 * Profiles are REGISTRY RECORDS, not code branches. Each record fixes the
 * complete admission situation: identifier + version, mandatory/forbidden
 * core content, permitted ingress paths, role symmetry, signature
 * cardinality (parameterizing the Phase-2 signature-list verification),
 * permitted grant vocabularies, and attestation requirements.
 *
 * Dispatch is FAIL-CLOSED: an unknown profile id or an unsupported profile
 * version produces a visible refusal — there is no fallback profile and no
 * default branch [VII.4.2].
 *
 * There is NO profile conversion/upgrade path [VII.4.7]: profile is
 * immutable inside the signed core [VII.3.3]; any "convert relationship"
 * flow must be a new handshake. `optirando.handshake.prior_ref` stays
 * reserved-inert (see containers.ts RESERVED_NAMESPACES).
 */

// ── Record model ──────────────────────────────────────────────────────────────

/** Namespace that carries a publisher attestation block inside a core container. */
export const PUBLISHER_ATTESTATION_NS = 'optirando.attestation.publisher'

export interface WrProfileRecord {
  /** Profile identifier — the value carried in the signed core's `profile.id`. */
  id: string
  /** Supported version of this profile record. */
  version: number
  /**
   * Role symmetry [VII.4.2 table]: symmetric profiles bind two peers of the
   * same kind; asymmetric profiles bind publisher → subscriber.
   */
  role_symmetry: 'symmetric' | 'asymmetric'
  /**
   * Signature cardinality: how many distinct valid signatures the core's
   * ordered signature list must carry for the handshake to count as
   * established. 2 ⇒ countersigned byte-identical core [VII.3.2].
   */
  signature_cardinality: 1 | 2
  /** Whether establishment additionally requires recorded mutual consent. */
  mutual_consent_required: boolean
  /**
   * Publisher attestation requirement [VII.4.5]:
   *  - 'mandatory'  → core MUST carry a publisher_attestation container entry
   *  - 'forbidden'  → core carrying one is rejected AT SCHEMA LEVEL
   *  - 'optional'   → permitted, not required
   */
  attestation: 'mandatory' | 'forbidden' | 'optional'
  /**
   * Permitted ingress paths for NEW formations under this profile
   * (registry identifiers from ingressRegistry.ts); null = any registered
   * path. LOG-ONLY at runtime [VII.4.6] — this list gates formation-time
   * recording (Phase 4), never message semantics.
   */
  permitted_ingress_paths: readonly string[] | null
  /** Grant vocabularies this profile may carry (reserved-inert until Phase 5). */
  permitted_grant_vocabularies: readonly string[]
  /**
   * Q2: legacy profile records stay operational but are FROZEN for new grant
   * types — no new grant vocabulary may attach to them.
   */
  frozen_for_new_grant_types: boolean
  /** Human-readable admission-situation label (UI rendering only). */
  display_label: string
}

// ── Registry content (initial five records) ──────────────────────────────────

const RECORDS: readonly WrProfileRecord[] = Object.freeze([
  {
    // Asymmetric publisher → subscriber; attestation mandatory [VII.4.2 table].
    id: 'pbeap_publisher',
    version: 1,
    role_symmetry: 'asymmetric',
    signature_cardinality: 1,
    mutual_consent_required: false,
    attestation: 'mandatory',
    permitted_ingress_paths: ['wr_code_public', 'wr_ad'],
    permitted_grant_vocabularies: [],
    frozen_for_new_grant_types: false,
    display_label: 'Publisher (PBEAP)',
  },
  {
    // Symmetric person↔person; attestation forbidden AT SCHEMA LEVEL [VII.4.5].
    id: 'private_personal',
    version: 1,
    role_symmetry: 'symmetric',
    signature_cardinality: 1,
    mutual_consent_required: true,
    attestation: 'forbidden',
    permitted_ingress_paths: ['wr_code_red', 'beap_invitation', 'relay_code_claim'],
    permitted_grant_vocabularies: [],
    frozen_for_new_grant_types: false,
    display_label: 'Private / personal',
  },
  {
    // Symmetric intra-org; countersigned byte-identical core [VII.3.2].
    id: 'org_internal',
    version: 1,
    role_symmetry: 'symmetric',
    signature_cardinality: 2,
    mutual_consent_required: true,
    attestation: 'optional',
    permitted_ingress_paths: ['wr_code_red', 'beap_invitation', 'relay_code_claim', 'optirando_code_entry'],
    permitted_grant_vocabularies: [],
    frozen_for_new_grant_types: false,
    display_label: 'Organization internal',
  },
  {
    // Symmetric cross-org; two signatures.
    id: 'org_cross',
    version: 1,
    role_symmetry: 'symmetric',
    signature_cardinality: 2,
    mutual_consent_required: true,
    attestation: 'optional',
    permitted_ingress_paths: ['wr_code_red', 'beap_invitation', 'relay_code_claim'],
    permitted_grant_vocabularies: [],
    frozen_for_new_grant_types: false,
    display_label: 'Organization cross',
  },
  {
    // Q2: blesses the historical signature discipline. Migrated/backfilled
    // relationships stay operational with their current rights but are
    // FROZEN for new grant types; no forced re-establishment.
    id: 'legacy_v0',
    version: 1,
    role_symmetry: 'symmetric',
    signature_cardinality: 1,
    mutual_consent_required: false,
    attestation: 'optional',
    permitted_ingress_paths: null,
    permitted_grant_vocabularies: [],
    frozen_for_new_grant_types: true,
    display_label: 'Legacy (pre-registry)',
  },
] satisfies WrProfileRecord[])

const BY_ID = new Map<string, WrProfileRecord[]>()
for (const record of RECORDS) {
  const list = BY_ID.get(record.id) ?? []
  list.push(record)
  BY_ID.set(record.id, list)
}

/** All registered records (read-only view; UI/registry listings). */
export function listProfileRecords(): readonly WrProfileRecord[] {
  return RECORDS
}

// ── Fail-closed dispatch [VII.4.2] ────────────────────────────────────────────

export type ProfileResolution =
  | { ok: true; record: WrProfileRecord }
  | {
      ok: false
      reason: 'unknown_profile' | 'unsupported_profile_version'
      /** Named in the visible refusal. */
      profileId: string
      profileVersion: number
    }

/**
 * Resolve a `{id, version}` profile reference to its registry record.
 * Unknown id or unsupported version → refusal; NO fallback path exists.
 */
export function resolveProfile(profileId: string, profileVersion: number): ProfileResolution {
  const versions = BY_ID.get(profileId)
  if (!versions || versions.length === 0) {
    return { ok: false, reason: 'unknown_profile', profileId, profileVersion }
  }
  const record = versions.find((r) => r.version === profileVersion)
  if (!record) {
    return { ok: false, reason: 'unsupported_profile_version', profileId, profileVersion }
  }
  return { ok: true, record }
}

// ── Schema-level container rules [VII.4.5] ────────────────────────────────────

export type ProfileContainerVerdict =
  | { ok: true }
  | {
      ok: false
      reason: 'attestation_forbidden_for_profile' | 'attestation_missing_for_profile'
      profileId: string
    }

/**
 * Enforce the profile's attestation requirement against the union of core
 * container namespaces. This is a SCHEMA-level check (runs inside envelope
 * verification), not a UI check: a `private_personal` core carrying a
 * publisher_attestation block is rejected here regardless of any rendering.
 */
export function checkProfileContainerRules(
  record: WrProfileRecord,
  containerNamespaces: readonly string[],
): ProfileContainerVerdict {
  const carriesAttestation = containerNamespaces.includes(PUBLISHER_ATTESTATION_NS)
  if (record.attestation === 'forbidden' && carriesAttestation) {
    return { ok: false, reason: 'attestation_forbidden_for_profile', profileId: record.id }
  }
  if (record.attestation === 'mandatory' && !carriesAttestation) {
    return { ok: false, reason: 'attestation_missing_for_profile', profileId: record.id }
  }
  return { ok: true }
}
