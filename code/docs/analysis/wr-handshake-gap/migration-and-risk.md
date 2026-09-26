# WR Handshake Refactor — Migration Impact, Dependency Ordering, Risk Register (Phase 3)

Cross-references: finding IDs from `gap-matrix.md` (A1…I5, T1…T5). All stores below are preserved across builds; every schema change carries an explicit migration note and a survival statement.

---

## 1. Persistence impact per store

### 1.1 `handshakes` tables (vault DB **and** `handshake-ledger.db` via shared migrations)

Affected findings: A1–A10, B1–B3, C1, C5, G1–G6, E1–E9.

| Change | Migration strategy | What survives |
|---|---|---|
| Split immutable signed core (profile, parties, ingress_path, declarations, extensions, created_at, nonce, signature list) from mutable runtime state (seq counters, tokens, endpoints, policy resolution, repair flags) | **Versioned parallel store** (new tables, e.g. `wr_handshake_core` append-only + `wr_handshake_runtime`), not in-place ALTER. The current `handshakes` table stays read-only during a transition window; a backfill writes one synthetic core record per existing row, marked with a **legacy profile** identifier (see open-questions.md Q2). In-place migration is not viable because the current record cannot be made byte-stable retroactively (G3) and its "signed" hash covers only a field subset (A8). | All existing relationships survive **as legacy-profile records** with their current rights; they cannot retroactively gain spec-conformant signatures/countersignatures. Whether legacy records may keep operating indefinitely or require re-establishment for specific profiles is an author decision (Q2). |
| Extract private key material (`local_private_key`, `local_x25519_private_key_b64`, `local_mlkem768_secret_key_b64`) into a dedicated key store (G6) | In-place: add key-store table, move values, null out old columns (columns retained empty for schema compatibility; SQLite cannot drop cheaply pre-rebuild). One-shot idempotent migration in the existing `HANDSHAKE_MIGRATIONS` chain. | Keys survive; relationships keep signing/decrypting. Rollback-safe because values are copied before nulling. |
| Add capture-provenance and `ingress_path` (A4, C5) | New rows only (fields of the new core). Existing rows get `ingress_path = null` / provenance `unknown_legacy` — never a fabricated value. | Survives; legacy rows are distinguishable in evidence. |
| Stop applying full handshake migrations to `handshake-ledger.db` (G5) | Decision required first (Q10-adjacent): either (a) ledger becomes the hash/metadata mirror it documents (migrate any private-key-bearing rows out, then freeze its schema), or (b) ledger is formally the second full store (then fix the documentation and the threat model). Until decided, **do not add the new core tables to the ledger handle**. | Ledger data survives either way; option (a) requires a one-time sweep for key material written through that handle. |

**WAL/SHM note:** both DBs run WAL; parallel-store migration must run inside the existing migration runner (single writer, checkpoint after) — no external tooling that could leave stale `-wal` files.

### 1.2 Orchestrator DB (`orchestrator.db`, `device_keys`)

Affected findings: I1–I2, D3.

| Change | Migration strategy | What survives |
|---|---|---|
| None required for x25519 device keys (refuse-overwrite semantics already conformant, I4) | — | Device keys survive untouched. |
| Cross-device binding challenge state (nonce/epoch, I2) | Additive: new table(s) for binding challenges/epochs. No change to existing rows. | Everything survives; new machinery is net-new. |
| Pairing codes remain routing identifiers | No change; codes are not authority (I1 conformant half). | Survives. |

### 1.3 `email-accounts.json`

Affected findings: D2, D5.

| Change | Migration strategy | What survives |
|---|---|---|
| Introduce External Service Admission artifacts for each configured provider (D5) | **Versioned parallel store**: ESA objects (signed, versioned, per-direction ceilings) live in a new governed store; `email-accounts.json` remains the credential/config container it is today and becomes *referenced by* the ESA, not replaced. First-run migration proposes one ESA per existing account for explicit user admission ("propose, never silently apply" — [X.3.1]/[X.6] discipline). | Accounts and credentials survive unchanged. Until the user admits the proposed ESA, behavior policy is an author decision: grandfather-allow (transition flag) vs fail-closed cutover (Q11 in open-questions.md). |

### 1.4 Evidence stores (`audit_log`, `ingestion_audit_log`, extension PoAE)

Affected findings: H1–H5, E5.

| Change | Migration strategy | What survives |
|---|---|---|
| New append-only hash-chained evidence chain (PoAC/PoAE/Boundary Event Records) | **Versioned parallel store** — never retrofit chaining onto `audit_log` (its rows are deletable and already incomplete). Old `audit_log` is frozen read-only for forensics; new writers start a fresh chain with a genesis record referencing the cutover timestamp. | Old audit rows survive read-only; no fabricated chain continuity is claimed for pre-cutover history. |
| Retention behavior (H5) | Ingestion-audit purging must exclude the new chain; retention config gains an explicit carve-out. `deleteHandshakeRecord` stops deleting audit rows. | Pre-existing purge losses are unrecoverable — the deliverable states this; no claim of complete historical evidence [X.0.1 claims discipline]. |

