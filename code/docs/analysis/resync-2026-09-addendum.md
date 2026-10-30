# Resync 2026-09 — Addendum: reclassification, Author decision packet, housekeeping

This addendum is to `docs/analysis/resync-2026-09.md` (commit `306ea182`, 2026-09-25). The pinned Annex XVI v1.95 was re-verified before any annex search: sha256 `064aad6d8f28a0b1b7688c516ca3c4d8ba486bf723a5483d8c119d44f875829f`.

No product code changed, and nothing was deleted, moved or renamed. Paths are repo-relative below `code/`, and `wrc/` means `apps/electron-vite-project/electron/main/wrc/`.

---

## Part A — Reclassification of four D4 findings

### A1 Ruling 2: reclassified to CONFORMANT (false positive)

Ruling 2 covers only **non-addressable** sub-contexts: pure manifest, scope or artifact subdivisions with no reference and no lifecycle of their own. Addressable sub-handshakes, which have their own reference, lifecycle and grant, may be signed. GM1 claim 5 separates the two kinds, and GM1 claim 52 describes signed sub-handshake publication.

**What carries a signature and a status in the code:**

- **`WrcEntry`** (`wrc/wrcContract.ts:254-269`) carries `kid`/`sig`, `status` (`:110`: `published | suspended | retired`) and its own `epoch`. **It is addressable by construction:**
  - It is reached only through a WR Code reference. The lookup key is the reference's own address block: the local part for P, the counterparty for C, and the combination block for I and S* (`wrc/gatePipelineAdapter.ts:122-126`).
  - It carries the canonical references (`codes[]`, `:259`).
  - SP/SI/SC/SE entries also carry their parent binding (`designation.parent`, `:133-138`).

  So every signed, status-bearing entry is an addressable handshake or sub-handshake. This matches the v1.95 lifecycle model: §XVI.8.1/8.3 as implemented in `wrc/entryLifecycle.ts`, and §XVI.13.2's "addressable sub-handshakes".
- **The envelope checks** at `wrc/wrcVerify.ts:235-240` (publisher signature) and `:254-257` (suspension) run on these published objects, so the same classification applies.

**Candidates for a non-addressable sub-context, each checked:**

| Candidate | Own signature | Own status or lifecycle | Verdict |
|---|---|---|---|
| Entry `scopes: WrcHash[]` (`wrcContract.ts:260`) | no | no | CONFORMANT |
| EVP `scope_directory` items (`:333-339`) | no | no | CONFORMANT |
| SE `designation.session` (`:147-153`) | no (inside the signed SE entry) | expiry window of the SE entry itself | CONFORMANT (state of an addressable entry) |
| I `designation.pairing` (`:162-168`) | no | slot expiry and consumption belong to the I entry, which *is* the slot (`pairingSlots.ts:202-216`) | CONFORMANT (the slot is an addressable I entry) |
| Device Record / Device Pass (`deviceRegistry.ts`) | tenant-signed | revoked / withdrawn | out of scope: these are device credentials, not context subdivisions (§XVI.13.7) |

**Observation O-A1, not a finding.** EVP value-package objects (`wrcContract.ts:341-354`) carry their own `kid`/`sig` and can take an envelope `suspension` (`:419-433`). An EVP has no reference of its own, but it is bound to exactly one addressable entry (`wrcVerify.ts:295-300`) and is that entry's own material, not a subdivision of an umbrella context. Both properties come from WRC contract v1.0 §3.3/§3.4. It is recorded for the contract v2.0 delta (S2).

**Result: D4 rows 2a and 2c become CONFORMANT. No finding remains under ruling 2.**

### A2 Ruling 1: reclassified to SPEC-PENDING — new Annex XVI

The committed §XVI.13.2 (Annex XVI v1.95, pp. 36–37, "Parent entries, addressable sub-handshakes, and ephemeral entries") outranks the ruling. It reads:

> Policy can therefore only narrow inherited entry, never widen the grant.

> A sub-handshake that would add any automation, context, capability, or data category not enumerated in the umbrella grant is outside the inherited consent and requires explicit acceptance before it becomes active; … a publisher cannot widen an umbrella grant by issuing sub-handshakes.

The code has no consent-inheritance path (`handshake/formationPipeline.ts:301-303`) and no child ⊆ parent check, so it is consistent with the committed text today. There is no code slice until a new Annex XVI is committed. Note that §XVI.13.2 already lets a sub-handshake go beyond the umbrella grant through its own explicit acceptance, and it forbids flowing back into the umbrella, which matches ruling 1's "no flow back". What still differs is inherited consent *at no extra cost*, together with ruling 7. That is what the new annex must settle.

### A3 Ruling 4: reclassified to ANNEX NONCONFORMANCE (Run 1)

