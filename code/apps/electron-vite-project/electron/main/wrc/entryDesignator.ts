/**
 * Canonical Entry Designator — Annex XVI v1.95 §XVI.5.10/§XVI.5.11 (Run 3).
 *
 * ONE deterministic representation of "which entry does this reference
 * designate", for every class: single-party (P), ordered-pair (C),
 * combination (I), and parent-bound sub-handshake (SP/SI/SC/SE) identity.
 * The normative mapping is documented in
 * `docs/analysis/annex-xvi-v193/entry-designation-model-v195.md`; this module
 * and that document must not diverge.
 *
 * Two hard properties, enforced structurally:
 *
 *  - EQUIVALENT references collapse: the designator is derived only from the
 *    parsed Run-1 grammar result (already normalization-canonical) and the
 *    resolver's VERIFIED designation claim — never from display strings.
 *  - NON-EQUIVALENT references never alias: class, role order (C), receiving
 *    party, and the full parent binding all participate in the canonical key,
 *    so C/I/S* references cannot collide, a reversed pair is a different
 *    (and refused) designation, and the same child-local identifier beneath
 *    two distinct parents is two distinct entries.
 *
 * Derivation is fail-closed with the Run-3 reason vocabulary:
 * `missing_pair_component`, `invalid_role_ordering`, `invalid_parent_class`,
 * `designation_mismatch`, `unsupported_combination` (`unresolved_parent` is
 * emitted by the network leg in the gate adapter, not here — this module is
 * pure). Callers cannot supply a precomputed designator: the pipeline calls
 * {@link deriveEntryDesignator} itself, inside the trusted boundary.
 */

import type { WrCodeClass, WrCodeReference } from '@repo/ingestion-core'

// ── Designator ────────────────────────────────────────────────────────────────

export type WrCodeReceivingPartyKind = 'publisher' | 'principal' | 'device'

export interface WrCodeReceivingParty {
  kind: WrCodeReceivingPartyKind
  id: string
}

export interface WrCodeParentBinding {
  cls: WrCodeClass
  /** Parent namespace — always the reference's own block 2 (§XVI.5.10). */
  publisher_part: string
  /** SC only: the responder of the governing C pair. */
  counterparty_part: string | null
}

export interface WrCodeEntryDesignator {
  version: 1
  cls: WrCodeClass
  /** Namespace: publisher (P/SP/SE), tenant (I/SI), initiator (C/SC). */
  publisher_part: string
  /**
   * Publisher-local entry: the local block (P) or the expanded entry
   * constituent of the combination code (I/S*). Null for C — the ordered
   * pair itself names the umbrella entry.
   */
  entry_id: string | null
  /** C only: the responder Publisher Identifier. Role order is normative. */
  counterparty_part: string | null
  /** Combination classes: the expanded receiving-party constituent. */
  receiving_party: WrCodeReceivingParty | null
  /** Sub-handshake classes: the class-fixed parent binding. */
  parent: WrCodeParentBinding | null
}

// ── Resolver designation claim (wire shape, verified upstream) ────────────────

/**
 * What the resolver asserts about the entry it returned for a lookup — the
 * expansion of §XVI.5.10 in claim form. Envelope verification (publisher
 * signature, ingest countersignature, Merkle inclusion) has already happened
 * when this reaches derivation; THIS module decides whether the claim is the
 * designation the reference implies.
 */
export interface WrCodeDesignationClaim {
  /** Reference class the resolver says this entry answers. */
  cls: string
  /** I/S*: the combination block this expansion answers. */
  combination?: string | null
  /** C: the registered pair, explicit roles. */
  initiator_part?: string | null
  counterparty_part?: string | null
  /** I/S*: expanded receiving-party constituent. */
  receiving_party?: { kind: string; id: string } | null
  /** S*: parent binding. */
  parent?: {
    cls: string
    publisher_part: string
    counterparty_part?: string | null
    /** Optional repository id of the parent entry, when the resolver names it. */
    entry_id?: string | null
  } | null
}

export type WrCodeDesignationFailureReason =
  | 'missing_pair_component'
  | 'invalid_role_ordering'
  | 'invalid_parent_class'
  | 'designation_mismatch'
  | 'unsupported_combination'

export type WrCodeDesignatorResult =
  | { ok: true; designator: WrCodeEntryDesignator }
  | { ok: false; reason: WrCodeDesignationFailureReason; detail?: string }

const fail = (
  reason: WrCodeDesignationFailureReason,
  detail?: string,
): WrCodeDesignatorResult => ({ ok: false, reason, detail })

