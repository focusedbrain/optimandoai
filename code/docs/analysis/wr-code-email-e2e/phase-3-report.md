# WR Code / Public Handshake — Email E2E Slice
## Phase 3 report — Resolution infrastructure

| | |
|---|---|
| Branch | `integration/consolidated-current` (single-branch workflow) |
| Baseline | `4a3695b5` |
| Tip at report | `ef87c6b3` |
| Build items | 4 (hardened client), 5 (resolution + dual channel), 6 (r7 alignment) + delta 3D / 3E / 3F |
| New tests | 48 across 3 files, all green |
| Do-not-regress | **Clean** — identical failure identity set (166 = 166, 0 new, 0 repaired) |

The agent did not build or run the desktop app or the extension. Everything is
verified by headless unit and integration tests against a contract-faithful
double.

**Contract**: `code/docs/spec/WRC-Registry-API-Contract_v1.0.md` @`20794bff`,
used as an INTERFACE REFERENCE. No WRC service code exists in this repo, and no
module here constructs or signs publisher material outside the test fixture.

---

## 1. What was built

All of it lives in `apps/electron-vite-project/electron/main/wrc/`, plus the
r7 alignment in `packages/ingestion-core/src/channelProvenance.ts`.

| Module | Item | Role |
|---|---|---|
| `httpsClient.ts` | 3A | The only outbound HTTP path the client may use |
| `wrcContract.ts` | — | Contract object shapes + fail-closed decoders |
| `wrcCrypto.ts` | — | Canonical JSON, `sha256:` hashes, Ed25519 verify, Merkle fold |
| `wrcTransport.ts` | — | The isolated transport interface (the swap point) |
| `dualChannel.ts` | 3B.2/3 | DNS + manifest validation and the part cross-check |
| `wrcVerify.ts` | 3D/3E/3F | Head, envelope and EVP verification |
| `resolvedRecordStore.ts` | 3B.5 / 3D | D6 record cache + persisted epoch floor |
| `resolutionClient.ts` | 3B | Orchestration; the ordering is the security property |
| `wrcRuntime.ts` | 3B | Process wiring + loopback-RPC entry point |

### 3A — Hardened outbound HTTPS client

HTTPS only; a 3xx is a typed failure and is never followed; TLS 1.2 floor; a
total deadline covering connect, headers and body; a size cap enforced while
streaming (the socket is destroyed mid-body rather than buffering); and JSON
parsing as a declared expectation rather than an assumption.

The SSRF guard runs at CONNECT time on the **resolved address** via a custom
`lookup`, not on the hostname. A hostname check falls to DNS rebinding; the
address the socket will actually use does not. Both IPv4 and IPv6 private,
loopback, link-local (including `169.254.169.254`), CGNAT, documentation,
multicast and NAT64 ranges are refused, as are IPv4-mapped forms of the same.

`rejectUnauthorized: false` appears nowhere and there is no option, agent
parameter, or flag through which a call site could weaken it — asserted by a
source-walking test rather than left as a convention.

**Deliberate placement deviation, reported not hidden.** The order suggested
`packages/ingestion-core` or `packages/shared`. Both are imported by the MV3
extension, and the guard needs `node:dns`, `node:net` and `node:https`. Placing
it there would either break the extension build or invite a browser-safe
fallback that silently drops the guards. Since the order also states 3B is "all
in Electron main" and 3A is "used by 3B exclusively", the client sits beside its
only consumer. The suggestion was explicitly a suggestion; this is the one
structural deviation in the phase.

### 3B — Resolution client and independent dual-channel validation

The order of operations is the security property, so the code reads in that
order and nothing short-circuits it:

```
capture (local check only, already done by captureBaselineCode)
  → registry resolve            ... a CLAIM, trusted for nothing
  → DNS TXT _wr.<domain>        ... channel 1
  → /.well-known/wr/manifest    ... channel 2, Ed25519 self-signed
  → manifest part cross-check   ... ALARM on mismatch, never a fallback
  → catalog head                ... signature, epoch floor, freshness
  → entry envelope              ... publisher sig, countersig, inclusion
  → EVP                         ... budget, part/entry binding
```