The committed v1.95 has normative text that gates automatic detection and auto-insertion on the signed WR script block. It was introduced by the v1.94 amendment (§XVI.7.2a and §XVI.7.4a entries in the change log, p. 45).

- **§XVI.3 Architectural Invariants (p. 9):** automatic detection and, where enabled, automatic insertion of an offering from a page or a message require that the reference was placed there through the signed WR script block (§XVI.7.4a), so the runtime can verify the publisher signature and the origin/domain binding before it surfaces anything.
- **§XVI.7.4a Signed WR script block (p. 26):** for auto-detection and auto-insertion from e-mail, the reference must come from the signed WR script block. Loose textual references without a script block remain capturable manually and are verified like any other capture; they are not auto-detected or auto-inserted from these carriers.
- The same rule is repeated in §XVI.5.8 (p. 15: automatically detected candidates "from a verified signed script block") and §XVI.7.7 (p. 29).

`email/messageRouter.ts:534-537` (with the call site `email/syncOrchestrator.ts:944`, the scanner `email/wrCodeEmailDetection.ts:51`, and persistence at `:82`) automatically scans every plain, channel-authenticated message for loose textual references. Run 1 (`d5e4db5e`) introduced it, citing "§XVI.7.5 linkless email carrier". That contradicts §XVI.3 and §XVI.7.4a, so it is reclassified **ANNEX NONCONFORMANCE (Run 1)**, and the fix moves to the front of the slice order (S1). DKIM/DMARC `channel_pass` is transport authentication, not the signed script block.

### A4 Ruling 3: where each function runs

| Function | Layer | Today | After S2b | Where the ruling-3 limit belongs |
|---|---|---|---|---|
| `wrc.captureReference` | desktop, Electron main; local syntax only, no network (`wrcRuntime.ts:313-326`) | no route | behind the gate (harmless) | nothing: syntax-only checks are allowed without an account |
| `wrc.submitReference` | desktop, Electron main; runs the six gates, and the Gate-5 claim reserves the entry (`wrcRuntime.ts:343-378`) | no route; no session check; SSO email optional (`:355-361`) | **structurally session-bound**, if routed without the `skipVaultContext` escape (below) | desktop route (S2b) |
| `wrc.acceptReference` | desktop, Electron main; consumes one use via CAS (`wrcRuntime.ts:473-526`) | no route; no session check | **structurally session-bound** (same condition) | desktop route (S2b) |
| `wrc.resolvePublisher` | desktop function that **renders a resolver response**: it fetches `/v1/resolve/{part}` and, given an `entryId`, the entry and objects from the WRC registry (`wrcTransport.ts:86-100`), verifies them locally, and returns the verified response (`wrcRuntime.ts:543-563`) | no route; returns whatever the resolver served | behind the gate, so no-account use via the desktop disappears (the ruling says checks "may" be account-free) | **resolver response contract**: what the registry serves to an unauthenticated caller (class, publisher, domain; status for P and public sub-handshakes) is a **contract v2.0 delta item (S2)**, not a desktop slice |

**The gate S2b would reuse.** The ledger opens only after SSO login, from a token built from the user's `sub`/`iss` (`main.ts:582-591`). The `handshake.*` branch refuses when neither the ledger nor the vault DB is open (`main.ts:3354-3378`). However, a caller-supplied `skipVaultContext` bypasses that refusal for every method not on `vaultRequiredMethods` (`:3359-3376`). S2b must therefore either route `wrc.*` under its own prefix, requiring an open ledger and refusing `skipVaultContext`, or put all four `wrc.*` methods on the required list. With that, submit and accept are structurally session-bound.

**Residual.** The claimant's party ID, device ID and principal keys come from environment variables (`wrcIdentity.ts:81-95`); only the SSO email comes from the session. "Account-bound" after S2b therefore means session-required and SSO-attributed. It does not mean the claimant identity is derived from the account (Q19).

### Updated D4 verdicts

| # | Before | After |
|---|---|---|
| 1 | CONFORMANT / NOT YET IMPLEMENTED; annex text superseded | **SPEC-PENDING — new Annex XVI** (A2) |
| 2a, 2c | CONFLICT | **CONFORMANT** (A1); observation O-A1 goes into S2 |
| 3b | CONFLICT (latent) | desktop: fixed structurally by **S2b** (session-required); identity residual Q19 |
| 3c | CONFLICT (latent) | **resolver-contract item, S2** (not a desktop slice) |
| 4 | CONFLICT with ruling | **ANNEX NONCONFORMANCE (Run 1)**, §XVI.3 + §XVI.7.4a; fix = **S1**, first |

---

## Part B — Author Decision Packet

### B1 Resolved by the agent (no Author input needed)

