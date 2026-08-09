# Pre-Phase-4 block — acceptance report

One bounded package executed before Phase 4, per the author ruling of
2026-08-09.

| | |
|---|---|
| Branch | `integration/consolidated-current` |
| Baseline | `de254927` |
| Tip | `97cb52a6` |
| Do-not-regress | **Clean** — 166 = 166 by identity, 0 new, 0 repaired |
| New tests | 14 across 2 files, all green |

---

## (i) Inbox-read error taxonomy — IMPLEMENTED

`MESSAGE_NOT_FOUND` covered three materially different states, so neither an
operator nor a log could tell a missing message from a tampered one from a
locked vault. The Phase-2 diagnosis had to run a probe to find out which had
happened.

| Code | Means |
|---|---|
| `MESSAGE_NOT_FOUND` | The row is genuinely absent |
| `SOURCE_UNVERIFIABLE` | Row present; `sealedQuery` filtered it (bad seal, hash mismatch, no usable provider) |
| `SOURCE_NO_CANONICAL_CONTENT` | Row present; no canonical plaintext to clone |

The absent-row copy drops its "or could not be verified" hedge, which was the
visible symptom of the conflation.

**Precedence, decided and pinned:** absence of content outranks
unverifiability. You cannot verify what is not there, and "no decrypted content
yet" is the actionable thing to tell an operator. A test asserts this for a row
that has both defects.

**Classification never reads content.** The check that distinguishes the last
two reads the canonical column's *presence* and never returns its value — this
code sits behind the gate it is classifying, so returning unverified content
there would defeat the gate.

Callers updated: the renderer's failure copy and its show-detail list, the IPC
doc contract, and the `BeapInboxClonePrepareErrorCode` union in both main and
renderer. No caller branches on the old conflated meaning; a guard test asserts
exactly one `MESSAGE_NOT_FOUND` return remains in the prepare path and that the
hedging string is gone.

Existing assertions were re-pointed to the state each case actually creates:
`b9` §1.2 (tampered) and §1.3 (missing seal) are `SOURCE_UNVERIFIABLE`, §1.4
(absent) stays `MESSAGE_NOT_FOUND`, and the two seal-gate NULL-canonical cases
are `SOURCE_NO_CANONICAL_CONTENT`.

## (ii) Seal-key-source policy — DIAGNOSIS ONLY, no code changed

Full findings: `seal-key-source-policy-findings.md`.

Headline: **six production call sites, one uses the policy.** Sites 2–4 are the
extension's sealed inbox read over the loopback RPC, and they route from the row
tag alone.

The consequence is user-visible and wider than the Phase-3 report framed it — it
named clone-prepare, but the extension's entire inbox list is on the unpolicied
path. A legacy inner-sealed, non-confidential row is visible in the Electron
inbox (which tries the policy list, succeeds on `inner`, and re-seals forward)
and absent from the extension inbox (which maps `vmk` → inner only, filters the
row, and emits tamper telemetry for a row that is not tampered).

**Authoritative:** the policy decides which providers may be TRIED; the row tag
records what the row WAS sealed with. The tag cannot govern policy because it is
exactly the field that is stale on the legacy rows the try-list exists to
handle.

**Recommendation:** teach `sealedQuery` an optional key-source list, keep
today's `rowKeySource` as the default so nothing changes until a call site opts
in, then migrate the extension list first. Two alternatives and three risks are
set out in the findings. Implementation is gated on author approval.

## (iii) Epoch-floor hardening — IMPLEMENTED

Schema **v77** adds `wrc_publisher_epoch_floor`. The anti-rollback floor (A3)
moved out of the plain-JSON resolved-record store into the native-DB protection
class; the remainder of the record stays cache-class as ruled.

- Monotonicity is a property of the SQL statement
  (`ON CONFLICT … WHERE excluded.epoch_floor > …`), not of a read-then-write a
  caller could race or skip.
- The store exposes exactly two operations, `get` and `raise`. There is no
  `set`, `clear`, or `delete` to call; a guard test asserts the public
  interface has precisely those two methods.
- A legacy cache file's `epoch_floor` key is **ignored on load**. Reading it
  back would reintroduce the reset path this move removes.
- DB unavailable ⇒ in-process floor. Strictly safer than what it replaces:
  empty for the process, but unlowerable and never written anywhere a file
  deletion could reach. It is not a substitute — there is simply no accepted
  history to compare against until the DB is up.

**The guard test the ruling asked for:** delete the userData cache file, then
serve an older but correctly signed CatalogHead. Resolution still fails with
`head_epoch_rollback`. A second case forges a legacy cache file claiming a lower
floor and confirms it cannot lower anything.

## 3. One correction found by the do-not-regress pair

The first after-capture showed **1 new failure**, and it was mine: the Phase-3
test "the epoch floor survives eviction of the cached record" proved that
property by reading the floor back out of the same cache persistence — which is
exactly the property (iii) removes. The test asserted the old design.

It now shares a floor store between the two record stores, asserting the new
reason: the floor survives because of *where it lives*, not because the cache
happens to hold it. The file-deletion case is covered separately in
`epochFloorHardening.test.ts` against a real migrated DB.

Worth recording because the identity comparison is what caught it. A count-only
check would have shown 167 vs 166 and invited a shrug.

## 4. Captures

Invocation and validity guard unchanged.

| | Baseline `de254927` | After |
|---|---|---|
| `testResults.length` (files) | 556 | 558 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 6,040 | 6,054 |
| `numFailedTests` | 166 | 166 |
| `numPassedTests` | 5,817 | 5,831 |

**Identity comparison: 0 new, 0 repaired.** Deltas are exactly the block:
+2 files, +14 tests, +14 passing.

### Dual-mode verification of the five remediated suites

| Suite | Isolation | Full workspace |
|---|---|---|
| `beapInboxClonePrepare` | 15 passed | 0 failures |
| `beapInboxClonePrepareSealGate` | 8 passed | 0 failures |
| `b9OutboundCloneIntegrity` | 8 passed | 0 failures |
| `pr52CloneDeterminism` | 14 passed | 0 failures |
| `coordination-client` | 9 passed | 0 failures |

## 5. Carried forward

- **(ii) implementation** — awaiting author approval; recommendation and risks
  in the findings document.
- Bound-origin-set plurality remains scheduled with 5A.
- The `test-isolation bidirectional risk` finding is unchanged; the Electron
  mock stays untouched until a dedicated decision.
