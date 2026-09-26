# WR Code v1.95 Run 3 — Scoped Entry Designation and Combination Expansion

Branch `integration/consolidated-current`; authority
`docs/spec/Annex_XVI_WR_Code_v1.95.pdf` @ SHA256 `064AAD6D…829F` (verified at
run start). Commits: `9f15b96d` (canonical designator + normative model),
`cfcffc5c` (ordered-pair/combination expansion through the gates),
`7b8b79ee` (S\* parent-binding conformance end to end),
`db90b841` (non-destructive persistence pinning).

Note: the order listed an "SD" class; Annex XVI v1.95 defines P/I/C/SP/SI/SC/SE
and no SD. The full annex-defined set is covered.

## Canonical designation model (`entryDesignator.ts`, model doc alongside)

One versioned record derived ONLY inside the pipeline's Gate 3, from the
parsed Run-1 grammar result plus the resolver's verified §XVI.5.10 claim —
never from display strings, never caller-supplied:
`{version, cls, publisher_part, entry_id|null, counterparty_part|null,
receiving_party|null, parent{cls, publisher_part, counterparty_part}|null}`.
The DB key (`wrd1|…`) is positional and escape-encoded: class, role order,
receiving party, and the full parent binding all participate, so C/I/S\*
never alias, a reversed pair is a distinct identity, and the same child-local
id under two parents is two entries. Normative mapping is documented in
`entry-designation-model-v195.md` before the code (order §1).

## Ordered-pair semantics (C)

C is looked up by the ordered pair (initiator namespace + responder id). The
resolver's designation carries explicit roles (`initiator_part`,
`counterparty_part`); the reference's positions must match them exactly.
Same participants with swapped roles → `invalid_role_ordering` (never
sorted, never silently accepted); any other role/pair difference →
`designation_mismatch`; a missing role → `missing_pair_component`. Gate 2
still verifies BOTH namespaces from the reference itself.

## Combination expansion and S\* parent binding

Per §XVI.5.10 the resolver alone expands a combination block; the trusted
boundary never derives it locally. Carrier: a publisher-signed `designation`
block on the entry object (covered by publisher signature, ingest
countersignature, Merkle inclusion under the verified head); the lookup key
is the combination block, the returned `entry_id` is the expanded entry
constituent. Class-fixed parents enforced: SP→P, SI→I, SC→C (responder
namespace resolved and ACTIVE, parent pair entry in a governing state —
"an ESTABLISHED C relationship whose two namespaces have themselves passed"
verification), SE→any of P/I/C/SP/SI/SC, I/C/P→no parent. The receiving-party
constituent is matched at Gate 4 at the issuer-bound granularity: publisher /
principal / device, with `NOT_FOR_THIS_DEVICE` for a sibling device of the
same principal. A resolver answer with no expansion refuses closed
(`designation_mismatch`) — exactly where Run 2's placeholder used to refuse
with `entry_verification_unavailable`.

## Persistence

No schema change and no migration: the canonical key is TEXT in the existing
`wrc_entry_use_state.entry_id` column. P designators keep the bare local id —
byte-identical to every key Run 2 wrote — so existing lifecycle/use-limit
rows stay attached; the `wrd1|` family contains separators no bare local can
contain, so the two key families cannot collide. Legacy-format rows
(`WR_CODE_LEGACY_FORMAT` shim) untouched; identifiers never reissued.

## New reason codes (all Gate 3)

`missing_pair_component`, `invalid_role_ordering`, `invalid_parent_class`,
`designation_mismatch`, `unsupported_combination` (pure derivation) and
`unresolved_parent` (network leg: parent entry missing/not governing,
responder namespace unresolvable/inactive).

## Test vectors (all new, table-driven where applicable)

- `entryDesignator.test.ts` — 35 unit vectors: per-class derivation, every
  failure reason, key determinism/collision/escaping, Run-2 key compat.
- `entryDesignation.e2e.test.ts` — 15 end-to-end vectors over TWO signing
  publisher fixtures (shared ingest key) and the real six-gate pipeline:
  valid C, reversed pair, SC/SP/SI/SE parent-child, unresolved parent (entry
  and responder namespace), invalid parent class, duplicate child-local id
  under two parents, Gate-4 granularities, lifecycle lookup / one-time-use
  claim / two racing claims (one winner, loser `CLAIMED_BY_OTHER`) through
  expanded designation, P non-interference regression.
- `useLimitStore.test.ts` +3 — native-DB persistence of designator keys and
  Run-2 row attachment (all 27 pass under the sanctioned native-db runner).
- Updated: 3 Run-2 stub vectors that exercised the removed placeholder.

## Invariants held

Run-1 grammar untouched; six-gate order, lifecycle semantics, §XVI.8.4
semantics and claim CAS unchanged (only the KEY is now the canonical
designator); preview/consent hash composition untouched; Gate-2 interim
Directory seam intact (the designation carrier swaps with the directory);
sentinel suite untouched.

## Remaining attachment points (Run 4+)

- Directory/SSO (§XVI.6.4/6.5): designation carrier moves with the directory
  swap inside the adapter; Gate-2 attestation legs.
- SE bounded lifecycle (§XVI.5.7): session/expiry enforcement beyond parent
  binding; SE parent "established handshake" verification needs §XVI.13.x
  handshake state, currently structural + parent-entry existence only.
- Registered Counterpart Device for SC device-granularity (Device Pass,
  §XVI.13.7); pairing-slot I flow (consume_at = acceptance is expressible,
  not yet wired to pairing).
- Gate 5 relay-backed recipient-bound release; Gate 6 capsule chain.