- **Q1 → no.** DKIM/DMARC is not a "signed publisher block". Annex v1.95 §XVI.3 (p. 9) and §XVI.7.4a (p. 26) accept only the signed WR script block for automatic detection or insertion; loose references are manual capture only.
- **Q2 → effects are submit and accept.** `wrc.submitReference` (Gate-5 claim and admission) and `wrc.acceptReference` (consumption) need an account. `wrc.captureReference` (local syntax) and `wrc.resolvePublisher` (a check) are not effects; the check's disclosure limit goes into the resolver contract (S2). Evidence: ruling 3; `wrcRuntime.ts:321-326,343-378,473-526,543-563`.
- **Q3 → SPEC-PENDING.** A committed annex outranks a ruling, and §XVI.13.2 (pp. 36–37) governs until a new Annex XVI is committed. There is no code change, because no inheritance path exists (`formationPipeline.ts:301-303`).
- **Q4 → keep the per-entry signatures.** Ruling 2 covers non-addressable sub-contexts only, and every signed, status-bearing entry is addressable (A1).
- **Q8 → adopt the on-disk run numbering.** Run 3 = entry designation, Run 4 = trust/directory, Run 5 = runtime; the commit subjects and report filenames already use it. The unexecuted Run-3 items move to S2 (contract delta) and S5 (display origin).
- **Q10 → done.** The salvage branch is preserved as a verified bundle at `C:\dev\archive\salvage-edge-and-host-ai.bundle` (448.1 MB, complete history, head `84363010`); see C1.
- **Q13 → no drop needed.** `stash@{1}` and `stash@{2}` are archived as pushed branches `archive/stash-1-20260516` (`8dd69921`) and `archive/stash-2-20260516` (`58071411`); see C2.
- **Q16, routing part → dedicated prefix.** A dedicated `wrc.` dispatcher prefix behind the ledger/session gate, without the `skipVaultContext` escape (`main.ts:3354-3378`; A4). UI placement stays open as Q16.

### B2 Questions for the Author (ordered by the next slice they block)

**Q17 — Should the agent draft the contract v2.0 delta from what the client already expects, for you to ratify, or will you write it?**
- Why it matters: every publisher-side component (WRC service, `wr-connect.php`, relay) needs one wire contract, and the client has already drifted from v1.0/v1.1 (a new directory endpoint, a changed `entry_id` meaning, new fields).
- A: the agent drafts it. It records the current client expectations, adds the ruling-3 disclosure limit for no-account resolver responses, and marks the relay/capsule legs as open; you ratify. S2 starts now, and ratification is your only cost.
- B: you write it. S2, and with it S2b and S7, wait for your text.
- Recommended: **A**, because the drift is already listed item by item in the report (T1), so the draft is mostly transcription.
- Blocks: S2, S7.

**Q7 — Can you commit the Run 2–5 order files to `docs/orders/`?**
- Why it matters: the Runs 3–5 acceptance review (S2a) can compare against the reports only; with the orders it can compare delivered against ordered, and the Run-3 carry-over list depends on the order text.
- A: you commit them. S2a checks against the orders, and the Run-3 "identity bindings" question closes.
- B: no orders. S2a reviews against the annex and the reports only, and "identity bindings" stays UNVERIFIED.
- Recommended: **A**, because it costs one upload and removes the only UNVERIFIED item in the run history.
- Blocks: S2a (full), S5.

**Q14 — May the typecheck blind-spot diagnosis and the two type-error fixes run now, before the rig pass, instead of after it as you ruled on 2026-08-11?**
- Why it matters: the blind spot hides type errors in exactly the Run 1–5 files that S2b will make reachable, and two real errors are already known.
- A: now, as S3 before S2b. S2b is built on typechecked code.
- B: after the rig as ruled. S2b ships with the blind spot, and the rig exercises code that was never typechecked.
- Recommended: **A**, because S2b turns test-only code into product code.
- Blocks: S3 (and its recommended position before S2b).

**Q16 — Where should the WR Code capture, offer and consent surfaces live first?**
- Why it matters: no product surface reaches them today. S2b must wire them, and four hand checks (HC3–HC6) depend on it.
- A: beside the mail view in the Electron inbox (the Phase-4/5 design); the extension follows later.
- B: the extension side panel first.
- C: both at once, which makes S2b larger (L instead of M).
- Recommended: **A**, because the offer/consent design and the consent-hash wiring already target the mail view.
- Blocks: S2b, S5, HC3–HC6.

**Q19 — Should the WR Code claimant identity (party ID, principal key) come from the signed-in account, or stay deployment configuration as it is today?**
- Why it matters: after S2b, submit and accept require a session, but the claim is still made in the name of an environment-configured party (`wrcIdentity.ts:81-95`). Ruling 3 wants every effect account-bound.
- A: derive it per account. The party ID and principal key are provisioned per SSO account, so effects are attributable to the account. This needs a key-provisioning step (L).
- B: keep the env config in S2b, require the session, and record the SSO email with every claim and acceptance. S2b stays M, and full account binding becomes a later slice.
- Recommended: **B** now with A scheduled, because it keeps S2b small while every effect becomes session-gated and SSO-attributed.
- Blocks: S2b.

