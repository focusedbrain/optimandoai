# WR Code Entry-Designation Model — Annex XVI v1.95 (Run 3, normative mapping)

Authority: `docs/spec/Annex_XVI_WR_Code_v1.95.pdf`
(SHA256 `064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F`),
§XVI.5.10 (class semantics, combination code, known-identifier rule),
§XVI.5.11 (generalized reference structure), §XVI.6.x "Entry context,
assignment, and version", §XVI.7.6 Gate 3. This file documents the normative
mapping BEFORE implementation; the implementation is
`electron/main/wrc/entryDesignator.ts`, and the two must not diverge.

Note: the Run-3 order lists an "SD" class. Annex XVI v1.95 defines
P / I / C / SP / SI / SC / SE and no SD; the mapping below covers the full
annex-defined set.

## Fields participating in Entry identity, per class (§XVI.5.10)

| Class | Block 2 (namespace)        | Block 3                                | Entry identity |
|-------|----------------------------|----------------------------------------|----------------|
| P     | publisher                  | local block (unaddressed entry)        | (P, publisher, local) |
| C     | **initiator** publisher id | **responder** publisher id (plain)     | (C, ordered pair initiator→responder). The pair NAMES the umbrella entry; ordering is normative — "named by the ordered pair initiator/responder Publisher Identifiers". |
| I     | tenant publisher id        | combination code                       | (I, tenant, expanded internal-context entry, receiving party). "There is no unaddressed internal offering." |
| SP    | publisher (P parent)       | combination code                       | (SP, publisher, expanded entry, receiving party) under parent class **P**. |
| SI    | tenant (I umbrella)        | combination code                       | (SI, tenant, expanded entry, receiving party at principal or device granularity) under parent class **I**. |
| SC    | **initiator** of the pair  | combination code                       | (SC, initiator, expanded entry, responder as receiving party) under parent class **C** — "an ESTABLISHED C relationship whose two namespaces have themselves passed account-holder and DNS verification". |
| SE    | parent namespace           | combination code                       | (SE, publisher, expanded entry, receiving party) "beneath an established parent handshake of any class"; bounded lifecycle, never durable, never reissued (§XVI.5.7). |

## Combination code (§XVI.5.10 "Third block of sub-handshake references")

The third block of I and every S\* reference is NOT a free-standing entry id.
It is a publisher-issued six-symbol block that jointly encodes (a) the WR
Entry and (b) the receiving party's identifier. Derivation is
publisher-internal; **the resolver alone expands the block**, and the
expansion is released only within the applicable grant. Consequences the
implementation must honor:

- Local derivation of the expansion is impossible and prohibited — the
  trusted boundary obtains it from the resolver and VERIFIES it ("the
  verifications do not disappear because two identifiers were collapsed into
  one block; they are performed on the expanded form").
- Two sub-handshakes for the same entry toward different parties, or
  different entries toward the same party, have different combination codes —
  the addressable thing is the BINDING (entry + receiving party), so both
  constituents are part of canonical identity.
- Receiving-party granularity is principal or one Device-Scoped Principal
  Identifier (device targeting rides on the constituent's granularity, never
  on a third constituent).

## Canonical Entry Designator (implementation shape)

One deterministic record derived INSIDE the trusted resolution boundary from
the parsed Run-1 grammar result plus the resolver's verified designation
claim — never from display strings, never caller-supplied:

    { version: 1, cls, publisher_part, entry_id | null,
      counterparty_part | null, receiving_party {kind,id} | null,
      parent {cls, publisher_part, counterparty_part|null} | null }

- P: entry_id = local block; everything else null.
- C: entry_id null (the pair names the entry); counterparty_part = responder.
- I: entry_id = expanded entry constituent; receiving_party required;
  no parent (the umbrella is the root).
- SP/SI/SC/SE: entry_id = expanded entry constituent; receiving_party
  required; parent required with the class-fixed parent class (SP→P, SI→I,
  SC→C with counterparty, SE→any of P/I/C/SP/SI/SC).

The database key is a versioned, positional, escaped encoding of these
fields (`wrd1|…`). Class participates in the key (no C/I/S\* aliasing);
parent participates in the key (the same child-local identifier under two
distinct parents is two distinct entries); role order participates for C.

## Verification obligations at Gate 3 (§XVI.6.x, §XVI.7.6)

1. Entry context exists in the publisher's repository and matches the
   registered assignment exactly — "same parent context, same object, same
   relationship, same offering"; a mismatch is a verification failure, never
   a soft warning → `designation_mismatch`.
2. C: both namespaces of the pair verified (Gate 2 covers both blocks); the
   repository's registered pair must match the reference's roles —
   swapped roles → `invalid_role_ordering`.
3. Sub-handshake classes: the combination code is expanded by the resolver
   and BOTH constituents verified — the entry constituent must resolve to an
   existing entry binding under a currently governing parent
   (→ `unresolved_parent` when the parent does not resolve or is not in a
   governing state; `invalid_parent_class` when the declared parent violates
   the class-fixed rule), and the receiving-party constituent must resolve to
   the verified party the code is addressed to (self-match remains Gate 4:
   NOT_FOR_YOU / NOT_FOR_THIS_DEVICE).
4. Missing constituents of the pair/combination → `missing_pair_component`;
   an expansion the model cannot express → `unsupported_combination`.

## Interim carrier (Phase-3 seam, consistent with the Run-2 anchor)

The resolver's expansion answer rides as a publisher-signed `designation`
block ON the entry object (inside the existing envelope: publisher signature,
ingest countersignature, Merkle inclusion under the verified head). The
resolver lookup key is class-determined: local (P), responder id (C pair),
combination block (I/S\*). The returned entry's `entry_id` is the expanded
entry constituent. TODO(§XVI.6.4/6.5): when the Namespace Directory lands,
the expansion moves with the directory swap; the designator model above is
carrier-independent.
