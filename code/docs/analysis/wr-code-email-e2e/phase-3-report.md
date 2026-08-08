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

- **Contract gap — no read path for DelegationRecords.** §4.1 defines
  `POST /v1/publishers/{part}/delegation` for submission, and §3.6 defines the
  record, but §4.2 exposes no endpoint from which a client can *fetch* the
  delegation chain for a publisher. A client that has never seen a delegation
  cannot verify a head signed by a delegated catalog key. Either the head should
  carry its delegation chain, or a read endpoint is needed. Not resolvable by
  the agent; it is a contract question.
- **Resolved-record store is plain JSON in userData.** It is a cache, but it
  also carries the epoch floor, which is anti-rollback state. A local attacker
  who can write that file can lower the floor. Sealed storage exists in this
  repo; whether the floor belongs there is a decision, not an oversight.
- **Bound origin set is currently a single domain.** §IX.3.1 r7 speaks of a
  bound origin *set*; the resolved record carries one dual-channel-validated
  domain. The API takes a set so the shape is right, but multi-origin publishers
  need a contract field.
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

## 7. Standing disciplines observed

- Sanctioned runner contract for every capture.
- Graph-first, never-evidence: the graph was used to orient; every statement
  here is source-verified. No guard test cites it.
- No build, no app start.
- One permanent branch; `phase-3-complete` tags this phase.