**Q9 — Should the Art. 50 de-dup and Rebrand Wave 1 be merged from the WIP branch onto integration?**
- Why it matters: both exist only on `wip/host-2026-08-12-art50-rebrand-w1`, and the rig's visual checks need them in the build.
- A: merge both, drop the build007 → build009 stamp change, and confirm that "G" is the extension popup's disclosure (`PopupChatView.tsx:486`).
- B: merge Art. 50 only; the rebrand comes later.
- C: hold both.
- Recommended: **A**, because both are finished host work and the stamp change is the only unwanted part.
- Blocks: S6, rig items O1/O2.

**Q12 — Should the rig pass be split (handshake checks now, WR Code checks after S2b), or done once after S2b?**
- Why it matters: the handshake hand checks have waited since 2026-08-11, and four of them cannot run until S2b.
- A: split. Run HC1, HC2, HC7, the E10 extras, O2 and O3 now; run HC3–HC6 and W1–W7 after S2b.
- B: one pass after S2b (and S6).
- Recommended: **A**, because it verifies the Phase 1–5 handshake work now, without waiting for UI wiring.
- Blocks: rig pass.

**Q6 — Which annex versions should be committed as the new drops?**
- Why it matters: the desktop copies are newer than the committed ones (XVI v1.96, VII v1.3, XV v1.2, XVIII v1.5, with VI v2.3 on `main` only), and none is normative until it is committed.
- A: commit all the desktop finals and bring VI v2.3 onto integration.
- B: commit only XVI v1.96 and XVIII v1.5 now, the two that block WR Code and PSL.
- C: wait for the next consolidated annex set.
- Recommended: **A**, because VII v1.3 is the handshake-core annex the code cites in 59 files without naming a version.
- Blocks: S8, S9, S10, and a D1 re-run.

**Q5 — Will the next Annex XVI adopt the utility-model class register (SL, R, FC; I in the P form; variable S* blocks), and what should the code report for a well-formed reference of a class it does not know?**
- Why it matters: today such references are rejected, silently dropped by detection, and mislabelled "legacy" when stored. This is the largest pending grammar change.
- A: yes, with a distinct class value for SL. S8 designs against it, and S4 changes the stored-row reason to "unknown class" now.
- B: yes, but no code change at all until the annex is committed. The mislabel stays until then.
- C: no, or only partly; name the classes.
- Recommended: **A**, because the stored-row reason is a local, fail-closed wording fix and independent of the annex.
- Blocks: S8, S4 (classifier reason).

**Q18 — A file named `apps/electron-vite-project/resources/google-oauth-client-secret.txt` is tracked in this public repository. How should it be handled?**
- Why it matters: it may expose an OAuth client secret. Secrets of installed (desktop) app clients are not confidential, but a web-client secret would be. The file was not read.
- A: you confirm it is an installed-app client and accept it; no action.
- B: rotate the secret and stop tracking the file (history keeps the old value).
- C: rotate the secret and rewrite history. This is destructive and needs a separate order.
- Recommended: decide between **A** and **B** after checking the client type in the Google console.
- Blocks: nothing (security).

**Q11 — Should your working folder switch to `C:\dev\optirando` once the clone is proven?**
- Why it matters: the current tree sits in a OneDrive-synced folder, which is a risk to `.git`.
- A: switch, and keep the old folder untouched as a fallback.
- B: stay in the OneDrive folder.
- Recommended: **A**, but only if the clone verdict below is "proven".
- Blocks: nothing (hygiene).

**Q15 — For future coverage maps, is the filed GM1 text v3.125 authoritative, or the later v3.137 (2026-09-07)?**
- Why it matters: two GM1 texts exist, and their claim numbering may differ.
- A: v3.125, the filed and pinned text.
- B: v3.137.
- Recommended: **A**, because it is the filed text that the coverage map cites.
- Blocks: the D3 refresh only.

### B3 Slice plan after Part A

The plan keeps the slice IDs used in the report. Old S2 (ruling 3) splits into S2b (desktop) and S2 (resolver contract). S1 moves to the front because it is an annex nonconformance. S2a is new.