The registry is consulted **last** for key material, and only to detect
divergence: if DNS and the manifest agree with each other and the registry
disagrees, that is `registry_key_divergence` and it fails closed. This is what
makes P3 structural rather than aspirational — no branch can reach a trust
conclusion having consulted only the registry.

Unresolved-capture state (§XVI.15.1) is a first-class value
(`WrcUnresolvedCaptureState`) rather than the absence of a record, so
"captured, check-passed, not yet resolved" cannot be mistaken for "resolved".
Cache demotion (§XVI.15.3) is a visible `cache_state` transition, never a
silent delete. `TierSignals` / `tierSteps` are untouched (3B.5).

The identifier-class carve-out comment (3B.6) was added to
`packages/coordination-service/src/pairingCodeRegistry.ts`, naming why a
reassignable per-user routing token deletes rows and reuses values while a WR
publisher part never may — and stating that it is not a template for this
client's caches.

### 3C — Sender-domain ↔ publisher-domain alignment

`applyPublisherDomainAlignment` compares the CPR's authenticated sender domain
against the resolved publisher's bound origin set and folds the result in
**through the existing CPR ratchet**. That routing is the point: alignment is a
second evaluation of a message that already has a verdict, and the ratchet makes
it structurally impossible for this stage to loosen one. A misalignment drops
`channel_pass` and clears the alignment flags; an alignment adds the Discovery
Record verdict and changes nothing else.

This activates the CPR's `discovery_record` tri-state, which before Phase 3 had
no resolved publisher to be consistent *with*. Subdomain matching requires a
label boundary, so `evil-example.com` does not match origin `example.com`.

### 3D / 3E / 3F

- **3D** — head signature by root or a live delegation (a delegation outside its
  validity window is its own typed reason, not a forged-signature verdict);
  strict per-publisher epoch monotonicity; freshness with visible staleness. The
  epoch floor is stored separately from the record cache and only ever moves
  upward, so evicting a publisher cannot reopen a rollback window.
- **3E** — object-hash binding, epoch match, publisher signature, ingest
  countersignature over `hash || epoch`, and Merkle inclusion against the
  already-verified head. Any missing leg means the object does not exist for the
  runtime. Suspension is a typed refusal for admission and a visible state for
  the audit surface (A5).
- **3F** — the 64 KiB canonical budget is a verification failure, never a
  truncation: a client that trimmed an over-budget EVP would render a value
  statement the publisher never signed in that form.

### Exposure

`wrc.resolvePublisher` on the existing loopback RPC returns the client's typed
result verbatim, including the distinct failure reason, so the renderer never
has to re-derive why a code did not resolve.

---

## 2. Exit criteria

| Criterion | Status |
|---|---|
| Integration test resolving against a contract-faithful double, every divergence failing closed with a distinct reason | **Met** — 25 tests; 16 distinct divergence reasons asserted |
| SSRF / redirect / size-cap behaviour unit-tested | **Met** — 12 tests |
| No production code path reaches publisher trust without both channels | **Met** — asserted by call-order test and by the unconfigured-deployment test |

The double signs real Ed25519 material, builds a real Merkle tree, and carries a
real epoch sequence, so verification is proven against signatures rather than
stubs that return `true`.

---

## 2b. Standing rules codified by this phase (author rulings)

**Node-only guards never live in browser-reachable packages.** A module whose
guarantees require node-only capabilities is placed beside its consumer, never
in a package imported by a browser build. A browser-safe fallback that silently
drops guards is a prohibited construction — the fallback would be
indistinguishable from the guarded path at every call site. This is what the 3A
placement below follows.

**Every negative-test mutation helper must assert its own semantic effect.** A
helper that mutates an artifact to prove a check fires MUST verify that the
mutation actually changed the verified content, or that verification fails for
the intended reason. A helper whose effect depends on fixture randomness is
invalid by construction: it produces a test that is green when it should be red,
some of the time, for reasons unrelated to the property under test. This rule
comes from the tamper-helper finding in §3 and is applied throughout §8.

## 3. Two findings from writing the tests

**A bracketed IPv6 literal bypassed the URL guard.** `URL.hostname` keeps the
brackets and `isIP('[::1]')` is `0`, so `https://[::1]/` passed the
literal-address check and was caught only later by the lookup guard. Defence in
depth held, but the first gate was wrong. Fixed by unwrapping the brackets.