/** Class-fixed parent rule (§XVI.5.10). SE: any established parent class; sub-of-SE is not a thing. */
const PARENT_CLASS_OF: Readonly<Record<string, readonly WrCodeClass[]>> = Object.freeze({
  SP: Object.freeze(['P'] as const),
  SI: Object.freeze(['I'] as const),
  SC: Object.freeze(['C'] as const),
  SE: Object.freeze(['P', 'I', 'C', 'SP', 'SI', 'SC'] as const),
})

const COMBINATION_CLASSES: ReadonlySet<string> = new Set(['I', 'SP', 'SI', 'SC', 'SE'])

const RECEIVING_PARTY_KINDS: ReadonlySet<string> = new Set(['publisher', 'principal', 'device'])

// ── Derivation ────────────────────────────────────────────────────────────────

/**
 * Derive the canonical designator for `reference` from the resolver's
 * verified `claim` and the verified entry's own id (`entryId` — the expanded
 * entry constituent for combination lookups, the repository id otherwise).
 *
 * Every path that does not end in a full designator returns a typed refusal;
 * nothing is defaulted, sorted, or reinterpreted.
 */
export function deriveEntryDesignator(
  reference: WrCodeReference,
  claim: WrCodeDesignationClaim | null,
  entryId: string,
): WrCodeDesignatorResult {
  switch (reference.cls) {
    case 'P': {
      // Unaddressed local entry. A designation claim is optional; when the
      // resolver states one it must say P and carry no pair/parent baggage.
      if (claim) {
        if (claim.cls !== 'P') {
          return fail('designation_mismatch', `resolver says class ${claim.cls}, reference is P`)
        }
        if (claim.parent) return fail('invalid_parent_class', 'P entries have no parent binding')
      }
      if (!reference.local) return fail('missing_pair_component', 'P reference without local block')
      return {
        ok: true,
        designator: {
          version: 1,
          cls: 'P',
          publisher_part: reference.publisher,
          entry_id: reference.local,
          counterparty_part: null,
          receiving_party: null,
          parent: null,
        },
      }
    }

    case 'C': {
      // Named by the ordered pair initiator/responder (§XVI.5.10) — the
      // repository's registered roles must match the reference's positions.
      if (!reference.counterparty) {
        return fail('missing_pair_component', 'C reference without counterparty block')
      }
      if (!claim) return fail('designation_mismatch', 'resolver returned no designation for a C pair')
      if (claim.cls !== 'C') {
        return fail('designation_mismatch', `resolver says class ${claim.cls}, reference is C`)
      }
      if (claim.parent) return fail('invalid_parent_class', 'a C umbrella has no parent binding')
      const initiator = claim.initiator_part ?? null
      const responder = claim.counterparty_part ?? null
      if (!initiator || !responder) {
        return fail('missing_pair_component', 'registered pair is missing a role')
      }
      if (initiator === reference.counterparty && responder === reference.publisher) {
        // Same participants, opposite roles: a DIFFERENT designation, never
        // silently accepted (roles are not sortable).
        return fail('invalid_role_ordering', `registered pair is ${initiator}→${responder}`)
      }
      if (initiator !== reference.publisher || responder !== reference.counterparty) {
        return fail(
          'designation_mismatch',
          `registered pair ${initiator}→${responder} does not match the reference`,
        )
      }
      return {
        ok: true,
        designator: {
          version: 1,
          cls: 'C',
          publisher_part: reference.publisher,
          entry_id: null,
          counterparty_part: reference.counterparty,
          receiving_party: null,
          parent: null,
        },
      }
    }

    default: {
      // I and every sub-handshake class: the third block is a combination
      // code the RESOLVER expanded (§XVI.5.10); both constituents must be
      // present, and the parent must obey the class-fixed rule.
      if (!COMBINATION_CLASSES.has(reference.cls)) {
        return fail('unsupported_combination', `class ${reference.cls} has no designation rule`)
      }
      if (!reference.combination) {
        return fail('missing_pair_component', `${reference.cls} reference without combination block`)
      }
      if (!claim) {
        return fail('designation_mismatch', 'resolver returned no expansion for a combination code')
      }
      if (claim.cls !== reference.cls) {
        return fail(
          'designation_mismatch',
          `resolver says class ${claim.cls}, reference is ${reference.cls}`,
        )
      }
      if ((claim.combination ?? null) !== reference.combination) {
        return fail(
          'designation_mismatch',
          'expansion answers a different combination block than the reference carries',
        )
      }
      // Entry constituent — the verified entry's own id.
      if (!entryId) return fail('missing_pair_component', 'expansion carries no entry constituent')
      // Receiving-party constituent.
      const rp = claim.receiving_party ?? null
      if (!rp || !rp.id) {
        return fail('missing_pair_component', 'expansion carries no receiving-party constituent')
      }
      if (!RECEIVING_PARTY_KINDS.has(rp.kind)) {
        return fail('unsupported_combination', `receiving-party kind ${rp.kind}`)
      }

      // Parent binding.
      const allowedParents = PARENT_CLASS_OF[reference.cls]
      const parent = claim.parent ?? null
      if (reference.cls === 'I') {
        // The I umbrella is the root of its hierarchy — a parent claim is a
        // model violation, not extra information.
        if (parent) return fail('invalid_parent_class', 'an I umbrella has no parent binding')
        return {
          ok: true,
          designator: {
            version: 1,
            cls: 'I',
            publisher_part: reference.publisher,
            entry_id: entryId,
            counterparty_part: null,
            receiving_party: { kind: rp.kind as WrCodeReceivingPartyKind, id: rp.id },
            parent: null,
          },
        }
      }
      if (!parent) {
        return fail('invalid_parent_class', `${reference.cls} requires a parent binding`)
      }
      if (!allowedParents!.includes(parent.cls as WrCodeClass)) {
        return fail(
          'invalid_parent_class',
          `${reference.cls} beneath ${parent.cls}; allowed: ${allowedParents!.join(', ')}`,
        )
      }
      if (parent.publisher_part !== reference.publisher) {
        // §XVI.5.10: the sub-handshake's namespace block IS the parent's
        // namespace (publisher / tenant / initiator). A parent in a foreign
        // namespace is not this reference's parent.
        return fail(
          'designation_mismatch',
          `parent namespace ${parent.publisher_part} is not the reference namespace`,
        )
      }
      const parentCounterparty = parent.counterparty_part ?? null
      if (parent.cls === 'C' && !parentCounterparty) {
        return fail('missing_pair_component', 'a C parent requires its responder identifier')
      }
      if (parent.cls !== 'C' && parentCounterparty) {
        return fail('designation_mismatch', `a ${parent.cls} parent carries no counterparty`)
      }
      // SC: the receiving party is the responder organization (§XVI.5.10) —
      // unless the issuer bound a Registered Counterpart Device.
      if (reference.cls === 'SC' && rp.kind === 'publisher' && rp.id !== parentCounterparty) {
        return fail(
          'designation_mismatch',
          'SC receiving party must be the responder of the governing pair',
        )
      }
      return {
        ok: true,
        designator: {
          version: 1,
          cls: reference.cls,
          publisher_part: reference.publisher,
          entry_id: entryId,
          counterparty_part: null,
          receiving_party: { kind: rp.kind as WrCodeReceivingPartyKind, id: rp.id },
          parent: {
            cls: parent.cls as WrCodeClass,
            publisher_part: parent.publisher_part,
            counterparty_part: parentCounterparty,
          },
        },
      }
    }
  }
}