| Slice | Scope | Normative source | Depends on | Size | Waits for |
|---|---|---|---|---|---|
| S0 | Inputs: commit the annex drops and the Run 2–5 order files | §1.4 | — | S | Q6, Q7 |
| **S1** | Remove the ingest-time scan of loose e-mail references. Loose references are captured manually only (`wrc.captureReference`), then submitted. Automatic detection from the signed WR script block waits for script-block verification. Update `wrCodeEmailDetection.test.ts:23,57` and the `productionFullPath.e2e.test.ts:377` case | **§XVI.3, §XVI.7.4a** (also §XVI.5.8, §XVI.7.7) | — | S | nothing (the annex mandates it) |
| **S2** | Contract v2.0 delta doc: `GET /v1/directory/{part}`, the `entry_id` semantics per class, the `designation` and directory-record fields, a prefixed `codes[].canonical`, `_wr` `part=`, the no-account disclosure limit for resolver responses (ruling 3), EVP/object signatures and suspension (O-A1), and the relay/capsule wire legs (define them or mark them open) | WRC contract v1.0/v1.1; §XVI.6.4/6.5, §XVI.7.5, §XVI.7.6 | — | M | Q17 |
| **S2a** | Acceptance review of Runs 3–5 (B4), closing the gaps with tests: a production-wiring test through `initWrcClient`; a preview-hash exclusion guard; a guard for the WR-code scan gate (after S1); a source guard for the Gate-5 delegation; the bearer-at-resolution behaviour recorded for the trusted UI | §XVI.5.7, 5.10, 6.4/6.5, 7.5, 7.6, 8.4, 13.7 | — | S–M | Q7 (for the order comparison) |
| S3 | Fix the 2 TS2322 (`entryLifecycle.ts:90`, `useLimitStore.ts:236`); diagnose the typecheck blind spot | `consolidation-inherited-failures.md:463-491` | — | S | Q14 |
| **S2b** | Production route: a `wrc.` prefix behind the ledger/session gate without `skipVaultContext`, so submit and accept are session-bound, with SSO attribution per Q19. Minimal surfaces: explicit capture trigger, offer list, and consent with `expected_preview_hash` taken from the rendered preview | ruling 3; A4; HC3–HC6 | S1, S2a, S3 (recommended) | M (L for Q16=C or Q19=A) | Q16, Q19 |
| S4 | Hygiene: stale TODOs (`gatePipeline.ts:162,331`); the stored-classifier reason for unknown classes | §XVI.5.2 | — | S | Q5 (reason part) |
| S5 | Show the verified `display_origin` (displayed responsible domain) on the offer/consent surface | Run-3 order; §XVI.6.4/6.5 (exact subsection UNVERIFIED) | S2b | S | Q7, Q16 |
| S6 | Merge the WIP branch (Art. 50 + Rebrand W1) | — | — | S | Q9 |
| — | **Rig pass** (B5) | — | S2b (+ S6), or split per Q12 | — | Q12 |
| S7 | Establishment Commitment / acceptance record; transport-backed relay and directory | §XVI.13.6, §XVI.7.5.8 | S2, WRC service | L | WRC service |
| S8 | Grammar v3 / class register (SL, R, FC; variable blocks; the I form; class values) | **SPEC-PENDING — new Annex XVI** | a committed annex | L | Q5, Q6 |
| S9 | Umbrella/sub-handshake model: ruling 1, and ruling 2 for non-addressable sub-contexts (none exist yet) | **SPEC-PENDING — new Annex XVI** (§XVI.13.2 governs until then) | a committed annex | L | Q6 |
| S10 | PSL orchestrator side (client, LSEM ingest, Q7 guard, contact capsule) | **SPEC-PENDING — Annex XVIII** | a committed annex; `psl-analysis-v1.md` Q4/Q5/Q8; the v0.21.4 contract | L | Q6 |

### B4 Acceptance table, Runs 3–5 (from their reports)

"Evidence present" means the suite exists and is green in both tip captures of 2026-09-25 (`captures/resync-2026-09.before.8f0a5643.txt`).

