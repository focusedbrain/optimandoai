# Run 5 — Slice 0: Baseline and Runtime / Persistence Inventory

Branch: `integration/consolidated-current` · Run-4 HEAD confirmed: `6c808582`
(“Add full-chain conformance matrix and Run 4 report”; Run-4 range
`cb6fa798` → `6c808582`).

Pinned Annex verified at Slice 0 by the repository's exact mechanism
(`Get-FileHash -Algorithm SHA256 docs/spec/Annex_XVI_WR_Code_v1.95.pdf`):

```
064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F
```

Matches the Run-1..4 pinned value. The Annex remains normative; this document
records implementation state only.

## Before-capture (sanctioned runner `pnpm test:native-db`)

Two captures were taken to classify flakiness:

| Capture | Total | Failed |
| --- | --- | --- |
| run5.before | 6507 | 155 |
| run5.before2 | 6507 | 154 |

The single moving identity is the already-known hardware-probe flake
(`llm/__tests__/hardware-capability.test.ts > … should detect Intel generation
from model name`), the same one recorded as flaky in the Run-4 report.

**Deterministic Run-5 baseline: 6507 tests, 154 failing identities**
(identical to the Run-4 after-capture). Exact identities preserved for the
after-comparison at `%TEMP%\run5.before2.failures.txt`.

Native-DB runner status: green infrastructure — `better-sqlite3` loads in the
vitest environment, all Run-2/3/4 DB-backed suites execute against real native
DBs. The 154 failures are the pre-existing non-WRC baseline (email/A2
sandbox ingestion, bootstrap persistence, etc.).

## Load-bearing discovery: the production DB handle never carries the WRC tables

`wrcRuntime.ts` obtains its DB via
`internalInference/dbAccess.getHandshakeDbForInternalInference()`, which
returns the **handshake ledger** handle (`handshake-ledger.db`).

That handle is **frozen at schema v74** (`LEDGER_SCHEMA_FREEZE_VERSION`,
`handshake/db.ts`): `migrateHandshakeTables` never applies v75+ to it, and the
Phase-3 hygiene sweep (`ledgerHygiene.ts`) copies out and **drops** any table
not in the ≤v74 manifest or `LEDGER_NATIVE_TABLES`.

The WRC durable tables live at migrations **v77** (`wrc_publisher_epoch_floor`)
and **v78** (`wrc_entry_use_state`). Consequence:

- On the production handle those tables **never exist**;
  `epochFloorTablePresent` / `useLimitTablePresent` return false; and
- `resolveEpochFloorStore()` / `resolveUseLimitStore()` fall back — with only a
  console warning — to **in-memory stores**.

So the Phase-3 epoch floor and the Run-2 one-time-use state are, in production
today, **memory-only with a silent fallback**: exactly the condition Slice 10
prohibits. The v77/v78 tables do get created on the **vault** handle
(`vault/rpc.ts` runs the unfrozen chain), but the WRC runtime never uses that
handle, and the vault may be locked while WRC resolution runs.

**Run-5 persistence decision (pre-authorized: additive tables, internal
adapters, composition changes in `wrcRuntime.ts`):** WRC security state gets
its own native DB file — `wrc-security.db` in the same protection class and
directory as the handshake ledger (`~/.opengiraffe/electron-data/`) — owned by
the WRC composition root, with its own versioned migration chain
(`wrc_schema_migrations`, additive-only). Rationale:

- the ledger handle is frozen and swept — WRC tables are structurally
  prohibited there without weakening the G5 freeze/hygiene contract;
- the vault handle is unlock-gated and account-scoped — trust floors and
  replay state must exist whenever the runtime does;
- a dedicated file gives the WRC trust state the same "deleting a userData
  JSON cannot reset it" property the epoch-floor design demanded, with
  fail-closed behavior (no silent memory fallback) when it cannot open.

Existing stores are preserved untouched: the v77/v78 tables (and any rows on
vault handles) are not modified, dropped, or reinterpreted; the ledger chain
and `LEDGER_SCHEMA_FREEZE_VERSION` are unchanged. Because production never
had a handle where those tables existed, there is no live durable WRC row
population to migrate; the new store starts from the empty additive state the
order's "safe handling of existing DBs with no Run-5 rows" clause covers.

## Interface-by-interface inventory

Classifications: **[wired]** production runtime wired · **[capable]**
production-capable but not wired · **[memory]** in-memory only ·
**[fixture]** test fixture only.