**A signature tamper helper was silently a no-op.** It flipped the last
base64url character, which for a 64-byte signature carries two meaningful bits
and four discarded padding bits, so many "tampered" signatures decoded to
identical bytes. Whether a test caught a forged signature therefore depended on
which random key the fixture generated. It now tampers the first character and
asserts the decoded bytes actually differ; the matrix was run five times over
fresh keys to confirm stability. This is the same class of hazard as the
Phase-2 false green: a test that passes for a reason unrelated to what it
claims to check.

---

## 4. `integration-pending` — deferred to the WRC integration slice

Per the delta v1.1 WRC deferral these are **not waived**, and no substitute
trust path was built in their place:

- Live resolve round-trip against a running WRC instance.
- Live audit round-trip: `GET /v1/audit/{hash}` returning the byte-identical
  object (acceptance item (h)).
- Live CatalogHead rollback rejection against a real service (f) and a real
  suspended entry with a working audit link (g). Both are proven here against
  the double; the live legs remain pending.
- Delegation fetch over the wire. The client verifies delegation chains, but
  `POST /v1/publishers/{part}/delegation` is a write endpoint and there is no
  read endpoint in the contract for retrieving delegation records, so the client
  currently takes them from its own store. **Reported as a contract gap** — see §5.

---

## 5. Discovered, reported, not implemented

- ~~**Contract gap — no read path for DelegationRecords.**~~ **RULED and
  closed.** The author bumped the contract to v1.1: the head carries its own
  delegation and a separate audit-only read endpoint was added. Implemented in
  addendum 3G — see §8.
- **Resolved-record store is plain JSON in userData.** It is a cache, but it
  also carries the epoch floor, which is anti-rollback state. A local attacker
  who can write that file can lower the floor. **Scheduled** as
  "epoch-floor hardening" in the pre-Phase-4 block: the floor is trust state,
  not cache, and moves into the native DB protection class.
- **Bound origin set is currently a single domain.** §IX.3.1 r7 speaks of a
  bound origin *set*; the resolved record carries one dual-channel-validated
  domain. The API takes a set so the shape is right, but multi-origin publishers
  need a contract field. **Scheduled with the 5A wiring**, not Phase 4.
- **3C is not yet wired into the live mail path.** The function and its tests
  exist; the email→offer path that would call it is 5A. Deliberate, per the
  phase boundary.

---

## 6. Test capture and do-not-regress

Invocation, identical for both captures — flags only, no file paths, so the
full workspace runs under Electron's embedded Node:

```
pnpm test:native-db --reporter=json --outputFile=<path>
```

The bare-command trap and the `testResults.length` validity guard are unchanged
from Phase 2 and documented there.

| | Baseline `4a3695b5` | After `ef87c6b3` |
|---|---|---|
| `testResults.length` (files) | 552 | 555 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 5,976 | 6,024 |
| `numFailedTests` | 166 | 166 |
| `numPassedTests` | 5,753 | 5,801 |

**Identity comparison: 0 new, 0 repaired.** The deltas are exactly this phase's
additions: +3 files, +48 tests, +48 passing.

### Dual-mode verification of the five remediated suites (standing discipline)

| Suite | Isolation | Full workspace |
|---|---|---|
| `beapInboxClonePrepare` | 15 passed | 0 failures |
| `beapInboxClonePrepareSealGate` | 8 passed | 0 failures |
| `b9OutboundCloneIntegrity` | 8 passed | 0 failures |
| `pr52CloneDeterminism` | 14 passed | 0 failures |
| `coordination-client` | 9 passed | 0 failures |

New Phase-3 suites in isolation: `httpsClient.hardening` 12,
`resolution.dualChannel` 25, `publisherDomainAlignment` 11.

**Platform caveat.** Linux, agent sandbox. No app build, no app start.

---

## 8. Addendum 3G — contract v1.1, delegation travels in the head

Authorized after Phase-3 ratification, before Phase 4, in response to the
contract gap reported in §5.

| | |
|---|---|
| Baseline | `1c1cb3ef` |
| Tip | `d8ac21b1` |
| Amendment | `code/docs/spec/WRC-Registry-API-Contract_Delta_v1.1.md` |
| New tests | 16 in one file, all green |
| Do-not-regress | **Clean** — 166 = 166 by identity, 0 new, 0 repaired |