| Run | Claimed capability | Annex § claimed | Module | Test suite (tests) | Evidence present | Gap |
|---|---|---|---|---|---|---|
| 3 | Canonical entry designator (per class, derived in the pipeline, collision-free key) | §XVI.5.10, 5.11 | `entryDesignator.ts` | `entryDesignator.test.ts` (35) | yes | — |
| 3 | C ordered pair (role order; a reversed pair is refused) | §XVI.5.10 | `entryDesignator.ts`, `gatePipelineAdapter.ts` | `entryDesignation.e2e` (15) | yes | — |
| 3 | Combination expansion by the resolver only; lookup by the combination block | §XVI.5.10 | `gatePipelineAdapter.ts:122-126` | `entryDesignation.e2e` | yes | the `entry_id` semantics are not in contract v1.0 → S2 |
| 3 | S* parent binding (SP→P, SI→I, SC→C, SE→any) | §XVI.5.10, 13.2 | `entryDesignator.ts`, `gatePipelineAdapter.ts` | `entryDesignation.e2e`, `entryDesignator.test` | yes | the SE parent's "established handshake" check is structural only (Run-3 report) |
| 3 | Receiving-party granularity at Gate 4 | §XVI.5.10 | `gatePipeline.ts` | `entryDesignation.e2e` | yes | — |
| 3 | Non-destructive persistence of designator keys | §XVI.8.4 | `useLimitStore.ts` | `useLimitStore.test` (27) | yes | — |
| 4 | The Namespace Directory replaces the interim anchor (dual-signed record, operator anchor and rollover, generation floor, vetted attestation, DNS part proof) | §XVI.6.4, 6.5 | `namespaceDirectory.ts` | `directoryGate2.e2e` (20) | yes | the DNS part proof checks only `domains[0]` (`:480`); `/v1/directory` is not in the contract → S2 |
| 4 | SSO principal binding (email domain within the DNS-verified domains) | §XVI.6.5, 7.6 | `gatePipeline.ts:626-644`, `gatePipelineAdapter.ts:201-225` | `directoryGate2.e2e` | yes | fires only when SSO is present → S2b |
| 4 | SE session/expiry lifecycle | §XVI.5.7 | `gatePipeline.ts:680-699` | `seSessionLifecycle.e2e` (10) | yes | no renewal (none is defined in the annex) |
| 4 | Device Record / Device Pass / Registered Counterpart Device | §XVI.13.7 | `deviceRegistry.ts` | `devicePass.e2e` (12) | yes | the live proof-of-possession over P2P is deferred (transport) |
| 4 | Pairing slot → Device Record | §XVI.5.10, 8.4 | `pairingSlots.ts` | `pairingSlots.e2e` (10) | yes | — |
| 4 | Gate 5 relay-release chain | §XVI.7.6 G5, 7.5.5, 7.5.9 | `relayRelease.ts` | `relayRelease.e2e` (16) | yes | the relay is a local store with no wire contract → S2, S7 |
| 4 | Gate 6 capsule admission plus sealed nonce | §XVI.7.6 G6, 7.5.2, 7.5.7 | `capsuleAdmission.ts` | `capsuleAdmission.e2e` (17) | yes | the AEAD construction is an implementation choice; the annex names only the key |
| 4 | Full-chain matrix, per class and per gate | §XVI.7.6 | `gatePipeline.ts` | `fullChain.e2e` (22) | yes | — |
| 5 | Production composition root; runtime-owned identity | §XVI.7.6 trust boundary | `wrcRuntime.ts`, `wrcIdentity.ts` | `wrcRuntimeComposition` (4) | partial | no test calls `initWrcClient`; the claimant identity comes from env (Q19); **no product route** (A4) → S2a, S2b |
| 5 | Durable security DB; fail-closed open | §XVI.6.5 (floors) | `wrcSecurityDb.ts` | `productionFailClosed.e2e` (3) | yes | deleting the file resets the floors (protection by location only) |
| 5 | Durable directory generation floors | §XVI.6.5 | `wrcSecurityDb.ts` v1, `namespaceDirectory.ts` | `directoryGenerationFloorDurability.e2e` (10) | yes | — |
| 5 | Durable device registry | §XVI.13.7 | `deviceRegistry.ts` (DB) | `deviceRegistryDurability.e2e` (10) | yes | — |
| 5 | Relay replay ledger and Gate-6 request-id idempotency | §XVI.7.5.9 | `relayRelease.ts`, `capsuleAdmission.ts` (DB) | `replayIdempotencyDurability.e2e` (15) | yes | — |
| 5 | Explicit acceptance token protocol (consume at acceptance) | §XVI.8.4 | `wrcRuntime.ts:380-526` | `explicitAcceptance.e2e` (8) | yes | no account requirement → S2b |
| 5 | Restart/crash/concurrency matrix | §XVI.8.4, 7.5.9 | all stores | `restartConcurrencyMatrix.e2e` (10) | yes | — |
| 5 | Production full path, all 7 classes, through the RPC dispatcher | §XVI.7.6 | `handshake/ipc.ts` (`handleHandshakeRPC`) | `productionFullPath.e2e` (14) | partial | the test calls `handleHandshakeRPC` directly; the product dispatcher does not route `wrc.*` → S2b |
| 5 | Production wiring proofs (relay, device, capsule through the runtime) | §XVI.7.6 | `wrcRuntime.ts` | `productionWiring.e2e` (13) | yes | — |
| 5 | Bounded lazy maintenance | — (operational) | `wrcSecurityDb.ts` | `persistenceMaintenance.e2e` (7) | yes | — |

Every claimed capability has a green suite. The two "partial" rows are the reachability and wiring gaps that S2a and S2b close. All 29 `wrc/__tests__` suites are green at the tip; `httpsClient.hardening` skips its 2 live-TLS tests by design.