### 1.5 Coordination / relay stores (server-side)

Affected findings: D1, F2, T4.

| Change | Migration strategy | What survives |
|---|---|---|
| Full-claim identity binding on ack/registry paths (F2) | Code change + additive columns if issuer must be persisted alongside `sub` in `coordination_handshake_registry`. Additive ALTER, backfill `iss` lazily on next registration. | Registry rows survive; rows without `iss` are re-registered on next client contact. |
| No inference payloads on relay; `p2p_signal` only | No change — already invariant (workspace rule); the refactor must not regress it. | — |

### 1.6 `orchestrator-mode.json`, `linked[]` topology

Affected findings: D3.

| Change | Migration strategy | What survives |
|---|---|---|
| Capability-set admission events replace silent auto-wire | Existing `linked[]` entries are grandfathered as one-time proposed admissions on first launch after upgrade (rendered, consented, PoAC-recorded). | Topology survives after one explicit confirmation; declining removes the standing wire. |

---

## 2. Dependency ordering (prerequisite graph)

```
(0) Guard & hygiene fixes            F2 (full-claim guards), E8 (silent revocation),
    [no schema deps]                 C14/A11/A12 (dead-code removal or wiring)
          │
(1) Canonicalization + frozen core   A8 (canonical form, domain tags)
    record + containers              A1–A7 (core fields, extensions/declarations containers)
          │
(2) Profile registry +               B1–B4, B7 (registry records, fail-closed dispatch)
    fail-closed dispatch             ← requires (1): profile lives in signed core
          │
(3) Single formation pipeline        C1–C3, C5, C7, C8 (one pipeline, capture enum,
    + capture methods + provenance    provenance in contract, invitation classes)
                                     ← requires (2): pipeline dispatches on registry records
          │
(4) Contract store split +           G1–G4, G6 (immutable core store, key extraction,
    anti-rollback high-water          high-water versions)   ← interleaves with (1)/(3)
          │
(5) Grant model + evidence chain     E1–E5, E9, H1–H4 (delivery/preparation rights,
                                      kill execution grants, PoAC/PoAE, Intent Hash)
                                     ← requires (3)/(4): grants attach to contracts;
                                       PoAC needs ingress_path + provenance fields
          │
(6) Governance classes + ESA +       D1–D9 (class registry, ESA artifacts, directional
    directional sets + BER            sets, Boundary Event Records, policy anti-rollback)
                                     ← requires (2) profiles (Internal = admission
                                       situation) and (5) capability/evidence machinery
          │
(7) Cross-device binding + Tier-2    I1–I3 (challenge exchange, edge-agent fold-in),
    seams                            T2 (hash-stable store proven), T4 (token optional
                                      fields land with the (5) token schema)
```

Rationale for the two load-bearing edges:

- **Frozen core before profile registry** — profile is a signed-core field [VII.3.1]; a registry cannot dispatch on data that has nowhere to live.
- **Single formation pipeline before capture-provenance recording** — provenance is a first-class contract field written by the pipeline [IX.3.1 rule 5]; recording it per-dialect would fossilize the dialects.

Independent early tracks (no schema dependency): F2 guard unification, E8 revocation silence, C14/A11/A12 dead-path cleanup — all shippable before (1).

---

## 3. Risk register

Each entry: blast radius if done wrong + a verification idea drawn from the extracts' section-K criteria.