| # | Interface | Implementation(s) | Classification |
| --- | --- | --- | --- |
| 1 | Namespace Directory | `namespaceDirectory.ts` `WrcDirectoryClient` (dual-sig, DNS, vetting, expiry, generation verification) | **[wired]** — constructed in `initWrcClient` from env anchor (`WRDESK_WRC_DIRECTORY_OPERATOR_KID/PUBKEY`); absent anchor ⇒ Gate 2 fails closed. Verification legs production-real. |
| 2 | Generation-floor storage (Directory) | `WrcDirectoryClient.generationFloors: Map<string, number>` (private, per-instance) | **[memory]** — the client itself documents restart persistence as an open hardening seam. Restart resets every Directory-record generation floor. |
| 2b | Generation-floor storage (Phase-3 catalog epoch) | `epochFloorStore.ts`: `createDbEpochFloorStore` (table v77) + `createMemoryEpochFloorStore` | **[capable + silent memory fallback]** — DB impl correct (monotonic upsert), but the production handle never has the table ⇒ memory fallback on every start. |
| 3 | Device Registry | `deviceRegistry.ts` `createMemoryDeviceRegistry` | **[memory]** — never constructed by `wrcRuntime.ts`; adapter option `devices` is never passed ⇒ Gate 4 device legs fail closed in production. No durable store exists. |
| 4 | Registered Counterpart Device lookup | `counterpartPass()` on the memory registry | **[memory]** — same substrate as #3. |
| 5 | Device Pass validation | `verifyDevicePass` (pure function over signed objects) | **[capable]** — invoked by the adapter when a registry is present; production never provides one. |
| 6 | Pairing-slot acceptance | `pairingSlots.ts` `acceptDevicePairing` (full-pipeline + slot checks + tenant signature + atomic slot consume + registry insert) | **[capable]** — no production RPC/runtime surface invokes it; registry insert and slot consume are only atomic to the degree the injected stores are (memory registry today). |
| 7 | Relay claim/release (Gate 5) | `relayRelease.ts`: `verifyReleaseChain` (pure legs 1–3) + `createMemoryRelay` (store, legs 4: rate + replay) | verification **[capable]**; relay store **[memory]**. `wrcRuntime.ts` passes neither `relay` nor `claimIdentity` ⇒ production is public-offering-only; recipient-bound release never runs. |
| 8 | Replay protection | Relay: `seenRequests`/`attempts` Maps inside `createMemoryRelay`. Admission: `createMemoryAdmissionReplayStore` | **[memory]** — and the admission ledger is instantiated **inside `createWrcGateDeps` per call**; `handleWrcSubmitReference` builds deps per submission, so in production the Gate-6 replay ledger does not even survive from one submission to the next. |
| 9 | Gate-6 request-id idempotency | `capsuleAdmission.ts` `WrcAdmissionReplayStore` (`createMemoryAdmissionReplayStore`) | **[memory]** — same per-submission instantiation defect as #8. |
| 10 | Capsule admission (Gate 6) | `capsuleAdmission.ts` `verifyCapsuleAdmission` (ordered legs, sealed-nonce X25519) | verification **[capable]** and reachable through the adapter, but production passes no `admission.decryptKey` ⇒ any relay capsule refuses (fail-closed, non-functional). Public-offering admissions (capsule-less) work. |
| 11 | Final acceptance / consumption | `WrcUseLimitStore.consume` (memory + DB impls) | **[capable, unreached]** — no production surface calls `consume`; only tests and `acceptDevicePairing` do. Admission→acceptance boundary exists in the model but has no runtime seam. |
| 12 | Use-limit claim/release/consume | `useLimitStore.ts`: `createDbUseLimitStore` (table v78, CAS-by-statement) + memory impl | **[capable + silent memory fallback]** — same handle problem as #2b: production always lands on the memory store. Claim/release inside the pipeline are wired and real. |

Supporting, already-wired substrate (unchanged by Run 5): grammar/capture
(`captureWrCodeReference`), the six-gate pipeline (`gatePipeline.ts`), the
adapter (`gatePipelineAdapter.ts`), the Phase-3 resolution client + resolved
record store (file cache in userData), and the RPC surfaces
`wrc.captureReference` / `wrc.submitReference` / `wrc.resolvePublisher`.

## Production capture-path reconfirmation (Run-1 set)

- `wrc.captureReference` — grammar-only, no resolution: **converges** (its
  submissions go through `wrc.submitReference`).
- `wrc.submitReference` — the single resolution path; runs
  `runWrCodeGatePipeline` with adapter deps. **Authoritative.**
- E-mail detection / clipboard / selection — detection-only surfaces from
  Run 1; resolution exits into `wrc.submitReference`. No alternate resolver
  found (`wrc.resolvePublisher` is the demoted status/audit surface and
  returns catalog status, not gate-released material; Slice 12 must prove it
  cannot resolve protected material).

## What Run 5 must therefore build (mapping to slices)

1. **Slice 1** — composition root in `wrcRuntime.ts`: one long-lived
   dependency graph (directory, floors, use-limits, devices, relay, claim
   identity, admission material, replay/idempotency stores, acceptance
   service) instead of per-submission construction of trust-bearing state;
   callers keep providing only untrusted input + request context.
2. **Slice 2** — durable generation floors in `wrc-security.db` for the two
   floor families that exist in Run 4: Directory-record generations (per
   publisher part; includes rollover-established operator trust continuity)
   and the Phase-3 catalog epoch floor (re-homed from the unreachable v77
   table). Publisher-key/delegation/vetting generations have no independent
   floor in the Run-4 model (key generation rides the record generation);
   none will be invented.
3. **Slice 3** — durable device registry (tenant Device Records, counterpart
   passes, revocation, generation, C-parent binding) with atomic
   pairing-slot commit.
4. **Slices 4–5** — durable relay replay + rate state and Gate-6
   request-id/idempotency ledger (distinct semantics, shared substrate
   permitted).
5. **Slices 6–8** — wire relay (incl. claim identity), device trust, and
   admission material (decrypt key via the runtime's key service seam) into
   the composition root.
6. **Slice 9** — explicit acceptance runtime boundary
   (`admission → acceptance → consume`) bound to an authenticated admission.
7. **Slice 10** — remove the two silent memory fallbacks (epoch floor,
   use-limit) and prohibit new ones: persistence unavailable ⇒ fail closed.
8. **Slices 11–13** — restart/crash/concurrency matrix, production full-path
   + anti-bypass suites, bounded maintenance.