### B5 Combined rig checklist (report §F.3, verbatim)

The slice IDs inside the verbatim text are the report's. Under this addendum's plan, "S2" in W6 means **S2b**. The "Performable after" line under each group is added by this addendum.

> **When:** after S1–S3 and S2b, and after S6 if the rebrand belongs in the rigged build, but before S7 and anything later. It should be one pass. Without S2b, four of the seven hand checks (HC3–HC6) cannot be performed, because the product has no route to those surfaces. If a pass is wanted sooner, split it (Q12): run HC1, HC2 and HC7 plus the "Other" items now, and HC3–HC6 plus the WR Code items after S2b. There is nothing on the PSL side to rig.
>
> **Handshake refactor: the seven hand checks (`psl-analysis-v1.md:237-253`)**
>
> 1. HC1: the non-suppressible rule-8 alert renders identically on an unauthenticated message on all three surfaces (`EmailMessageDetail`, `LinkWarningDialog`, `BeapMessageDetailPanel`), with no dismiss control.
> 2. HC2: a provenance-failed message produces zero derived affordances. After S1 this includes no WR-code detections.
> 3. HC3: manual entry completes the full chain for that same message. **Blocked until S2b.**
> 4. HC4: EVP-first render; the offer shows the signed value statement, never carrier text; no verified EVP means no offer. **Blocked until S2b.**
> 5. HC5: `expected_preview_hash` is computed from what was rendered and passed to consent. **Blocked until S2b**; the pin is optional today (`formationPipeline.ts`).
> 6. HC6: status surfaces for revoked, inactive, compromised (with warning), superseded (successor shown) and expired; an unknown code is a capture error. **Blocked until S2b.**
> 7. HC7: extension sanity. The MV3 build resolves the `@repo/shared-beap-ui` alias, loads unpacked, reloads, and `[RUNTIME_IDENTITY]` matches the stamp.
>
> Additional items from the E10 manifest (`pre-flight-report.md:216-236`): the Electron app builds and launches; cross-device handoff is out of scope and must not be assumed covered.
>
> **WR Code (Runs 1–5), all after S2b**
>
> 1. Manual entry captures or rejects each class with the correct reason.
> 2. Submission runs all six gates and yields an acceptance token; `accept` succeeds once, and a second accept is refused as `CONSUMED`.
> 3. `wrc-security.db` sits under `~/.opengiraffe/electron-data/` (or `WRDESK_WRC_SECURITY_DB`), and a floor or device revocation survives a restart.
> 4. A corrupt or locked security DB makes submission fail visibly, with no memory fallback.
> 5. After S1: no detection at ingest; the explicit trigger works; mail that fails DKIM is never scanned.
> 6. After S2: submission and acceptance are refused without SSO; capture and `resolvePublisher` still work.
> 7. A legacy offer row gets `WR_CODE_LEGACY_FORMAT` at consent.
>
> **Other**
>
> 1. Art. 50: only the intended disclosure mounts are visible (if S6 is merged).
> 2. Rebrand: names and logos in the app and extension; coordination runs on `relay.optirando.com` (v72).
> 3. llama.cpp: speech-bubble mode opens the allocated session's grids and agent boxes; record which log codes appear.

**Performable after:**

- **HC1:** now.
- **HC2:** now (the WR-code part after S1).
- **HC3–HC6:** S2b.
- **HC7 and the E10 extras:** now.
- **W1–W4:** S2b.
- **W5:** S1 (the explicit trigger after S2b).
- **W6:** S2b. Note that with S2b, capture and `resolvePublisher` also sit behind the login gate, so its "still work" means "work when signed in".
- **W7:** S2b.
- **O1:** S6.
- **O2:** now (the rebrand names after S6).
- **O3:** now.

### B6 Answer template

`Q17: _  Q7: _  Q14: _  Q16: _  Q19: _  Q9: _  Q12: _  Q6: _  Q5: _  Q18: _  Q11: _  Q15: _`

---

## Part C — Safe housekeeping (results)

**C1 Bundle (done).**

- Command: `git bundle create C:\dev\archive\salvage-edge-and-host-ai.bundle feature/salvage-edge-and-host-ai` (target folder created; nothing overwritten).
- Size: **469,857,793 B (448.1 MB)**. sha256 `dd4bc8e0a3c2d430f122890e49612513cf3c189e7c0c4a3234a7ffe3df63fe1d`.
- `git bundle verify`: "The bundle contains this ref: `8436301092b3e312aee8a3acbba46aa8046cd074 refs/heads/feature/salvage-edge-and-host-ai` … The bundle records a complete history … is okay".
- The head equals the branch tip, and the branch was not touched.

**C2 Stash archives (done).**