### The amendment

Committed as an additive delta beside the byte-exact v1.0 author drop, CRLF
preserved, following the `Order v1.0` + `Delta v1.1` precedent already in this
repo rather than editing the author's artifact in place.

- **§A** — `CatalogHead` gains `delegation: DelegationRecord | null`, REQUIRED
  non-null whenever `kid` is not the root key. Head verification completes from
  the DNS-pinned root plus the embedded record alone; no fetch in the
  verification path. Valid only when
  `valid_from_epoch <= epoch AND (revoked_from_epoch null OR > epoch)`.
  Delegated `kid` with a missing or invalid record is a verification failure
  with no fallback fetch.
- **§B** — `GET /v1/publishers/{part}/delegations`, the append-only rotation
  history, public read, for audit only and never required for verification.
- **§C** — obligation 3 restated: publisher signature is the root, or delegated
  via the head-embedded record verified against the DNS-pinned root.

### What changed in the client

`resolveSigningKey` now takes a single `headDelegation` instead of a list. That
shape change is the point rather than a detail: a collection-shaped field is an
invitation to satisfy a delegated head from somewhere other than the head, which
is exactly the property the amendment buys. The store is no longer consulted
during verification; it retains the record for audit only.

A malformed embedded record fails the *decode* rather than degrading to `null`.
Degrading would silently turn a broken chain into "root-signed head" and hand
the verifier the wrong question.

### Negative coverage — each with its own reason

| Case | Reason |
|---|---|
| Delegated kid, no embedded record | `head_delegation_missing` |
| Record signed by a key other than the DNS-pinned root | `head_delegation_invalid` |
| Sub-delegation attempt (`root_kid` names a delegate) | `head_delegation_not_rooted` |
| `revoked_from_epoch == epoch` (boundary) | `head_delegation_revoked` |
| `valid_from_epoch > epoch` | `head_delegation_not_yet_valid` |
| Record delegates a different kid | `head_delegation_kid_mismatch` |
| `delegate_pub` swapped, kid unchanged | `head_delegation_invalid` |
| Malformed embedded record | decode returns null |

The epoch window is asserted at all four boundaries (`4/5/8/9` for a window of
`[5, 9)`). Sub-delegation is unrepresentable rather than refused: `authority` is
`catalog-signing-only`, so a record naming anything but the root as `root_kid`
is rejected before its signature is considered.

Two guards keep §B honest: source-walking asserts `wrcVerify.ts`,
`dualChannel.ts` and `resolutionClient.ts` never reference the delegations
endpoint, and a deliberately broken audit endpoint leaves verification green.

Per the mutation rule in §2b, the `delegate_pub` swap case exists specifically
to pin branch ORDER — it proves a substituted public key cannot slip through as
a mere kid mismatch. The kid-mismatch case uses a correctly root-signed,
in-window, properly rooted record whose only defect is the delegated kid, so it
reaches the branch it names rather than failing earlier on a signature.

### Captures

| | Baseline `1c1cb3ef` | After `d8ac21b1` |
|---|---|---|
| `testResults.length` (files) | 555 | 556 |
| Validity guard (`>= 100`) | PASS | PASS |
| `numTotalTests` | 6,024 | 6,040 |
| `numFailedTests` | 166 | 166 |
| `numPassedTests` | 5,801 | 5,817 |

Identity comparison: **0 new, 0 repaired**. Deltas are exactly the addendum:
+1 file, +16 tests, +16 passing. All WRC suites were run three times over fresh
random keys to confirm stability. Five remediated suites re-verified in both
modes: 15 / 8 / 8 / 14 / 9 in isolation, 0 failures in the full workspace.

### Still integration-pending after 3G

The live legs are unchanged. Note one narrowing: delegation fetch is no longer
integration-pending for *verification* — verification never fetches. What
remains pending is the live audit round-trip against `GET /delegations`.

## 7. Standing disciplines observed

- Sanctioned runner contract for every capture.
- Graph-first, never-evidence: the graph was used to orient; every statement
  here is source-verified. No guard test cites it.
- No build, no app start.
- One permanent branch; `phase-3-complete` tags this phase.
