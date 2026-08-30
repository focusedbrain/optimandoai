# WR Code Implementation State vs. Annex XVI v1.93 — Analysis v1.0

**Status: DELIVERED WITH A RATIFICATION HOLD.** The annex body was located and is
verifiably v1.93 in content, but it did **not** arrive as the input the mission
specifies (`Annex_XVI_WR_Code_v1.93.md` in the working tree, sha256 matched
against an author-drop commit message). The formal STOP condition of §2.1 is
therefore **triggered on provenance**, not on substance. Because the substance is
verifiable and self-consistent, this report is delivered in full and every annex
claim is section-cited — but **no Order may be cut from it until Q1 is answered**
(§7). Analysis only. No code, test, fixture, or dependency was changed.

Date 2026-08-30. Branch `integration/consolidated-current`.

---

## 1. Header — identity of every input

| Item | Value |
|---|---|
| `HEAD` at analysis start | `66dc5fe85c84a5c51ed9d4e22f801455789c9c63` (`chore(build): build007 stamp`) |
| Branch | `integration/consolidated-current` (no new branch created) |
| Runner invocation | `pnpm test:native-db --reporter=json --outputFile=<capture>` — run once, verbatim, at analysis start |
| Capture artifact | `docs/analysis/annex-xvi-v193/captures/annex-xvi-v193-analysis.before.66dc5fe8.txt` |
| Validity guard | `testResults.length = 563` ≥ 100 ⇒ **VALID** |
| Counts (both recorded per the guard) | `numTotalTests 6117` · `numPassedTests 5908` · `numFailedTests 155` · `numTotalTestSuites 2048` · `numFailedTestSuites 108` · failing assertion identities **155** |
| Annex file analysed | `C:\Users\oscar\OneDrive\Desktop\siliconcargo-research-paper-v202-r2-plusAnnexes-I-XVIII -v18\Annex XVI - WR Code® - Transport-Agnostic Reference and Resolution Architecture.pdf` |
| Annex sha256 | `BC108E028CA35AFC1543787576BF4017378AE5F98C0717F3D8E4DBF7961E8D19` |
| Annex size / mtime | 3 560 340 bytes · 2026-08-29 09:51:51 |
| Annex pages | 74 |

There is no after-capture: this is an analysis pass.

### 1.1 Input verification — what failed and what did not

Measured, not assumed:

| Check | Result |
|---|---|
| `Annex_XVI_WR_Code_v1.93.md` present in working tree | **ABSENT** — glob for `**/*Annex*XVI*` across the repo returns 0 files |
| Author-drop commit on `main` carrying the annex + sha256 | **ABSENT** — the only annex-bearing commit is `e61a8b64` "Add files via upload" (focusedbrain, Fri 14 Aug 2026). No sha256 in any commit message |
| Annex XVI **on** `origin/main` | Present but **superseded**: blob `738ce1e2`, **1 550 937 bytes**, committed 14 Aug 2026 — a different, older artifact than the 3 560 340-byte file supplied |
| Supplied file identity self-consistent | **NO — internal contradiction** (see below) |
| Supplied file content is v1.93 | **YES** — corroborated twice independently |

**The internal contradiction.** The title block reads `Version 1.93 - Consolidated
Technical Disclosure - 24 August 2026` (p. 1), and §XVI.18 Version History carries
an explicit `v1.93 - 24 August 2026` entry. But the running page header on **all
74 pages** reads `Annex XVI — WR Code® — Version 1.3 — 19 August 2026`. A regex
sweep for `Version 1.\d+ — <date>` over the whole extracted text returns exactly
one string: `Version 1.3 — 19 August 2026`.

**Disposition.** Two independent in-document attestations (title block, §XVI.18)
say v1.93; the third (running header) is a stale template artifact that was not
re-stamped. The body content decides it: the document contains the final class set
P/I/C/SP/SI/SC/SE (§XVI.5.1), the six-gate boundary (§XVI.7.6), `use_limit`
(§XVI.8.4), `display_origin` (§XVI.9.4), Device Pass (§XVI.13.7), and §XVI.5.12 —
every one a v1.93 marker named in the mission brief. I treat the body as v1.93 and
the header as a defect (**Q2**).

---

## 2. Headline findings, before the matrix

Four results change the shape of any phase plan, so they are stated up front.

**F1 — The check core survives v1.93 completely, bit for bit.** This was not
expected. §XVI.5.4 defines the check over `[class values] ‖ [body values]`, and
Appendix A.3 states that the Class Value Table "coincide[s] with the Crockford
input values of the class symbols, so the computation equals running the algorithm
over the complete alias-normalized string". I confirmed the coincidence
arithmetically — the annex's class values are exactly the repo's `ALPHABET` indices
(P=22, I=1, C=12, S=25, E=14) — and then ran **all seven Appendix A.2 positive
vectors and all five negative vectors** through the repo's unmodified v1.4
functions (`packages/ingestion-core/src/wrCode.ts:31-74`). Every one agrees:

| Class | Annex A.2 reference | Annex check | Repo `computeCheck` |
|---|---|---|---|
| P | `P-WR7X4K-9B2M3C` | `C` | `C` ✓ |
| I | `I-K4T9M2-7QFA3X-S` | `S` | `S` ✓ |
| C | `C-ABC123-XYZ789-H` | `H` | `H` ✓ |
| SP | `SP-WR7X4K-H2N5V8-7` | `7` | `7` ✓ |
| SI | `SI-K4T9M2-3ZDQ7E-H` | `H` | `H` ✓ |
| SC | `SC-ABC123-M8W2R4-0` | `0` | `0` ✓ |
| SE | `SE-WR7X4K-6TCJ9F-P` | `P` | `P` ✓ |

All five A.2 negatives — single substitution, adjacent transposition, **prefix
substitution** (`P-WR7X4K-H2N5V8-7`), transposed Publisher Identifiers in a C
reference, altered check — fail under the repo's `verifyCheck`, exactly as the
annex requires. The three A.2 alias rows (`p-wr7x4k-9b2m3c`, `PWR7X4K9B2M3C`,
`C-ABCl23-XYZ789-H`) all verify. Consequence: **the arithmetic primitive, the
alphabet, the quasigroup, and the transcription guard that pins them are not part
of the migration.** The migration is entirely in the *framing* around them.

**F2 — The framing is where every contradiction lives.** `parseStructure` mis-slices
every v1.93 class. Measured: for `P-WR7X4K-9B2M3C` it returns
`publisher: "PWR7X4"`; for `SP-WR7X4K-H2N5V8-7`, `publisher: "SPWR7X"`. It cannot
be right, because it has no notion that a prefix exists
(`packages/ingestion-core/src/wrCode.ts:80-89`).

**F3 — The email slice does not encode the old grammar end to end.** The mission's
§4.4 premise is that detection, manual entry, offer construction, and CPR interplay
all carry the 12-char prefix-less form. **Detection and manual entry do not exist
at all.** There is no WR-code regex anywhere in `apps/**` or `packages/**`; the
email path's only extraction function handles BEAP capsules and message packages,
not textual references (`apps/electron-vite-project/electron/main/email/messageRouter.ts:401-435`);
and there is no renderer surface in which a user types a WR Code. The blast radius
of the prefix grammar is therefore **much smaller** than the brief assumes — it is
one pure module, one DB schema, one display formatter, and the fixtures. This is
the single most consequential correction in this report.

**F4 — The `G4-6` pairing carve-out is superseded, not merely dated.** v1.93
§XVI.5.10 states normatively that "Device onboarding is an I pairing handshake" and
§XVI.8.4 lists "device pairing codes (I pairing handshakes with a Pairing Slot)"
among use-limited entries. The repo holds the opposite as an explicit, guarded
invariant (`packages/ingestion-core/src/wrCode.ts:14-17`;
`packages/coordination-service/src/pairingCodeRegistry.ts:18-34`). See **CR-9** and **Q5**.

---

## 3. State Matrix

Verdicts: `CONFORM` · `SUPERSEDED` (implemented, contradicts v1.93) · `PARTIAL` ·
`ABSENT` · `DOC-ONLY` · `UNCLEAR → Q`.

"Typecheck coverage" records the named `@repo/ingestion-core` blind spot
(`docs/analysis/wr-code-email-e2e/pre-flight-report.md:290-294`: 46 unresolved
imports ⇒ importing files are not effectively typechecked headlessly). **BLIND** =
the file imports `@repo/ingestion-core`.

### 3.1 Reference grammar (§XVI.5)