| Risk | Finding(s) | Blast radius | Verification (section-K derived) |
|---|---|---|---|
| **Core-store migration corrupts or orphans existing relationships** | A1, G1–G3 | All active user relationships stop verifying or lose rights; both vault DB and ledger affected (shared migrations). Worst case: users must re-establish every handshake. | Migration dry-run harness over copies of real DBs; assert row-count parity, every legacy row resolves to a legacy-profile core record, and post-migration accept/refresh/revoke round-trips pass. K-criterion [VII.4.2]: unknown profile → visible refusal — legacy profile must be *known*. |
| **Unknown-field handling flips from strip to preserve and breaks old peers** | A6, A8 | Peers on the old build reject new-format capsules (their allowlist strips, then hash mismatch) → cross-version handshakes fail network-wide. | Dual-format transition: emit old wire + new container until peer-version detection; K-test [VII.3.5]: legacy handshake with unknown non-critical extension establishes; with unknown critical extension refuses naming the namespace. |
| **Signature scope expansion invalidates existing signatures** | A8, A9 | Every persisted capsule hash/signature fails re-verification → historical chain integrity checks break; refresh/revoke on old relationships rejected. | Version-gated verification (schema_version n+1 signs full canonical form; v≤2 verified under old rules, marked legacy in evidence). Test: replay stored v2 capsules → still verify; new capsules under-signing → rejected. |
| **Killing execution grants breaks tool automation users rely on** | E1 | All tool executions stop until per-tap consent + PoAE flow ships; silent breakage would look like data loss. | Feature must land WITH the consent-tap flow, not before. K-test [VII.10.5.5]/[VII.14.6]: no auto-accept control exists; every execution produces a PoAE record; assert no bypass API remains (grep-level structural absence test). |
| **Silent revocation removes the peer-notify capsule other builds expect** | E8 | Old-build peers keep a zombie ACTIVE record and keep transmitting; without the receiver-enforced admission filter (E2) those transmissions could still surface. | Order dependency: ship receiver-side ingress filter first, then remove notify. K-test [VII.10.7.2]: revocation produces no publisher-observable signal AND off-scope/revoked transmissions die pre-visibility with a logged record. |
| **Email/relay invitation inertness breaks the primary onboarding path** | C3 | If inbound initiate capsules stop creating pending rows before the Connect-offer/capture flow exists, users can no longer receive handshakes at all. | Sequence: build Connect-offer surface + capture event first; then flip auto-insert off. K-test [IX.3.1 rule 2]: failed verification suppresses the offer entirely; [IX.12.1]: no formation path besides the three capture methods. Blocked on Q1 (does PENDING_REVIEW = establishment?). |
| **ESA cutover locks users out of email/cloud** | D2, D5 | Fail-closed admission without migration proposals = all mail sync and cloud inference stops on upgrade day. | Grandfather-propose flow (1.3); K-test [X.3.1]: non-admitted service unreachable as authorized target — asserted only after the admission UX exists. |
| **Evidence-chain cutover claims false continuity** | H1, H5 | Auditors treat pre-cutover mutable audit rows as chained evidence → invalid assurance claims (violates claims discipline [X.0.1]/[X.13.4]). | Genesis record explicitly marks chain start; deliverable text distinguishes by-construction (post-cutover chain) from pending (historical rows). Tier-L verification test: removal/reorder/insertion of a post-cutover record is detectable. |
| **Ledger schema freeze loses data the ledger handle already wrote** | G5 | Key material or inbox rows written through the ledger handle become unreadable after freeze. | Pre-freeze sweep + copy-out migration; assert ledger contains only documented tables afterwards; both DB handles pass integrity check. |
| **Identity-guard tightening breaks same-user multi-realm setups** | F2 | Users whose devices authenticate against different issuers (dev/staging realms) lose internal pairing overnight. | Inventory realm distribution first (telemetry/local check); K-test [VII.3.8]/[VII.3.10]: cross-SSO ack rejected, full-claim match required; migration note for legitimately mixed-realm rows (author decision, Q3-adjacent). |
| **Edge-agent fold-in bricks deployed agents** | I3 | Deployed edge agents can no longer pair/deliver until upgraded in lockstep. | Transition window with both dialects accepted read-only, new formations only via the one mechanism; K-test [XI.3-I9]: no device class receives a weaker regime. |
| **Coordination-relay changes leak inference or break p2p_signal-only invariant** | D8, workspace invariants | Regression of the "no inference payload on the relay" rule — a hard project invariant with existing regression tests. | Keep `internalInference.directHost.regression.test.ts` and forbidden-key checks green; extend rather than replace `relayP2pSignalHandler` forbidden-key list. |
| **Anti-rollback high-water introduces false rejections after restore-from-backup** | G4, D9 | Users restoring an older DB backup see every newer-signed object rejected as "rollback" in reverse — or, if high-water lives in the restored DB, genuine rollback becomes invisible. | Define high-water storage location + backup semantics explicitly; K-test [IX.4.2]: replay older signed manifest/policy → rejected; restore scenario documented. |

---

## 4. Standing invariants the refactor must not regress (from workspace rules + gap matrix conformant rows)

1. Relay carries `p2p_signal` only; no inference bodies on the coordination relay; no inference in `p2p_pending_beap` (table already dropped, v66).
2. `assertRecordForServiceRpc` gate stays internal + ACTIVE + same-principal + identity-complete (it becomes *stricter* under F2, never looser).
3. Metadata-only logging for inference/signaling paths (no prompt/SDP/token content).
4. No deep-link/hyperlink formation (C4), no auto-accept control (C13), no key transfer between devices (I4), unlimited-until-revoke ground state (E6), re-handshake reanimates nothing (E7), reserved names unimplemented (T5/E10).