// ── Canonical key ─────────────────────────────────────────────────────────────

/** Free-text fields (party ids) are escaped so no value can forge a separator. */
function esc(v: string): string {
  return encodeURIComponent(v)
}

/**
 * Deterministic, collision-resistant key for native-DB identity. Versioned
 * (`wrd1`), positional, every identity field present (empty ≠ absent is not a
 * distinction the model uses). Never build this from a display string.
 */
export function designatorKey(d: WrCodeEntryDesignator): string {
  const rp = d.receiving_party ? `${d.receiving_party.kind}=${esc(d.receiving_party.id)}` : ''
  const parent = d.parent
    ? `${d.parent.cls}/${esc(d.parent.publisher_part)}/${d.parent.counterparty_part ? esc(d.parent.counterparty_part) : ''}`
    : ''
  return [
    'wrd1',
    d.cls,
    esc(d.publisher_part),
    `e:${d.entry_id ? esc(d.entry_id) : ''}`,
    `c:${d.counterparty_part ? esc(d.counterparty_part) : ''}`,
    `r:${rp}`,
    `p:${parent}`,
  ].join('|')
}

/**
 * §XVI.8.4 store key beneath the designator's namespace. P entries keep the
 * bare local id — exactly the key Run 2 wrote, so existing lifecycle and
 * use-limit rows stay attached to the correct canonical entry without any
 * migration. Every other class uses the full canonical key, which contains
 * separators no bare P local can contain — the two key families cannot alias.
 */
export function useLimitEntryKey(d: WrCodeEntryDesignator): string {
  if (d.cls === 'P' && !d.parent && d.entry_id) return d.entry_id
  return designatorKey(d)
}