| # | v1.93 requirement (section) | Implementation evidence | Verdict | Typecheck |
|---|---|---|---|---|
| G-1 | Every human-enterable reference begins with a class prefix; final class set P, I, C, SP, SI, SC, SE; R/Q/D/SD do not exist (§XVI.5.1, §XVI.5.2) | No prefix, no class concept anywhere. `wrCode.ts` has no class/prefix symbol; `captureBaselineCode` returns `{canonical, publisher, local, check}` only (`wrCode.ts:109-139`) | **ABSENT** | pkg src |
| G-2 | Class Value Table P=22 I=1 C=12 S=25 E=14 (§XVI.5.4, A.3) | Coincides exactly with `ALPHABET` indices (`wrCode.ts:31`); verified arithmetically | **CONFORM** (implicitly) | pkg src |
| G-3 | Prefix Grammar Registry: TERMINAL / NON_TERMINAL / INVALID; `S` non-terminal (§XVI.5.2) | Grep `PrefixGrammar|prefix_state|terminal_prefix|reference_class` ⇒ **0 matches** repo-wide | **ABSENT** | — |
| G-4 | Block structure P: `P-PPPPPP-LLLLLX`, check **attached** (§XVI.5.1) | `parseStructure` slices `[0,6) / [6,-1) / [-1]` with no prefix offset (`wrCode.ts:80-89`); measured output for `P-WR7X4K-9B2M3C` is `publisher:"PWR7X4"` | **SUPERSEDED** | pkg src |
| G-5 | Block structure I: `I-IIIIII-BBBBBB-X`, 6-symbol combination code, **separate** check (§XVI.5.1, §XVI.5.10) | No combination code, no separate check block, no I class | **ABSENT** | — |
| G-6 | Block structure C: `C-IIIIII-RRRRRR-X` — ordered initiator/responder pair, **separate** check, no local block (§XVI.5.1, §XVI.5.6) | No second publisher block. Schema has `publisher_part` + `entry_local_part` only (`connectOfferStaging.ts:64-66`) | **ABSENT** | BLIND |
| G-7 | SP/SI/SC/**SE** uniform: `ST-PPPPPP-BBBBBB-X`, separate check, **no SC exception** (§XVI.5.1) | No sub-handshake class of any kind | **ABSENT** | — |
| G-8 | Check on **every** human-enterable reference, all classes (§XVI.5.4) | `verifyCheck` is unconditional on the capture path (`wrCode.ts:135`) | **CONFORM** | pkg src |
| G-9 | Damm order 32, GF(2⁵), poly x⁵+x²+1, α=2, `x∗y = α·(x⊕y)` (§XVI.5.4, A.1) | `mulAlpha` + `star` (`wrCode.ts:34-42`), byte-identical to the profile and pinned by `wrCode.profileTranscription.guard.test.ts` | **CONFORM** | pkg src |
| G-10 | Appendix A.2 vectors, positive **and** negative | All 7 positives + 5 negatives reproduce (F1) | **CONFORM** | pkg src |
| G-11 | **Prefix participates in the check stem** (§XVI.5.4; A.3 "the computation equals running the algorithm over the complete alias-normalized string") | Extracted, not assumed: because the class values are the Crockford values, folding the whole normalized string *including* the prefix is the specified computation. `verifyCheck` already does this | **CONFORM** | pkg src |
| G-12 | Prefix parsed **before** payload aliasing; a class symbol `I` is never rewritten to `1` (§XVI.5.3) | `normalize` applies `I/L→1`, `O→0` to every position including index 0 (`wrCode.ts:49-60`). Check arithmetic is unaffected (I's class value *is* 1) but class identity is destroyed: `I-…`→`1…`, `SI-…`→`S1…` | **SUPERSEDED** (ordering) | pkg src |
| G-13 | Minimum canonical length: P = 13 symbols (1 prefix + 12 body); I/C = 14; SP/SI/SC/SE = 15 (§XVI.5.8 block table) | `BASELINE_CODE_MIN_LENGTH = 12` (`wrCode.ts:96`); guard is `>= 12` (`wrCode.ts:73-74`). Measured: `verifyCheck('WR7X4K9B2M3P') === true` — a prefix-less 12-symbol code is admitted, though `W` is an INVALID first symbol under §XVI.5.2 | **SUPERSEDED** | pkg src |
| G-14 | Per-class fixed body length detects omission/insertion (§XVI.5.4, §XVI.5.8) | Length is a floor (`>= 12`), not a per-class equality; extended forms 13/14 are first-class (`wrCode.conformance.test.ts:72-73`) | **SUPERSEDED** | BLIND |
| G-15 | Reference grouping — four blocks; check separate for I/C/S* (§XVI.5.1) | `formatBaselineCodeForDisplay` emits three blocks `PPPPPP-LLLLL-C`, check always attached (`wrCode.ts:147-151`) | **SUPERSEDED** | pkg src |
| G-16 | Generalized reference structure — typed field list declared per class (§XVI.5.11) | Architecture cannot represent it: one fixed 6+n+1 shape, no class dispatch, no field-list indirection (`wrCode.ts:80-89`) | **SUPERSEDED** | pkg src |
| G-17 | §XVI.5.12 rationale + encompassed simplified variants (green-marked) | Design rationale; no runtime obligation | **DOC-ONLY** | — |
| G-18 | Reference alphabet excludes I, L, O, **U** (§XVI.2) | `normalize` returns `null` on `U` (`wrCode.ts:56`); pinned at `wrCode.conformance.test.ts:272` | **CONFORM** | pkg src |
| G-19 | Case-insensitive capture; separators not identifier material; all groupings MUST be accepted (§XVI.5.1, §XVI.5.3) | `normalize` folds case and drops separators (`wrCode.ts:49-60`) | **CONFORM** | pkg src |
| G-20 | Illustrative examples are registry-derived (§XVI.5.5) | Repo fixtures are the **old** vectors (`WR7X4K9B2M3P` etc.) | **SUPERSEDED** (fixtures) | BLIND |

### 3.2 Invariants P11 / P12 / P15, carriers, wake cue

| # | v1.93 requirement | Evidence | Verdict | Typecheck |
|---|---|---|---|---|
| P-1 | P11 identifier permanence; terminal state stays resolvable (§XVI.3, §XVI.8.2) | Insert-only publisher ledger, no DELETE path (Contract v1.0 §1.2); epoch floor is raise-only (`wrc/epochFloorStore.ts:40-66`) | **CONFORM** | — |
| P-2 | P12 local re-rendering; received artwork never displayed in the trusted surface (§XVI.3, §XVI.7.4 3b) | `renderCodeForDisplay` derives display from the validated canonical only (`wrc/offerPresentation.ts:123-125`); offer refused without verified EVP (`offerPresentation.ts:86`); EVP-first-render is a contract obligation (Contract v1.0 §5.4) | **CONFORM** | BLIND |
| P-3 | P15 no external links; reference never a URL; repository links runtime-constructed from a pinned endpoint (§XVI.3, §XVI.4.3) | `audit_url` is a staged column (`connectOfferStaging.ts:75`). Whether it is runtime-constructed from a pinned endpoint or carried from resolved material is **not established at line level in this pass** | **UNCLEAR → Q6** | BLIND |
| P-4 | Any class on any carrier; no carrier is a trust source (§XVI.1.2, §XVI.9.3) | Ingress registry has only `wr_code_public` / `wr_code_red` (`ingestion-core/src/ingressRegistry.ts:24-25`) — two visual-scan slots, not a carrier-agnostic model | **PARTIAL** | pkg src |
| P-5 | Text-first order for visual composites; machine payload decoded only after text verifies (§XVI.9.4) | No QR/Data Matrix decode path exists at all | **ABSENT** | — |
| P-6 | Wake cue "WR Code" (spoken and written, with/without colon) (§XVI.7.7, §XVI.5.9) | Grep `script_block|scriptBlock|risk_class` ⇒ no WR wake-cue or designation handling | **ABSENT** | — |
| P-7 | Capture risk classes 0–4; class 3 sandbox-only, never auto-inserted; class 4 never a capture path (§XVI.7.7) | `captureMethods.ts` registers methods (`scan`, `manual_entry`, `assisted_email`, `assisted_discovery`) with **no** risk class or execution-locus field (`ingestion-core/src/captureMethods.ts:20,43-50`) | **ABSENT** | pkg src |
| P-8 | Signed WR script block; auto-insertion only from a verified block; connector hash registered in the directory record (§XVI.7.4a) | Absent (grep above). Note the repo's CPR gate is a *different* mechanism at the same seam | **ABSENT** | — |
| P-9 | One umbrella offering per carrier instance; >1 parent-class reference ⇒ malformed, no offer (§XVI.7.4 3a, §XVI.9.1) | No such rule; no parent-class notion | **ABSENT** | — |
| P-10 | DETECTED → INSERTED → COMPLETE → SUBMITTED → … as distinguishable states; **no network access before SUBMITTED** (§XVI.7.7, §XVI.5.8) | `captureBaselineCode` is a single synchronous verdict with no state machine (`wrCode.ts:131-139`). The *invariant* (reject before resolve) is structurally enforced — an `ok:false` caller has nothing to resolve with (`wrCode.ts:120-130`) — but the state model is absent | **PARTIAL** | pkg src |

### 3.3 Six-gate boundary (§XVI.7.6)

| Gate | v1.93 obligation | Nearest implementation | Verdict | Typecheck |
|---|---|---|---|---|
| **1** Local syntax + submission | Normalize, parse prefix to terminal, frame by class-fixed lengths, class-aware check, explicit submission | `captureBaselineCode` (`wrCode.ts:131-139`) does normalize + length + check. No prefix parse, no class framing, no SUBMITTED act | **PARTIAL** | pkg src |
| **2** Namespace verification | Dual signature (**operator and publisher**), status ACTIVE, verified account holder, DNS entry naming the Publisher Identifier; **plus** the receiver's own acting principal's SSO email inside its own publisher's DNS-verified domain | Strong on two of four: DNS `_wr` root pin + manifest agreement (`wrc/dualChannel.ts:81-88,110-136`), status gate (`wrc/entryStatusSurface.ts:198-201`). **Dual signature is a different pair** in the repo — publisher signature + WRC *ingest* countersignature (Contract v1.0 §1.5), not directory-operator + publisher (§XVI.6.4). The email-domain condition is absent | **PARTIAL** | BLIND |
| **3** Entry verification | Entry exists, matches registered assignment and version exactly, state admits a request (PENDING for invitation, **ACTIVE** for an offering); combination code expanded for sub-handshake classes; no pre-consent material | Entry decode + `status !== 'published'` ⇒ `entry_not_published` (`wrc/resolutionClient.ts:238-243`); re-checked at consent (`connectOfferStaging.ts:611-616`). Vocabulary differs (`published|suspended|retired`, `wrcContract.ts:110`). No combination-code expansion | **PARTIAL** | BLIND |
| **4** Self-match | Reference is addressed to the receiver: C ⇒ second block is the receiver's own Publisher Identifier; I/S* ⇒ receiver's Party Identifier matches the receiving-party constituent at the bound granularity; else `NOT_FOR_YOU` / `NOT_FOR_THIS_DEVICE` | A self-match exists but on a **different object**: capsule sender claims vs. bound counterparty (`handshake/steps/ownership.ts:64-72,88-95`; `handshake/ingressAdmission.ts:198-205`; `ingestion-core/src/identityGuard.ts:93+`). Nothing checks a *reference block* against the receiver. Grep `NOT_FOR_YOU|NOT_FOR_THIS_DEVICE` ⇒ **0 matches** | **PARTIAL** (wrong object) | BLIND |
| **5** Recipient-bound release (Relay) | Claim signed with the Principal Key + Delegation Certificate (accept scope) chaining to a directory-registered key of the recipient publisher named **in the capsule**; Relay releases ciphertext only | No recipient-bound release path. The relay code that exists is a **capsule-type allowlist** (`coordination-service/src/server.ts:826-835`; `handshake/p2pTransport.ts:39-65`) — a different control. Grep `relayRelease|relay_release` ⇒ 0 matches | **ABSENT** | — |
| **6** Capsule admission (before any UI) | Capsule signature vs. directory-registered key or valid delegation; initiator account-holder + DNS **re-checked at admission**; delegated principal's SSO email inside the initiator's DNS-verified domain; both Party Bindings well-formed and receiver-side names the receiver's own verified email; `request_instance_id` new-or-maps; freshness; **nonce_I decrypts and hashes to H(nonce_I)**; scope admissible under policy; **no field references a link or unregistered carrier (P15)** | Real admission gate exists: `admitInboundDelivery` — unknown relationship / revoked / expired (`handshake/ingressAdmission.ts:166-188`), wired at `email/beapEmailIngestion.ts:1010-1024` and `email/messageRouter.ts:667-675`, with a pipeline failure step `ingress_admission` (`handshake/enforcement.ts:249`). Missing: nonce decrypt + H(nonce) equality, delegation email-domain check, admission-time DNS re-check, P15 field scan | **PARTIAL** | BLIND |

### 3.4 Lifecycle, one-time use, sessions (§XVI.8, §XVI.13)

| # | v1.93 requirement | Evidence | Verdict | Typecheck |
|---|---|---|---|---|
| L-1 | Entry status ACTIVE / INACTIVE / REVOKED / SUPERSEDED / COMPROMISED (§XVI.8.1) | `WrcPublisherStatus = 'active'\|'inactive'\|'revoked'\|'superseded'\|'compromised'` (`wrc/wrcContract.ts:372-378`), decode-enforced via `PUBLISHER_STATUSES` (`:388-401`), runtime-enforced in `entryStatusSurface.ts:154-191`, expiry transition at `:217-226`. **The D4 model matches v1.93 wording exactly** (case aside; A.4.1 renders the enum upper-case) | **CONFORM** | BLIND |
| L-2 | The same state set applies to Publisher Identifiers at directory level (§XVI.8.1) | This *is* the publisher-part enum (`wrcContract.ts:372`) | **CONFORM** | BLIND |
| L-3 | Entry-level status admits a request when **ACTIVE** (§XVI.7.6 Gate 3) | Entry-level vocabulary is `published\|suspended\|retired` (`wrcContract.ts:110`) — a second, non-annex enum coexisting with L-1 | **UNCLEAR → Q4** | BLIND |
| L-4 | Invitation lifecycle adds PENDING, CLAIMED, DECLINED, WITHDRAWN, EXPIRED before ESTABLISHED (§XVI.8.3) | No invitation state machine on an entry identifier. Offer-level `consumed_action IN ('consented','declined','expired')` (`connectOfferStaging.ts:59`) is offer bookkeeping, not entry lifecycle | **ABSENT** | BLIND |
| L-5 | One-time use: `use_limit`, `use_scope`, `consume_at`, `claim_timeout`, `require_live_resolution` (§XVI.8.4) | **Confirmed absent by my own grep** — all five terms, plus `EXHAUSTED`, return **0 matches** repo-wide | **ABSENT** | — |
| L-6 | CLAIMED / CONSUMED / EXHAUSTED / CLAIMED_BY_OTHER / CONTEXT_EXHAUSTED (§XVI.8.1, §XVI.8.4) | 0 matches. Nearest is `markOfferConsumed` / `consumed_at` on **offers** (`connectOfferStaging.ts:369-377`) and `CONSENT_CONSUMED` for tool execution (`execution/executionConsent.ts:199`) — both different objects | **ABSENT** | BLIND |
| L-7 | Atomic compare-and-set claim on the resolver at Gate 5 (§XVI.8.4) | Absent. Note the **class of protection already exists** and is the right precedent: the monotonic `ON CONFLICT … WHERE excluded.epoch_floor > …` CAS in `wrc/epochFloorStore.ts:40-66` (schema `handshake/db.ts:1389-1391`) | **ABSENT** (precedent present) | BLIND |
| L-8 | Session-bound resolution; `require_live_resolution` forced for use-limited entries | `resolution_mode IN ('public','session_bound')` + `session_bound_expires_at` (`connectOfferStaging.ts:68-70`), enforced at consent (`:600-607`), surfaced in presentation (`offerPresentation.ts:45-46,109-110`), and **inside the preview hash** (`:460-461`) | **PARTIAL** | BLIND |
| L-9 | Umbrella + sub-handshake model (§XVI.13.2) | `umbrella_handshake_id` column (`connectOfferStaging.ts:67`) and in the preview hash (`:444`). No sub-handshake object, no consent inheritance, no docking | **PARTIAL** | BLIND |
| L-10 | Establishment Commitment: `EC = H(DOMAIN_TAG ‖ commitment_version ‖ ids ‖ request_instance_id ‖ nonce_I ‖ nonce_R ‖ H(capsule) ‖ H(acceptance))`, E2E-confidential nonces ≥128 bits, length-prefixed fields, tiers L/C/X (§XVI.13.6; DOMAIN_TAG in A.3 = 24-byte `OPTIRANDO-WRC-EC-v1` + five NULs, `commitment_version = 0x01`) | Grep `establishment_commitment|establishmentCommitment` ⇒ **0 matches**. Grep `OPTIRANDO-WRC-EC` ⇒ 0 matches | **ABSENT** | — |
| L-11 | Device list per umbrella; Device Record; Device Name; Device Class (§XVI.13.7, §XVI.2) | Grep `deviceList|device_pass|devicePass` ⇒ 0. `deviceName` exists only as orchestrator-pairing UI state, not a signed record | **ABSENT** | — |
| L-12 | Device Pass — the only route to cross-tenant device addressing (§XVI.13.7) | 0 matches | **ABSENT** | — |
| L-13 | Handshake and session are separate state objects; ending a session does not dissolve the handshake (§XVI.13.3) | Handshake State Index + session concepts exist in the handshake subsystem; not audited to line level for this invariant in this pass | **UNCLEAR → Q6** | BLIND |
| L-14 | Simultaneous UI indication of active umbrella **and** active sub-handshake (§XVI.13.4) | No sub-handshake exists to indicate | **ABSENT** | — |

### 3.5 Identity, trust, directory (§XVI.4, §XVI.6)

| # | v1.93 requirement | Evidence | Verdict | Typecheck |
|---|---|---|---|---|
| I-1 | SSO identity **is** the verified e-mail address; exactly one per principal; no separate login identity (§XVI.6.5 "Individual (B2C) parties") | Party binding already carries `sender_email` / `receiver_email` plus `sender_iss` / `sender_sub` / `sender_wrdesk_user_id` (`connectOfferStaging.ts:423-431`). Email is bound — but it coexists with separate iss/sub/user-id identity, which is the thing §XVI.6.5 says cannot differ | **PARTIAL** | BLIND |
| I-2 | Both parties' e-mail addresses anchored in **every** handshake, of every class (§XVI.6.5 "Email binding of both parties") | Both are in `boundDefinition` and therefore in `bound_definition_hash` (`connectOfferStaging.ts:423-431,464`) | **CONFORM** | BLIND |
| I-3 | Third verification condition: acting principal's SSO email lies within the publisher's DNS-verified domain (§XVI.6.5, §XVI.1.3, Gates 2 and 6) | Absent. `publisher_domain_verified` is derived from `offer.publisher_part != null` (`connectOfferStaging.ts:431`) — a presence test, not a domain-alignment proof | **ABSENT** | BLIND |
| I-4 | Principal keys + Delegation Certificates (scope initiate/accept/revoke, generation, expiry, principal's verified email) (§XVI.2, §XVI.6.5) | Delegation exists but as **catalog-signing only**: `authority: 'catalog-signing-only'`, sub-delegation unrepresentable (`wrc/wrcContract.ts:330-367`; `wrc/wrcVerify.ts:96-119`; Delta v1.1 §A). No principal keys, no per-scope certificates, no email field | **PARTIAL** (different object) | BLIND |
| I-5 | Directory trust anchor = the **directory operator's** pinned key; records dual-signed operator + publisher countersignature (§XVI.6.4) | Trust anchor is the **publisher's DNS-pinned root** (`wrc/dualChannel.ts:8-14`; Delta v1.1 §A.2 "from the DNS-pinned root key plus the embedded record ALONE"). This is a genuinely different trust topology | **SUPERSEDED** | BLIND |
| I-6 | Key rollover by a record signed by **both** outgoing and incoming operator keys (§XVI.6.4) | Rotation is by delegation epoch window, `valid_from_epoch` / `revoked_from_epoch` (`wrc/wrcVerify.ts:87-94,115-117`); historical list is audit-only and MUST NOT be consulted in verification (`wrc/wrcTransport.ts:37-40`; Delta v1.1 §B) | **PARTIAL** | BLIND |
| I-7 | Generation invalidates cache immediately regardless of expiry; changed record never served from cache (§XVI.6.4) | `generation` is decoded (`wrcContract.ts:380-401`); freshness-window staleness is a contract obligation (v1.0 §3.1, §5.2). Generation-mismatch **cache invalidation** as a distinct rule not evidenced at line level | **PARTIAL** | BLIND |
| I-8 | Anti-enumeration: no listing, rate limits, uniform 404 (§XVI.6.4) | Contract v1.0 §1.3 and §4.2 `404 unknown_identifier` — service-side obligation, matches | **CONFORM** (contract) | — |
| I-9 | Bidirectional origin/key binding: directory lists the origin **and** the origin publishes a hint naming the Publisher Identifier; either alone insufficient (§XVI.6.5) | Both directions implemented and required to agree: DNS `_wr` pin + `/.well-known/wr/manifest`, mismatch ⇒ `manifest_domain_mismatch` (`wrc/dualChannel.ts:44,110-139`) | **CONFORM** | BLIND |
| I-10 | Displayed Responsible Domain: `display_origin` in the directory record, strict registrable-domain normalization, OCR cross-check **after Gate 2**, unsuppressible mismatch warning, abort default, policy may only escalate (§XVI.2, §XVI.9.4) | Grep `display_origin|displayOrigin` ⇒ **0 matches**. Repo has `verified_domain` / `publisher_domain_verified` (`offerPresentation.ts:31-33`) — verification state, not accountability display text. Reusable primitive exists in the wrong subsystem: `registrableDomain()` (`packages/shared/src/vault/originPolicy.ts:203`) | **ABSENT** | BLIND |
| I-11 | Grant content: every grant item hash-anchored, versions chained in signed Merkle-anchored manifests, **local hash check before execution/rendering**, hard stop on failure, never fall back to an older version (§XVI.4.2a) | Merkle inclusion verified against the verified head (`wrc/wrcCrypto.ts:128-149`; `wrc/wrcVerify.ts:248-251`); `evp_ref` bound to the envelope hash (`wrc/resolutionClient.ts:265-267`); EVP budget re-verified before render (Contract v1.0 §3.3). But `wr_grants` / `GrantRow` is a delivery-scope model (`handshake/grants.ts:50+`) — grep `grantItem|grant_item` ⇒ 0 matches. No per-item hash gate before execution | **PARTIAL** | BLIND |
| I-12 | PoAE™ / PoAC™ attached per grant item (§XVI.4.2a) | Named in `docs/spec/…Delta_v1.1.md` and gap analyses; no admission code path by those names (nearest: `vault/capabilityBroker.ts`) | **ABSENT** | — |

### 3.6 E-mail slice (§XVI.7.4, §XVI.7.4a)

| # | v1.93 requirement | Evidence | Verdict | Typecheck |
|---|---|---|---|---|
| E-1 | E-mail is **only a carrier**, for any class; no dedicated pairing reference type (§XVI.1.2, §XVI.7.4) | Mapping entries `wr_code_email` / `wr_code_manual` / `wr_code_scan` / `wr_code_red` exist (`handshake/formationPipeline.ts:132-135`) — class-agnostic by construction because no class exists | **PARTIAL** | BLIND |
| E-2 | WR references recognized **during the BEAP de-packaging step** — the only point where message content and the capture pipeline meet (§XVI.7.4 intro, step 3) | Architecturally aligned and already enforced: the CPR gate short-circuits before any parse — `channelProvenance.channel_pass ? detectBeapPackageFromMessage(...) : NO_DETECTION` (`email/messageRouter.ts:510-518`), with `NO_DETECTION` frozen (`:388-392`) and the invariant pinned by `email/__tests__/provenanceGatesParsing.guard.test.ts:8-10` | **CONFORM** (seam) | BLIND |
| E-3 | Textual WR reference extraction from body / structured fields / signed script block | **ABSENT.** `detectBeapPackageFromMessage` detects BEAP capsules and message packages only (`email/messageRouter.ts:401-435`). No WR-code regex exists in `apps/**` or `packages/**` | **ABSENT** | BLIND |
| E-4 | Manual entry (keyboard/paste) on the same parser/check boundary (§XVI.5.9, §XVI.7.7) | **ABSENT** as a UI. Proven only through main-process tests calling `captureBaselineCode` (`wrc/__tests__/offerPresentation.e2e.test.ts:128`). The only live manual-entry UI is the 6-digit pairing code (`AcceptHandshakeModal.tsx:210,627,752,759`; `SendHandshakeDelivery.tsx:325,437,441`) | **ABSENT** | — |
| E-5 | Original graphics never used for automatic detection; local re-render shown instead (§XVI.7.4 3b, P12) | No graphic decode path at all; display derives from canonical (`offerPresentation.ts:123-125`) | **CONFORM** (vacuously) | BLIND |
| E-6 | Channel provenance may be credited, never authority; failure ⇒ no credit, manual capture still possible (§XVI.7.4 step 2, closing para) | CPR implemented with SPF/DKIM/DMARC parsing (`ingestion-core/src/channelProvenance.ts:98,163`) and a UI alert (`packages/shared-beap-ui/src/ChannelProvenanceAlert.tsx`). Note v1.93 adds that alignment is evaluated **against the origins in the directory record of the Publisher Identifier in the extracted reference** — impossible today because no reference is extracted | **PARTIAL** | pkg src / BLIND |
| E-7 | Offer construction carries the resolved reference | `wr_code_canonical`, `publisher_part`, `entry_local_part` staged (`connectOfferStaging.ts:64-66`) and hashed into consent (`:439-448`) | **SUPERSEDED** (shape) | BLIND |
| E-8 | No pairing-specific reference type; device onboarding is an I pairing handshake with a Pairing Slot (§XVI.5.10, §XVI.8.4) | Repo asserts the **opposite** as a guarded invariant (`wrCode.ts:14-17`; `pairingCodeRegistry.ts:18-34`, `DIGIT_RE = /^[0-9]{6}$/` at `:79`); ingress `optirando_code_entry` (`ingressRegistry.ts:26`); 6-digit wire field pinned in canonical rebuild (`handshake/canonicalRebuild.ts:237`) and enforcement (`handshake/enforcement.ts:181-182,984-986`) | **SUPERSEDED** | BLIND |
| E-9 | Consent inheritance per policy; policy may restrict, never extend (§XVI.13.2) | No inheritance path; every offer requires explicit consent (`handshake/formationPipeline.ts:301-303`) — fail-closed, so not a violation, but the model is absent | **ABSENT** | BLIND |

### 3.7 Patent / documentation apparatus

| # | Item | Verdict |
|---|---|---|
| D-1 | §XVI.5.12 design rationale and encompassed simplified variants (green-marked) | **DOC-ONLY** |
| D-2 | §XVI.19 Brief Description of the Drawings; §XVI.19.1 reference numerals 100–128 / 130 | **DOC-ONLY** |
| D-3 | License Notice, Trademark Notice, Third-Party Marks, Drafting convention (p. 1) | **DOC-ONLY** |
| D-4 | §XVI.17.2 representative computer-implemented method | **DOC-ONLY** (mirrors §XVI.5–7 normative text; no independent obligation found) |
| D-5 | §XVI.18 Version History | **DOC-ONLY** — but load-bearing for identity (see §1.1) |

---

## 4. Contradiction Register

Places where the code conforms to v1.2/v1.4 and thereby violates v1.93. The
"legitimizing artifact" column is traceability, not blame — each was correct when
written.

| ID | Contradiction | Code | v1.93 rule | Legitimizing artifact |
|---|---|---|---|---|
| **CR-1** | Canonical form has no class prefix; the first symbol is publisher material | `wrCode.ts:80-89` (`publisher = canonical.slice(0,6)`), `:96-99` | §XVI.5.1, §XVI.5.2 P5 — every reference begins with a class prefix; no reference begins with a Publisher Identifier | Registry Material v1.4 §3 ("publisher part + local part"); Annex XVI v1.2 §XVI.5.1–5.2 as transcribed at `wrCode.ts:76-79` |
| **CR-2** | 12-symbol minimum admits a prefix-less code as valid. Measured: `verifyCheck('WR7X4K9B2M3P') === true` | `wrCode.ts:73-74`, `:96`, `:134` | §XVI.5.8 block table — P is 13 symbols; §XVI.5.2 — `W` as first symbol is INVALID | Registry Material v1.4 §3 "the canonical length is at least 12. The minimum-length guard is part of the profile (§5)" |
| **CR-3** | Per-class fixed length replaced by an open-ended floor; 13- and 14-symbol "extended local parts" are first-class identifiers | `wrCode.ts:98-99`; vectors at `wrCode.conformance.test.ts:72-73`, `:346-352` | §XVI.5.3 — I/C/S* bodies are **fixed** at twelve symbols; §XVI.5.4 — fixed length is what detects omission/insertion | Registry Material v1.4 §4.2 "Extended-local-part vectors"; decision **D3** cited at v1.4 §4.2 note |
| **CR-4** | Alias normalization applied at index 0, so a class symbol is rewritten. `I-…` → `1…`; `SI-…` → `S1…` | `wrCode.ts:49-60` | §XVI.5.3 — "Prefix parsing is performed before payload-alias normalization… A class symbol I is therefore never rewritten to the digit 1" | Registry Material v1.4 §1 normalization steps 1–4 (no prefix stage existed) |
| **CR-5** | Display grouping is three blocks with the check always attached | `wrCode.ts:141-151` | §XVI.5.1 — four blocks; check attached **only** for P, separate for I/C/SP/SI/SC/SE | Annex XVI v1.2 §XVI.5.5 as transcribed at `wrCode.ts:142` |
| **CR-6** | Parser hard-codes one 6+n+1 shape and cannot express a per-class typed field list | `wrCode.ts:80-89` | §XVI.5.11 — class declares its field list; number, role, length, and check placement are per-class declarations | v1.2 §XVI.5.1–5.2 (single form) |
| **CR-7** | Persisted offer schema encodes the old two-part shape: `publisher_part` + `entry_local_part`, no class, no second publisher block, no combination code | `connectOfferStaging.ts:64-66` (DDL); `:193-208` (`WrCodeOfferResolution`) | §XVI.5.1 — C names an ordered publisher pair; I/S* carry a 6-symbol combination code, not a local part | Contract v1.0 §3.2 `"codes":[{"canonical":"PPPPPPLLLLLC"}]`, `entry_id: "LLLLL"` |
| **CR-8** | Registry wire format pins the 12-char prefix-less canonical as the code shape and accepts any non-empty string at decode (no re-check) | `wrc/wrcContract.ts:112-114`, `:143-150` | §XVI.5.1 / A.2 — canonical forms are class-prefixed and class-length-fixed | Contract v1.0 §3.2 (`"canonical": "PPPPPPLLLLLC"`) |
| **CR-9** | Device pairing is asserted to be a **different identifier class** from WR Code, with its own normalizer, and consolidation is explicitly forbidden | `wrCode.ts:14-17`; `pairingCodeRegistry.ts:18-34,79`; `ingressRegistry.ts:26`; `canonicalRebuild.ts:237`; `enforcement.ts:181-182` | §XVI.5.10 — "Device onboarding is an I pairing handshake"; §XVI.8.4 Scenarios — "device pairing codes (I pairing handshakes with a Pairing Slot)" | Carve-out **3B.6** recorded at `pairingCodeRegistry.ts:18-34`; **Q5** interim ruling recorded at `captureMethods.ts:47-50` |
| **CR-10** | Trust anchor is the publisher's DNS-pinned root; head verification must complete from that root plus the embedded record with **no fetch** | `wrc/dualChannel.ts:8-14`; `wrc/wrcVerify.ts:96-119`; Delta v1.1 §A.2 | §XVI.6.4 — the **directory operator's** pinned key is the trust anchor of the reference layer; records are operator-signed and publisher-**counter**signed | WRC Registry API Contract v1.0 §1.1, §2 (root key anchored via DNS `_wr`); Delta v1.1 §A |
| **CR-11** | "Dual assurance" is publisher signature + WRC **ingest** countersignature | Contract v1.0 §1.5, §3.4; `wrc/wrcVerify.ts:212-260` | §XVI.6.4 — the required second signature is the **directory operator's**, so that "neither the operator alone nor the publisher alone can alter an active record" | Contract v1.0 §1.5 |
| **CR-12** | Entry status vocabulary `published \| suspended \| retired` coexists with the annex's ACTIVE/INACTIVE/REVOKED/SUPERSEDED/COMPROMISED | `wrc/wrcContract.ts:110`, `:162` | §XVI.8.1 — one state set, and it "applies to Publisher Identifiers at the Namespace Directory level" too; Gate 3 requires **ACTIVE** for an offering | Contract v1.0 §3.2; Annex XVII §XVII.3.2 as cited there |
| **CR-13** | Committed test vectors and fixtures are prefix-less 12/13/14-char codes; the transcription guard pins the old profile text as authoritative | `wrCode.conformance.test.ts:63-73`; `wrCode.profileTranscription.guard.test.ts`; `wrc/__tests__/wrcFixtures.ts:162-164,232`; `connectOfferWrCodeSchema.test.ts:38-40` | §XVI.5.5 + A.2 — the registry-derived vectors are class-prefixed | Registry Material v1.4 §4.1–4.4 |

**Note on what is *not* a contradiction.** The Damm core, alphabet, quasigroup,
`computeCheck`, `verifyCheck`, the U-rejection, case folding, separator stripping,
and the reject-before-resolve structure are all conform (F1, G-8…G-11, G-18, G-19).
The v1.4 transcription guard should be **re-pointed**, not deleted: its subject
(§5 of the registry material) is now Appendix A.1 of the annex, and the arithmetic
it pins is unchanged.

---

## 5. Contract Survival Table — WRC Registry API Contract v1.0 + Delta v1.1 vs. v1.93

`SURVIVES` = unchanged by v1.93 · `CONFLICTS` = v1.93 states otherwise ·
`EXTENDED` = survives but v1.93 adds obligations · `SILENT` = v1.93 does not speak
to it.

| Clause | Subject | v1.93 position | Verdict |
|---|---|---|---|
| v1.0 §1.1 | Registry answer is a CLAIM, never sole trust anchor; independent dual-channel validation | §XVI.3 P2, P8; §XVI.4.3 (directory and resolver logically independent of the Orchestrator) | **SURVIVES** |
| v1.0 §1.2 | Append-only assignment ledger; random non-sequential parts; no DELETE, no reassignment | §XVI.8.2 — "a Publisher Identifier is issued once and never reissued"; P11 | **SURVIVES** |
| v1.0 §1.3 | Anti-enumeration; no listing endpoints; per-part rate limiting; uniform 404 | §XVI.6.4 — "anti-enumeration controls (rate limiting, no wildcard listing)" | **SURVIVES** |
| v1.0 §1.4 | Carrier never trust anchor; content-addressed, signature-carried; TLS authenticates nothing | §XVI.3 P1, P9; §XVI.9.3 | **SURVIVES** |
| v1.0 §1.5 | Dual assurance = publisher signature + **WRC ingest** countersignature | §XVI.6.4 requires operator + **publisher countersignature** on directory records. Two different pairs; the annex's pair is the one that protects the record | **CONFLICTS** (CR-11) |
| v1.0 §1.6 | Atomicity per epoch; rejection never modification | §XVI.6.4 generation discipline; no annex text against it | **SURVIVES** |
| v1.0 §1.7 | Read side public, passive, unauthenticated, non-tracking | §XVI.6.4 — "lookups are namespace-keyed and do not require a user identity"; P10 | **SURVIVES** |
| v1.0 §2 | Ed25519 over canonical JSON; `sha256:<b64u>`; Merkle leaf/parent rule; root + delegated catalog key | §XVI.4.2a (Merkle-anchored manifests); A.1/A.3 fix only the *check* primitive, not object crypto | **SURVIVES** |
| v1.0 §3.1 | CatalogHead: monotonic epoch, freshness window, stale ⇒ no new admissions | No annex text against it; complements §XVI.6.4 generation | **SURVIVES** |
| v1.0 §3.1 (Delta §A) | `delegation` embedded in head; verification from DNS-pinned root + embedded record **alone**, no fetch ever | §XVI.6.4 makes the **operator** key the anchor and requires operator-signed records | **CONFLICTS** (CR-10) |
| v1.0 §3.2 | Entry object; `codes[].canonical = "PPPPPPLLLLLC"`; `entry_id = "LLLLL"` doubles as the local part | §XVI.5.1 — canonical is class-prefixed; for I/C/S* there is no "local part" at all | **CONFLICTS** (CR-7, CR-8) |
| v1.0 §3.2 | `status: published \| suspended \| retired`; `draft` never on the wire | §XVI.8.1 defines a different state set and applies it at both entry and namespace level | **CONFLICTS** (CR-12) |
| v1.0 §3.3 | EVP: `value_statement`, `self_description`, scope directory, ≤64 KiB, rejected not truncated | §XVI.4.2a — EVP-class material is grant/offer content; no conflict | **SURVIVES** |
| v1.0 §3.4 | DualAssuranceEnvelope; countersig over `hash‖epoch`; `suspension` ⇒ not resolvable for admission, still auditable | §XVI.8.1 INACTIVE / §XVI.6.4 status; suspension maps cleanly | **SURVIVES** |
| v1.0 §3.5 | PublicationPackage over an attested channel | §XVI.6.4 (record updates); no conflict | **SURVIVES** |
| v1.0 §3.6 | DelegationRecord, `authority: catalog-signing-only`, sub-delegation unrepresentable | §XVI.2 / §XVI.6.5 require **Delegation Certificates** for *principals* with scope initiate/accept/revoke and the principal's verified email. Catalog-signing delegation survives; it does not satisfy the annex's certificate | **EXTENDED** (I-4) |
| v1.0 §4.1 | `POST /publishers/register` — dual-channel challenge then insert-only assignment | §XVI.6.4 — "Initial registration … is an out-of-band, operator-vetted act (organizational identity verification per operator policy)". DNS+manifest alone is not operator vetting | **EXTENDED** |
| v1.0 §4.1 | `POST /publishers/{part}/delegation`; rotation by new record, none deleted | §XVI.6.4 rollover needs **both** outgoing and incoming operator keys | **EXTENDED** (I-6) |
| v1.0 §4.1 | `POST /publishers/{part}/publish` — verify, countersign all-or-nothing, atomic epoch switch | No conflict | **SURVIVES** |
| v1.0 §4.2 | `GET /resolve/{part}` → `status active\|inactive\|revoked\|superseded\|compromised`, `generation`, `catalog_head`, `root_fingerprint` | §XVI.8.1 state set **matches** (D4 was adopted correctly). §XVI.6.4 additionally requires resolver **and Relay** endpoints, `grammar_version`, WR Connect script version / connector hash, bound origins, and `display_origin` in the record | **EXTENDED** (I-10; A.4.1 field schema) |
| v1.0 §4.2 | `GET /publishers/{part}/entries/{entry_id}` | Entry addressing keyed on a bare local part cannot express I/C/S* | **CONFLICTS** |
| v1.0 §4.2 | `GET /objects/{sha256}` — content addressing | §XVI.4.2a hash anchoring; strongly aligned | **SURVIVES** |
| v1.0 §4.3 | `GET /audit/{sha256}` — passive, no scripts, per-item verify link | §XVI.4.3 repository links: runtime-constructed from a **pinned endpoint** + validated identifier, never from a carrier. The endpoint survives; the *construction rule* becomes normative | **EXTENDED** (Q6) |
| v1.0 §5.1 | Claim + independent dual-channel + manifest cross-check, mismatch never silent | §XVI.6.5 bidirectional binding | **SURVIVES** |
| v1.0 §5.2 | `last_seen_epoch` per publisher, reject lower (anti-rollback), stale ⇒ no new admissions | §XVI.15 bounded pre-verification within generation/expiry/revocation limits | **SURVIVES** |
| v1.0 §5.3 (Delta §C) | Verify full envelope before use: signature, countersig, inclusion proof, EVP budget | §XVI.6.5 — publisher-signed artifacts verified against a directory-obtained key, never key material carried by the artifact | **SURVIVES** |
| v1.0 §5.4 | EVP-first-render: first render shows only signed EVP material, never carrier claims | §XVI.3 P12; §XVI.7.4 3b | **SURVIVES** — and is one of the strongest existing alignments |
| v1.0 §5.5 | Suspension as its own visible state, never silent absence | §XVI.8.1 INACTIVE; §XVI.8.4 trusted-UI display rules | **SURVIVES** |
| v1.0 §6 | Out of scope for v0: Fraud Watchdog integration, Merkle multi-proof batching, pBEAP publish channel | §XVI.13.6 tier X **does** define Merkle batching with inclusion proofs — for Establishment Commitments, a different object | **SILENT** (no conflict) |
| Delta v1.1 §B | `GET /publishers/{part}/delegations` — audit only, MUST NOT be consulted in verification | Consistent with §XVI.8.2 (superseded key generations remain retrievable for historical verification) | **SURVIVES** |
| — | **Not in the contract at all** | §XVI.6.4 requires the record to carry: Relay endpoint(s), `grammar_version`, WR Connect script version + connector hash, `display_origin`, record expiry. A.4.1 gives the field schema | **GAP** |

---

## 6. Migration-Impact Notes

### 6.1 Persisted state that encodes the old grammar

| Store | Old-grammar encoding | Impact |
|---|---|---|
| `wr_connect_offers` (native DB) | `wr_code_canonical`, `publisher_part`, `entry_local_part` (`connectOfferStaging.ts:64-66`) | Columns are shape-bearing. `entry_local_part` has **no v1.93 counterpart** for I/C/SP/SI/SC/SE. Needs a class column and a third-block column whose meaning is class-dependent |
| `wr_consent_records` | `preview_hash`, `bound_definition_hash`, `contract_state_hash` (`connectOfferStaging.ts:81-84,504-508`) | **Highest-risk item.** `preview.entry` contains `wr_code_canonical`, `publisher_part`, `entry_local_part` (`:439-448`). Any field added or renamed changes `preview_hash` for **every historical row**, breaking `preview_hash_mismatch` (`:554-555`) and the consent equality check (`formationPipeline.ts:301-303`) |
| `wrc_publisher_epoch_floor` | `publisher_part TEXT PRIMARY KEY` (`handshake/db.ts:1389-1391`) | 6-symbol publisher identifiers are **unchanged** by v1.93 (§XVI.5.3: "Six-symbol Publisher Identifiers"; A.4.1 `publisher_id: 6 symbols`). The floor survives migration untouched — a rare clean case |
| Resolved-record cache | Keyed per publisher (`wrc/resolvedRecordStore.ts:151-157`) | Publisher-keyed, so survives. Entry-level cached material carries the old canonical |
| Ingress registry ids | `wr_code_public`, `wr_code_red`, `optirando_code_entry` (`ingressRegistry.ts:24-26`) | Recorded values are log-only and must not be branched on (`formationPipeline.ts:116-118`), which limits blast radius. But the two WR ids are *visual-scan* labels ("Public WR code scan"), not the carrier-agnostic model §XVI.1.2 requires |

**The Q7-analogue invariant applies here.** In the PSL analysis the ruling was that
new fields must be *structurally absent* from the offer/consent path, enforced by a
source-walking guard. The same reasoning applies in reverse for this migration: the
consent pin is a hash over a field set, so **any** change to the `entry` object in
`buildConnectOfferPreview` is a breaking change to stored consent. Recommendation:
treat `preview_hash` as versioned (a `preview_version` inside the hashed object)
rather than migrating rows, so old pins remain verifiable under the old field set.
This needs ratification — **Q7**.

### 6.2 Committed fixtures and test vectors carrying old-format codes

Every literal below is a prefix-less code and is invalid under §XVI.5.2:

| Location | Literals |
|---|---|
| `packages/ingestion-core/__tests__/wrCode.conformance.test.ts:63-73` | `WR7X4K9B2M3P`, `ABC123DEF454`, `000000000000`, `0123456789AM`, `ZZZZZZZZZZZK`, `WR7X4K9B2M3ZJ`, `WR7X4K9B2M3Z7F` |
| same, `:223-224,266-267,271-272` | negatives `WR7X4K9B2M3Q`, `WR7X4K9B2MP3`, `0113456789AM`, `WR7X4U-9B2M3P` |
| same, `:238-257` | normalization equivalents (`Oi23-4567-89am`, `0I23…`, `wr7x4k-9b2m3-p`, `WR 7X4K 9B2M 3P`, …) |
| same, `:360-362` | display groupings `WR7X4K-9B2M3-P`, `WR7X4K-9B2M3Z-J` |
| `wrc/__tests__/offerPresentation.e2e.test.ts:43,86,89,139,148,158` | `WR7X4K9B2M3P`, `WR7X4K`, `9B2M3`, `WR7X4K9B2M3Q`, `WR7X4K-9B2M3-P`, `NEWPUB` |
| `wrc/__tests__/wrcFixtures.ts:162-164,232` | `WR7X4K`, `9B2M3`, canonical `` `${publisherPart}${entryId}C` `` |
| `handshake/__tests__/connectOfferWrCodeSchema.test.ts:38-40` | `WR7X4K9B2M3PC`, `WR7X4K`, `9B2M3` |
| `wrc/__tests__/resolution.dualChannel.test.ts:300-306,357`; `epochFloorHardening.test.ts` (many); `entryStatusSurface.test.ts:41,45-46` | publisher parts only — `WR7X4K`, `NEWPUB`. **These survive**: 6-symbol publisher identifiers are unchanged |
| `docs/spec/WR-Code_Check-Profile_Registry-Material_v1.4.md:163-205` | the full §4.1–4.4 vector table |
| `docs/spec/WRC-Registry-API-Contract_v1.0.md:43` | `"canonical": "PPPPPPLLLLLC"` |
| `docs/orders/WR-Code-Email-E2E_Refactor-Order_v1.0.md:130` | `WR7X4K9B2M3P` / `WR7X4K9B2M3ZJ` |

Appendix A.2 supplies drop-in replacements for all seven classes, and I have
verified they compute correctly under the existing implementation (F1) — so the
fixture migration is mechanical and independently checkable.

### 6.3 UI copy

No WR-Code user-visible copy exists to migrate (E-4). The strings that mention
codes are pairing copy ("Type the 6-digit pairing code…",
`AcceptHandshakeModal.tsx:210`) and one generic consent error ("This offer's
session-bound resolution has expired. Capture the code again.",
`connectOfferStaging.ts:606`). Under CR-9 the pairing copy is in scope for the
grammar question; under the UI-readability rule any new selector/dialog surface
introduced later must set background and explicit foreground together.

### 6.4 Docs

`WR-Code_Check-Profile_Registry-Material_v1.4.md` is superseded **in part only**:
§1 alphabet, §2 quasigroup, §2.3 diagonal note, §3 fold/derivation, and §4.4
error classes all survive (F1); §1 normalization ordering (CR-4), §3 length guard
(CR-2), §4.1–4.3 vectors, and §4.2 extended-length forms (CR-3) do not. The
`profileTranscription` guard currently makes the superseded document authoritative
over `wrCode.ts:19-24` — that pointer must move before any grammar work, or the
guard will block the migration it is supposed to protect.

---

## 7. Q-Register

Questions are verbatim to the Author. Each carries a recommendation and the
consequence of adopting it.

**Q1 — Input ratification.** *"The annex did not arrive as `Annex_XVI_WR_Code_v1.93.md`
in the working tree with a sha256 in a drop commit message; it arrived as a PDF
outside the repository. Do you ratify the file with sha256
`BC108E028CA35AFC1543787576BF4017378AE5F98C0717F3D8E4DBF7961E8D19` as the
authoritative v1.93 input for this analysis and for the Orders that follow, or do
you want the author-drop performed first and the analysis re-verified against the
committed artifact?"*
**Recommendation:** ratify this sha256 now **and** commit the annex to the repo
before Phase 1 opens. **Consequence:** the state matrix stands as delivered; if
instead the committed artifact ever differs from this hash, every verdict must be
re-verified, because §2.1 forbids analysis against a non-identified input.

**Q2 — Header/title version conflict.** *"The title block and §XVI.18 say v1.93 /
24 August 2026; the running header on all 74 pages says Version 1.3 / 19 August
2026. Which string is the document's identity, and is the header a defect to be
corrected in the next revision?"*
**Recommendation:** treat the title block and §XVI.18 as identity, the header as a
stale artifact, and re-stamp it. **Consequence:** if the header is authoritative
instead, this entire report is void — it would mean the supplied body is not
v1.93, and §2.1's prohibition on analysing older versions applies.

**Q3 — Does the prefix enter the check stem as a parsed class value or as a folded
string symbol?** *"§XVI.5.4 defines the input as `[class values] ‖ [body values]`,
while A.3 says the computation 'equals running the algorithm over the complete
alias-normalized string'. Reading A: the implementation must parse the prefix,
look up the Class Value Table, and fold values. Reading B: the implementation may
fold the whole normalized string and get the same answer for grammar version 2.
Which reading binds the implementation?"*
**Recommendation:** Reading A for the parser, Reading B as a verified optimization —
i.e. keep `verifyCheck` as-is but derive the class from a real prefix parse rather
than from string position. **Consequence:** under Reading A the class table must be
an explicit registry keyed by grammar version, which is what makes a future class
outside the reference alphabet representable (§XVI.5.4 last sentence). Under
Reading B alone, a grammar version that adds a non-alphabet class symbol silently
breaks the check.

**Q4 — Two entry-status vocabularies.** *"§XVI.8.1 defines one state set (ACTIVE,
INACTIVE, REVOKED, SUPERSEDED, COMPROMISED, plus CLAIMED/CONSUMED/EXHAUSTED) and
says it applies to Publisher Identifiers at the directory level too. The
implemented contract has that set at publisher level and a second set at entry
level (`published | suspended | retired`, Contract v1.0 §3.2, citing Annex XVII
§XVII.3.2). Does v1.93 supersede the entry-level vocabulary, or do the two levels
legitimately carry different enums?"*
**Recommendation:** ask Annex XVII to be reconciled rather than mapping in code;
until then treat the entry enum as SILENT-not-conflicting and add an explicit
mapping table with a guard test. **Consequence:** if the annex supersedes it, Gate
3's "ACTIVE for an offering" changes `wrcContract.ts:110,162`,
`resolutionClient.ts:238-243`, and `connectOfferStaging.ts:611-616`, and every
staged `entry_status` value in the DB becomes a legacy vocabulary.

**Q5 — The 6-digit pairing code under an I-class grammar.** *"§XVI.5.10 states that
device onboarding is an I pairing handshake and §XVI.8.4 lists device pairing
codes as I pairing handshakes with a Pairing Slot. The repo holds the opposite as
a guarded invariant (carve-out 3B.6). Is the 6-digit decimal pairing code
withdrawn in favour of an `I-IIIIII-BBBBBB-X` reference, or does it survive as a
non-reference out-of-band confirmation factor alongside the I code?"*
**Recommendation:** the I code becomes the reference; the 6-digit code survives, if
at all, only as a second-channel confirmation on the *device*, never as an
identifier. **Consequence:** withdrawing it touches `pairingCodeRegistry.ts`,
`canonicalRebuild.ts:237`, `enforcement.ts:181-182,984-986`, the wire field
`receiver_pairing_code`, both pairing UIs, and the `optirando_code_entry` ingress
id — and it deletes an existing anti-consolidation guard, so the guard must be
replaced by its inverse rather than simply removed.

**Q6 — Two items I did not establish to the standard this report requires.**
*"(a) P15/§XVI.4.3: is `audit_url` (`connectOfferStaging.ts:75`) constructed by the
runtime from a pinned WRC endpoint plus the validated identifier, or is it taken
from resolved registry material? (b) §XVI.13.3: does ending a session
demonstrably leave the parent handshake established in the current handshake
subsystem? Both need a dedicated source walk I did not complete in this pass."*
**Recommendation:** schedule both as bounded diagnoses before the phase that
touches them, and do not let either be assumed conform. **Consequence:** if (a) is
carrier- or registry-derived, it is a live P15 violation and outranks the grammar
work in priority; if (b) is not separable, §XVI.13.3 is a structural change to
handshake state rather than an additive one.

**Q7 — Consent-pin migration strategy.** *"`preview_hash` covers an `entry` object
containing `wr_code_canonical`, `publisher_part`, and `entry_local_part`. Adding a
class field or replacing `entry_local_part` invalidates every stored consent pin.
Do you want (i) a `preview_version` inside the hashed object so old pins stay
verifiable under the old field set, (ii) a one-time re-pin migration, or (iii) old
offers declared terminal at cutover?"*
**Recommendation:** (i). **Consequence:** (i) costs one field and a branch in
`buildConnectOfferPreview` and keeps historical consent independently verifiable —
which is the property `bound_definition_hash` exists to provide. (ii) rewrites
consent evidence, which no other rule in this repo permits. (iii) is honest but
discards pending offers at cutover.

**Q8 — Scope of the reference-layer rebuild.** *"F3 establishes that WR-code
detection and manual entry do not exist at all, so the prefix grammar is not a
migration of a live surface but the first implementation of one. Should the phase
plan therefore treat §XVI.5 as greenfield construction behind the existing pure
module, rather than as a refactor of the email slice?"*
**Recommendation:** yes. **Consequence:** the plan below assumes it. If the Author
intends a live email/manual-entry surface in the same phase, Phase 1 and Phase 4
must merge and the fail-closed default (no detection until the grammar is proven)
would be lost.

---

## 8. Proposed Phase Cut — proposal only, no authority

Ordering rationale: put everything that is *pure and verifiable offline* first,
because Appendix A.2 gives an externally checkable oracle for it; leave anything
touching stored consent until Q7 is ratified; keep fail-closed defaults so that no
intermediate state can surface an unverified reference.

**Phase 0 — Input and doc custody (blocked on Q1, Q2).** Commit the annex as an
author-drop with its sha256 in the message. Re-point the `profileTranscription`
guard from Registry Material v1.4 §5 to Annex XVI Appendix A.1, asserting the
arithmetic that F1 proves is unchanged. No behaviour change. *Rationale:* the guard
currently makes a superseded document authoritative over the core module, so it
will block every later phase until it is re-pointed.

**Phase 1 — Prefix grammar as a pure, additive module (blocked on Q3).** A Prefix
Grammar Registry (TERMINAL / NON_TERMINAL / INVALID, grammar version 2, §XVI.5.2),
a Class Value Table keyed by grammar version (A.3), per-class block-length framing
(§XVI.5.8), and prefix-parse-before-alias ordering (§XVI.5.3, CR-4). Ship the
Appendix A.2 vectors — all seven positives and all five negatives — as the
conformance suite. *Rationale:* the check arithmetic is already conform, so this
phase is provably correct against a published oracle before it touches anything.
Keep the existing `captureBaselineCode` untouched and unexported-from-changed so
nothing regresses. Mutation-helper assertion rule applies to the new registry's
state transitions.

**Phase 2 — Class-aware capture and rendering; retire the prefix-less form.**
Replace `parseStructure`'s fixed slice with class-driven framing (CR-1, CR-6),
per-class length equality instead of `>= 12` (CR-2, CR-3), four-block rendering
with class-dependent check placement (CR-5), and a `class` field on the
capture result. Fail closed: an unparseable prefix is INVALID, never "assume P".
*Rationale:* this is the last phase that is still pure. After it, the old 12-char
form must stop verifying — which is the single most visible break and should
happen once, deliberately, with the fixtures migrated in the same commit (CR-13).
Dual-mode verification applies: the module is browser-importable, so no node-only
guards may enter `packages/ingestion-core`.

**Phase 3 — Storage shape (blocked on Q7).** Class column plus a class-dependent
third-block column; `preview_version` in the hashed preview object. *Rationale:*
sequenced after Phase 2 so the migration is written against a settled grammar, and
gated on Q7 because it is the only phase that can invalidate stored consent.

**Phase 4 — Gates 1, 3, 4 (the receiver-side gates that need no new transport).**
Submission state (§XVI.5.8 SUBMITTED, §XVI.7.7 state list) so that no network
access precedes it; combination-code expansion at Gate 3; reference-addressed
self-match at Gate 4 with `NOT_FOR_YOU` / `NOT_FOR_THIS_DEVICE`. *Rationale:* Gate
4 today checks the wrong object (capsule sender, not reference block), and it
cannot check the right one until classes exist. Fail-closed default: no
auto-surfacing of any candidate.

**Phase 5 — Identity and directory alignment (blocked on Q4, and on a ruling for
CR-10/CR-11).** The third verification condition (I-3), directory-record fields
§XVI.6.4 / A.4.1 including `display_origin`, and the trust-anchor question.
*Rationale:* CR-10 and CR-11 are a **trust-topology** change, not a field
addition — the annex makes the directory operator the anchor where the repo makes
the publisher's DNS-pinned root the anchor. This is the highest-risk item in the
whole report and should not be bundled with anything.

**Phase 6 — Displayed Responsible Domain (§XVI.9.4).** `display_origin`,
registrable-domain normalization (reuse `registrableDomain()` rather than
re-derive), post-Gate-2 cross-check, unsuppressible mismatch warning with abort as
default. *Rationale:* depends on Phase 5's record fields. The warning surface must
satisfy the UI-readability rule — explicit foreground with any background, primary
text not muted — because it is a security warning.

**Phase 7 — One-time use (§XVI.8.4).** `use_limit` / `use_scope` / `consume_at` /
`claim_timeout` / `require_live_resolution`; CLAIMED / CONSUMED / EXHAUSTED;
atomic compare-and-set at claim. *Rationale:* copy the v77 epoch-floor CAS pattern
(`epochFloorStore.ts:40-66`) rather than re-deriving monotonicity, exactly as the
PSL analysis recommended for the PSL floor. Independent of the grammar, hence late.

**Phase 8 — Sub-handshakes, sessions, Establishment Commitment, Device Pass
(§XVI.13).** The largest greenfield block, and the one with the most external
dependencies (Relay, principal keys, device records). Deliberately last:
Establishment Commitment needs Party Bindings that Phase 5 settles, and
sub-handshake references need the Phase 1–2 grammar.

**Not in any phase:** §XVI.5.12, §XVI.19, §XVI.19.1, the notices, and §XVI.17.2 —
recorded as DOC-ONLY (§3.7).

---

## 9. What this report does not establish

Stated plainly so nothing here is over-read:

- Q6(a) and Q6(b) are open source-walks; both are marked `UNCLEAR` in the matrix
  rather than guessed.
- I did not audit the 155 failing test identities for WR-Code relevance. The
  capture exists as a before-set for identity comparison, per the Capture
  Persistence rule; attributing any of it is a separate task.
- The Graphify graph was not used as evidence for any verdict; every citation in
  this document is from a direct source read.
- Subagent inventories were used to locate surfaces. Every load-bearing claim was
  re-verified by my own read or grep, and the absence findings (L-5, L-6, L-10,
  L-11, L-12, I-10, G-3, P-6, P-7, P-8) were re-run as my own searches.