- `archive/stash-1-20260516` → `8dd69921` (= `stash@{1}`) and `archive/stash-2-20260516` → `58071411` (= `stash@{2}`).
- Both were pushed as new branches. `git stash list` still shows all three stashes; nothing was dropped.

**C3 Fresh clone.** It runs after this commit's push, to `C:\dev\optirando`. The permitted change set is a single commit, so the verdict is reported in the chat reply rather than here.

**C4 What a clone will not have.** `git status --ignored` in the old tree gives 46 collapsed entries. Excluding `node_modules`, `dist`, `dist-electron` and build caches leaves 28:

| Item | Type | Required to run or build? |
|---|---|---|
| `code/.claude/settings.local.json` | local tool config (ignored) | no (editor/assistant settings only) |
| `code/apps/extension-chromium/build009/` | extension build output | no, it can be rebuilt. If Chrome's "load unpacked" points here, repoint it after rebuilding in the new folder |
| `code/apps/edge-agent/`, `code/packages/{agent-credential-envelope, agent-log-events, beap-cert, email-fetch, pod-client, podman-probe, role-policy, sso}/` | leftovers from other branches (only `dist/` and `node_modules/` inside) | no; no tracked `package.json` references them |
| 17 `*.log` files (9 in `code/`, 7 in `code/apps/electron-vite-project/`, `code/apps/extension-chromium/ext-build.log`) | run and build logs | no |

- **Secrets and config sweep, paths only, contents not read:** there are no `.env` files in the tree (only the tracked `code/.env.example`), no certificates or key files, and no local databases inside the tree.
- **One tracked secret-named file:** `code/apps/electron-vite-project/resources/google-oauth-client-secret.txt`. The clone *will* have it, and it is in a public repository (Q18).
- **Outside the tree, and unaffected by the folder change:**
  - WRC and deployment environment variables (`WRDESK_WRC_*`, `WRDESK_*`);
  - user data in `%USERPROFILE%\.opengiraffe\`, including `electron-data\wrc-security.db`;
  - Electron build output in `C:\build-output\`.

**C5 Absolute paths containing `OneDrive` or `code_clean`** (tracked files; 1,899 lines in 31 files; nothing changed).

- **Bulk: every line is an absolute test-file path in a failure identity or test dump.**
  - `code/vitest-audit-failures1.json` (398), `vitest-audit-failures2.json` (398), `vitest-triage-failures-flat.json` (279), `vitest-audit-failures-flat.json` (201), `vitest-new81-failures.json` (65), `vitest-triage-buckets.json` (11), and `vitest-audit-run1.json`, `vitest-audit-run2.json`, `vitest-triage-output.json`, `vitest-5a-output.json` (1 each).
  - The capture files `docs/analysis/captures/resync-2026-09.before.8f0a5643.txt` (164) and `…tsc-app.txt` (1), `annex-xvi-v193/captures/…phase0.after.a62d4856.txt` (156) and `…analysis.before.66dc5fe8.txt` (155).
  - `extension-tsc-errors.txt` at the repo root (16).

  Identity comparison across folders must strip this prefix; C3 does so.
- **Code:** `code/apps/electron-vite-project/scripts/verify-windows-unpacked.cjs:144`, which is an error-message string only ("OneDrive/cloud sync on C:\build-output"), not a path used at runtime.
- **Docs and notes:**
  - `SURFACE_FAILURE_REPORT.md:141`
  - `code/CURSOR_WORKSPACE_ROOT.txt:1,2,6,8`
  - `code/FINAL_VAULT_IMPLEMENTATION_REPORT.md:5`
  - `code/IMAP_EMAIL_CONNECTION_ARCHITECTURE_REPORT.md:262`
  - `code/apps/electron-vite-project/FORENSIC_NODE_FETCH_REPORT.md:85`
  - `code/apps/electron-vite-project/TRANSITIVE_DEPS_FIX.md:92`
  - `code/apps/extension-chromium/force-reload-instructions.txt:25`
  - `code/docs/BUILD_INSTRUCTIONS.md:10,105`
  - `code/docs/analysis/annex-xvi-v193/implementation-state-analysis-v1.md:60`
  - `code/docs/analysis/resync-2026-09.md:3,49,552`
  - `code/docs/current-issues-analysis.md:472`
  - `code/docs/email-issues-analysis.md:3`
  - `code/docs/imap-debug-report.md:223`
  - `code/docs/imap-final-analysis.md:12,67,81,111,125,142,158,199,207,232,274,316`
  - `code/docs/imap-password-trace.md:20,72,100,185,197,213,227,258,386,434,489,518,561,632,649,657,692,731,768`

**C6.** The old folder was not deleted, moved or renamed, and no OneDrive or editor setting was changed. Switching folders is the Author's step (Q11).
