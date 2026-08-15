# WR Code / Public Handshake — Email E2E Slice
## Phase 4 report — Entry lifecycle and offer schema

| | |
|---|---|
| Branch | `integration/consolidated-current` (single-branch workflow) |
| Baseline | `56dbf7c2` (pre-block-complete tip) |
| Build items | 7 (entry status model), 8 (offer schema + preview + consent) + delta A6 and the O2 hash-coverage extension |
| New tests | 29 across 2 files, all green |
| Do-not-regress | **Clean** — 166 = 166 by identity, 0 new, 0 repaired |

No app build, no app start. Everything below is verified headlessly.

The pre-Phase-4 block is reported separately in
`pre-phase-4-block-report.md`; its taxonomy split (i) is the error vocabulary
this phase's status surface builds on.

---

## 1. 4A — Entry status model (build item 7 + delta A6)

`electron/main/wrc/entryStatusSurface.ts`.

A6 resolves an apparent collision: `suspended` exists both as a
publisher-signed `entry.status` and as a platform `envelope.suspension`, while
D4 carries a publisher-PART status. Three parties, three objects, three
statements. The module composes them; it never merges them.

**Data.** The two `suspended`s cannot collide by construction — one is
publisher-signed, the other lives only in the envelope, and the WRC rejects
rather than modifies.

**Admission** is conjunctive and fail-closed:

```
admissible ⇔ publisher_part == active
           AND entry.status == published
           AND envelope.suspension == null
```

An entry that was never fetched cannot satisfy the middle leg, so it is not
admissible — absence is not treated as assent.

**Display** never conflates. The headline is the failing leg closest to the
object (`platform` > `entry` > `publisher_part`), and **every** failing leg
stays in `failing`, ordered by closeness. Never-fails-silently means telling
the operator all of what is wrong, not the first thing that stopped the check.
Copy is distinct per layer: platform suspension reads "Suspended by the
platform", entry suspension reads "Withdrawn by the publisher". A test asserts
those two strings are not equal, because that is precisely the confusion A6
exists to prevent.

Per-status behaviour, each with an acceptance test:

| Status | Behaviour |
|---|---|
| `active` (+ published, unsuspended) | Admissible; nothing surfaced |
| `inactive` | "currently not offering connections"; no offer |
| `revoked` | Plain revocation display; no offer |
| `superseded` | Successor **surfaced** with the line, never redirected to; still not admissible, so the successor must complete its own chain |
| `compromised` | Revoked behaviour **plus** `unsuppressible_warning`, the Phase-2 alert class |

`applyExpiryTransition` implements the `expires_at` auto-transition: → revoked
by default, → inactive when publisher-configured, never resurrecting or
overwriting a status that is already non-active.

No enum is merged or extended. A guard test asserts the module declares no
combined status type and still speaks in `WrcPublisherStatus` and
`WrcEntryStatus`.

## 2. 4B — Offer schema, preview, consent (build item 8)

`electron/main/handshake/connectOfferStaging.ts`.

`wr_connect_offers` gains `wr_code_canonical`, `publisher_part`,
`entry_local_part`, `umbrella_handshake_id`, `entry_status`, `resolution_mode`
(`public | session_bound`), `session_bound_expires_at`, and the delta v1.1
additions `evp_ref`, `value_statement`, `catalog_epoch`, `audit_url`. Every one
is written from the verified resolution chain and **never from carrier bytes** —
the carrier may claim anything and is not a party to the offer.
`wr_consent_records` gains `resolution_mode`.

`CREATE TABLE IF NOT EXISTS` does nothing to a database that already has the
table, so the columns are also added explicitly and idempotently; a test
simulates a pre-Phase-4 database and runs the migration twice.

### Preview-hash coverage — the substance of this item

Consent is pinned to the preview hash. If two offers that differ in something
the operator was *shown* hash identically, the consent record does not bind
what was actually agreed to. The preview input therefore gains `entry` (part,
local part, status, umbrella, catalog epoch) and `resolution_mode`, and per the
**O2 extension** it covers `evp_ref` and `value_statement`. `boundDefinition`
gains `publisher_domain_verified`, because whether the domain completed
dual-channel validation is part of *who* the offer binds.

Tests assert that offers differing only in `resolution_mode`, only in the
entry, only in `evp_ref`, only in `value_statement`, only in `catalog_epoch`,
or only in the publisher part all produce different hashes — and that identical
offers still hash identically, so the check is measuring coverage rather than
nondeterminism.

### O6 — consent-time re-validation

`revalidateOfferStatusForConsent` runs before `prepareFormationConsent`. A
publisher can withdraw, be revoked, or be suspended between staging and
consent, so the status is re-checked against the row at consent time and a
mid-window transition fails consent. Session-bound resolutions additionally
fail once expired. Non-WR-code offers have no resolution layers and pass
through untouched. The 7-day offer timeout remains UI staleness and is not this
gate.

## 3. An existing guard caught a real placement error

The first after-capture showed one new failure: the Phase-4 acceptance test
`structural absence: no override control, single staging read surface`.

That guard pins every reader of the staged-offer table to one owning module, so
no second module can build an alternate, unsuppressed listing. I had put the O6
gate in `ipc.ts`, which violated exactly that invariant. **The guard was right
and the placement was wrong** — the gate moved into the module that owns the
table, and `ipc.ts` imports it.

A second-order detail worth recording: the comment I first wrote to explain the
move named the table literally, which tripped the same scanner. The invariant
is enforced by substring, so prose *about* it has to avoid the string.

## 4. Exit criteria

| Criterion | Status |
|---|---|
| Acceptance tests per status, including the compromised warning and surfaced (never silent) supersession | **Met** — 15 tests |
| Preview-hash coverage: two offers differing only in `resolution_mode` or entry produce different hashes | **Met**, plus the O2 extension fields |
| Consent fails on mid-window status change; passes on active | **Met** — 4 O6 tests |

## 5. Captures

Invocation and validity guard unchanged.

| | Baseline `56dbf7c2` | After |
|---|---|---|
| `testResults.length` (files) | 558 | 560 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 6,054 | 6,083 |
| `numFailedTests` | 166 | 166 |
| `numPassedTests` | 5,831 | 5,860 |

**Identity comparison: 0 new, 0 repaired.** Deltas are exactly this phase:
+2 files, +29 tests, +29 passing.

### Dual-mode verification

Five remediated suites: 15 / 8 / 8 / 14 / 9 in isolation, **0 failures** in the
full workspace. New Phase-4 suites in isolation: `entryStatusSurface` 15,
`connectOfferWrCodeSchema` 14.

## 6. Carried forward

- **Seal-key-source unification (ii)** — diagnosis delivered, implementation
  gated on author approval.
- **Bound-origin-set plurality** — scheduled with 5A.
- **test-isolation bidirectional risk** — flagged; the Electron mock stays
  untouched until a dedicated decision.
- **Phase 5 wiring** — 4A's composition and 4B's offer fields are consumed by
  the Phase-5 surfaces (5B offer UI, EVP-first-render, audit link); this phase
  builds the data and the rules, not the surfaces.
- Live-instance WRC items remain `integration-pending`.

## 7. Standing disciplines observed

Sanctioned runner for every capture; validity guard on both; dual-mode for the
remediated suites; mutation rule applied to the negative cases;
graph-first-never-evidence; no build; no app start.
