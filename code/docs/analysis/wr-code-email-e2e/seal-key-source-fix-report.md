# NAMED ITEM — “seal-key-source policy unification”
## Fix report (approved scope a–d)

| | |
|---|---|
| Branch | `integration/consolidated-current` |
| Baseline | `0a7ca3ae` |
| Tip | `6c758b80` |
| Do-not-regress | **0 new failures.** 2 incidental repairs, attributed below and not claimed as an effect of this change |
| New tests | 7 in one file, all green |

Diagnosis: `seal-key-source-policy-findings.md`. This report covers only the
approved fix.

---

## (a) Optional key-source list on `sealedQuery`

`sealedQuery` gains an opt-in option. Today's default is preserved exactly: with
the option absent, the row still resolves to `forceKeySource ?? rowKeySource(row)`,
takes the same branches, and produces the same telemetry. No existing call site
changes behaviour until it opts in.

**It is a per-row resolver, not a flat list.** That is a deliberate departure
from the wording of the recommendation, for a reason worth stating: a batch read
mixes confidential rows (inner only) with non-confidential ones (outer, then
inner). One union list for the whole batch would let a confidential row verify
against the outer key — the exact opposite of what the option exists for. The
resolver receives the row and returns the providers policy permits for *that*
row. A test pins this: a confidential row sealed with the outer key is refused
even while the outer provider is bound and the MAC would match.

**Tamper telemetry is recorded only when every permitted provider fails.** A
first-candidate miss is not evidence about the row.

## (b) Extension sealed-inbox read migrated

The three sites — `handshake/ipc.ts` `beapInbox.list` (both cursor branches) and
`beapInbox.getMany` — now pass `verificationKeySourcesForInboxRow` via a small
adapter. Nothing else in those handlers changed.

Result, both asserted:

- A legacy inner-sealed **non-confidential** row is now visible on the extension
  path when the inner provider is available, instead of being filtered because
  its stale tag named a provider the policy no longer treats as the only option.
- That row emits **zero** tamper telemetry.

## (c) The false-positive guard, specifically

`sealed-storage/__tests__/keySourcePolicyList.test.ts` — 7 tests. The
telemetry assertion is its own test rather than an extra line on the visibility
test, because tamper telemetry about an untampered row is the regression to
prevent, not a side effect of one:

```
it('THE FIX: and emits ZERO tamper telemetry for that untampered row')
  → expect(getTamperingEvents()).toEqual([])
```

The outer key is tried first and does not match; the test exists to prove that
miss is silent. Companion cases keep it honest: a genuinely tampered row still
fails **and** still records `hmac_mismatch`; a row that fails against every
permitted provider still records telemetry; the default path is unchanged; an
empty resolver result falls back to historical routing.

## (d) Call sites NOT migrated in this change

Six production sites, three migrated. The remaining three, with dispositions:

| # | Site | Routing today | Disposition |
|---|---|---|---|
| 1 | `email/inboxSealedRead.ts:75` | Policy try-list via `forceKeySource`, plus reseal-forward | **Already compliant.** This is the reference implementation the fix generalises; nothing to migrate. |
| 5 | `email/sealedContentUpdate.ts:170` | Row tag (`rowKeySource`) | **Deferred.** A write-back path: re-reading under a broader policy interacts with what it then re-seals, so it needs its own decision about which key the update lands on. Not touched here. |
| 6 | `email/beapInboxClonePrepare.ts:415` | Row tag (`rowKeySource`) | **Deferred.** Clone prepare. Same legacy-row exposure as the extension had, but on a user-initiated single-row action with a typed refusal (`SOURCE_UNVERIFIABLE`) rather than a silently missing list entry. |

A note on the count: the ruling said "the remaining five call sites". There are
six in total and three were migrated, so three remain — and one of those three
(site 1) already used the policy before this change, which is why the findings
document scored it as the single compliant site. Flagging the arithmetic rather
than quietly reporting a different number.

## Data migration: not required — re-read suffices

Nothing stored changes. The fix alters only which providers are *tried* at read
time; row bytes, seals, and `seal_key_source` tags are untouched, and every row
remains verifiable under the key it was written with. No backfill, no rewrite,
no schema change.

One consequence worth stating: the extension path is read-only, so unlike
`inboxSealedRead` it does **not** reseal a legacy row forward to the ledger key.
Such rows stay legacy-tagged and keep relying on the policy list until the
Electron detail path touches one and heals it. That is tolerable — the tag is
descriptive, not authoritative — but it means the drift does not self-clear
through extension use alone.

## Acceptance

| | Baseline `0a7ca3ae` | After `6c758b80` |
|---|---|---|
| `testResults.length` (files) | 560 | 561 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 6,083 | 6,090 |
| `numFailedTests` | 168 | 166 |
| `numPassedTests` | 5,858 | 5,867 |

**0 new failure identities.** Two identities went from failing to passing, both
in `llm/__tests__/diagnostics.test.ts` ("Rotating Logger should write logs with
timestamp", "…should handle different log levels").

**Those two are not claimed as a result of this change** — nothing about seal
key routing can repair a rotating logger. Run alone, that file fails 7 of 19
consistently across three runs; in the full workspace it failed 8 at the
baseline and 6 after. Its outcome moves with scheduling. This is a third suite
exhibiting the named **test-isolation bidirectional risk**, alongside `CC_05b`,
and it is recorded there rather than credited here.

### Environment note (affects how the pair was taken)

The VM was reprovisioned between the Phase-4 report and this change:
`node_modules` was absent and every `/tmp` capture from the previous session was
gone. The Phase-4 after-capture recorded 166 failures; a fresh baseline at the
*same commit* `0a7ca3ae` in the rebuilt VM records 168. The two-failure
difference is environment drift in exactly the order-sensitive family described
above, and it cannot be attributed identity-by-identity because the earlier
capture files no longer exist.

The pair reported here was therefore taken **entirely within the rebuilt
environment** — baseline re-captured at `0a7ca3ae`, after-capture at
`6c758b80` — which is the comparison that means anything.

### Dual-mode verification

| Suite | Isolation | Full workspace |
|---|---|---|
| `beapInboxClonePrepare` | 15 passed | 0 failures |
| `beapInboxClonePrepareSealGate` | 8 passed | 0 failures |
| `b9OutboundCloneIntegrity` | 8 passed | 0 failures |
| `pr52CloneDeterminism` | 14 passed | 0 failures |
| `coordination-client` | 9 passed | 0 failures |

Directly affected suites: `keySourcePolicyList` 7, and
`b81BeapInboxPagination` + `b8BeapInboxIpc` + `sealedQueryDualProvider` 43
together.
