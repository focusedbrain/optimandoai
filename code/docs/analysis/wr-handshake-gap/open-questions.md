# WR Handshake Refactor — Open Questions (for the specification author)

Every item: requirement ID(s), the ambiguity, and why it blocks or shapes a refactor step. Items marked **[annex-number-provisional]** derive from Annex XII per §2 flag 2.

---

## Q1 — Does a locally persisted *pending* record count as "establishing" a handshake?

**Req:** [IX.3.1] (rules 1–4), [VII.4.6].
**Ambiguity:** Inbound email/relay/WS initiate capsules today auto-create a `PENDING_REVIEW` row (`enforcement.ts:745-829`) with no capture event; activation still requires the Accept tap. IX.3.1 forbids message content from *establishing* a handshake — but does staging an inert, non-capability-bearing pending record constitute establishment, or only ACTIVE state?
**Blocks:** Phase-4 design of invitation inertness (gap-matrix C3; risk register "invitation inertness breaks onboarding"). If pending rows are permitted, the fix is confining them to a Connect-offer staging store; if not, inbound invitations must remain entirely unmaterialized until capture.

## Q2 — Mapping of existing relationships to the initial profile registry

**Req:** [VII.4.2 table], [VII.3.2], [VII.4.7].
**Ambiguity:** Existing rows are `standard` (cross-party, 1 signature + accept countersign-over-hash) and `internal` (same-principal device pair). Neither satisfies any initial registry record's signature cardinality: `org_internal`/`org_cross` require 2 signatures over the byte-identical core; `private_personal` requires 1 signature + mutual consent records; `pbeap_publisher` has no analog. VII.4.7 prohibits conversion paths.
**Blocks:** Phase-3 backfill (migration-and-risk.md §1.1). Options needing an author ruling: (a) a registered **legacy profile** whose registry record blesses the historical signature discipline indefinitely; (b) legacy records remain valid but frozen (no refresh/new grants) until re-established; (c) forced re-establishment. Also: is same-principal device pairing `org_internal`, a new profile, or the Cross-Device admission situation of another profile (see Q9)?

## Q3 — Countersignature semantics: hash-signing vs byte-identical-core signing

**Req:** [VII.3.2], [VII.6.1.3].
**Ambiguity:** VII.3.2 says the counterparty "verifies and countersigns the identical core". Current accept countersigns the initiator's `capsule_hash` (32 bytes), not a serialization of the core. Is signing the canonical-form *hash* of the identical core conformant (both signatures then cover the same bytes-by-reference), or must both signatures be computed over the canonical serialization itself? Related: is a domain-separation-tag requirement implied for Annex VII cores (XII.5 mandates it only for `wr.cc.*` objects)?
**Blocks:** Phase-2 signature-envelope design (gap-matrix A8/A9); wrong choice forces a second wire break later.

## Q4 — `ingress_path` registry values for existing transports

**Req:** [VII.3.1] (registry `optirando.ingress.*`), [VII.4.6].
**Ambiguity:** Initial entries are `wr_code_public`, `wr_code_red`, `beap_invitation`, `relay_code_claim`, `optirando_code_entry` (reserved: `wr_ad`). How do the existing transports map — email-borne initiate = `beap_invitation`? coordination-WS and relay-pull = `relay_code_claim` or also `beap_invitation`? `.beap` file import = which? Do new registry identifiers get minted for file/USB import, and by whom?
**Blocks:** Phase-4 provenance backfill and PoAC recording (gap-matrix A4, C5); mislabeling would bake wrong provenance into evidence permanently.

## Q5 — Is 6-digit pairing-code entry a conforming "manual entry" capture method?

**Req:** [IX.3.1] (manual entry of a WR code), [IX.8.6] (typed, bounded identifier grammar), [XI.LB§3] (WR Code as cross-device path).
**Ambiguity:** The existing 6-digit decimal pairing code is not the WR Code identifier grammar. Is it (a) an interim conforming manual-entry token for the Internal/Cross-Device admission situations, (b) to be replaced by real WR Codes, or (c) a distinct registered ingress (`optirando_code_entry`?)?
**Blocks:** Phase-4 capture-method enum and Phase-6 cross-device binding design (gap-matrix C2, I1).

## Q6 — Tension between [VII.4.6] "BEAP invitation is a route" and [IX.3.1] "exactly three capture methods"

**Req:** [VII.4.6], [IX.3.1], [X.3.1].
**Ambiguity:** VII.4.6 lists the initial BEAP invitation as a legitimate ingress route to the identical handshake request; IX.3.1 restricts *Public Handshake* formation to the three capture methods, with `assisted_email` defined as a **code token** recognized in depackaged text — not a capsule delivered by email. Is capsule-by-email formation (today's E4 path) legitimate for non-Public profiles (symmetric/org/internal) while Public requires capture, or is the capsule-by-email pattern to be retired everywhere in favor of code-token capture?
**Blocks:** the single-pipeline design (Phase 4) — specifically whether the email transport remains a formation ingress or becomes delivery-only.

## Q7 — Does no-expiry-until-revoke apply to *pending* handshakes?

**Req:** [VII.10.7.1], [IX.3.3].
**Ambiguity:** The grant ground state is unlimited-until-revoke. Current code applies a 7-day pending timeout (`PENDING_TIMEOUT_MS`) and an `EXPIRED` state to unaccepted handshakes. Are pending (never-consented) requests outside the no-expiry rule — i.e., may they time out — and is the `EXPIRED` state legitimate for them?
**Blocks:** Phase-3 state-machine definition of the new core.

## Q8 — Revocation history semantics vs local data deletion

**Req:** [VII.10.7.2], [VII.10.7.3].
**Ambiguity:** Spec: revocation severs rights, history persists (sessions, PoAC/PoAE, contents). Current code deletes context blocks + embeddings on local revoke and audit rows on permanent delete; users may *want* local data removal (storage/privacy). Is "history persists" satisfied by retaining evidence records + digests while content is separately deletable by an explicit operator action, or must contents persist too?
**Blocks:** Phase-4/5 revocation redesign (gap-matrix E9, H5) and the migration story for already-revoked rows.

## Q9 — Governance placement of same-user cross-device pairing

**Req:** [X.3.1], [XII.4] **[annex-number-provisional]**, [XI.LB§3].
**Ambiguity:** "Cross-Device" is an admission-situation designation of the one mechanism; Annex X's Internal Handshake covers device↔device among WR components. Is same-principal device pairing simply an Internal Handshake whose UI label is "Cross-Device", or a distinct admission situation with its own profile-registry parameters (e.g. challenge-exchange formation per XI.LB§3)? The answer determines the profile table content and the capture rules that apply to pairing codes.
**Blocks:** Phase-3 registry seeding; Phase-6 binding design.

## Q10 — Role of `handshake-ledger.db` in the target two-store model

**Req:** [IX.4] (two-object model), evidence discipline (§3 invariant 12).
**Ambiguity:** The ledger is documented as hashes/metadata-only but currently receives the full handshake schema (gap-matrix G5), including private-key columns. Target architecture: is the ledger (a) the append-only evidence/receipt store (Tier L chain), (b) a redundant mirror to be retired, or (c) the contract store while the vault holds runtime state?
**Blocks:** migration-and-risk.md §1.1 ledger decision; every Phase-2+ migration touches it via the shared migration array.

## Q11 — External Service Admission cutover behavior for existing accounts

**Req:** [X.3.3], [X.3.1] (non-admitted unreachable), Annex II non-pre-satisfaction (by reference).
**Ambiguity:** On upgrade, existing email/cloud configurations have no admission artifacts. May a transition build grandfather-allow existing accounts until the user acts on proposed admissions, or does fail-closed take precedence immediately (breaking mail sync on upgrade day)? What is the maximum transition window, if any?
**Blocks:** Phase-6 rollout sequencing (risk register "ESA cutover locks users out").

## Q12 — Mixed-realm identity rows under full-claim guards

**Req:** [VII.3.8], [VII.3.10].
**Ambiguity:** Tightening to full-claim comparison may invalidate existing relationships whose two sides were recorded under different issuers (e.g. realm migrations, dev/staging). Is issuer migration an attested event with a mapping (analogous to key rotation [VII.3.11]), or are such rows invalid and to be re-established?
**Blocks:** Phase-1 guard rollout (risk register "identity-guard tightening").

## Q13 — Capability-token carrier for `context_scope` / `delegation_chain`

**Req:** [XII.12.6], [XII.9] **[annex-number-provisional]**.
**Ambiguity:** No structured bilateral capability token exists today (opaque UUID bearers only). The XII impl note says the fields land in the *bilateral capability token schema* now. Confirmation needed that (a) the token schema is net-new in Phase 5 (no interim retrofit onto the UUID bearer or the capsule format is expected), and (b) depth default 1 / monotone-narrowing validation is out of scope until CC ships — only field carriage + preserve-unknown parsing is required now.
**Blocks:** Phase-5 token schema sign-off (gap-matrix T4).

## Q14 — Scope of "no auto-accept" vs internal automation consents

**Req:** [VII.10.5.5], [X.3.1] (formation authority in deployment policy).
**Ambiguity:** For Internal Handshakes, X.3.1 allows admission as a *policy* event of the administrative authority ("propose, never silently apply"). Does an org-policy-driven, C0-class admission of a fleet of sandboxes conflict with the no-auto-accept rule (which targets prepared-action execution), i.e., is unattended internal admission under signed policy permitted?
**Blocks:** Phase-6 internal-admission UX (gap-matrix D3) — whether every internal capability set needs a human tap per device or a signed policy can cover a class.

## Q15 — Spec flags acknowledged (no action, recorded per §2)

1. **[XI.4.1] device-variance wording** treated as superseded-pending; finding I3 (edge-agent dialect) is judged solely under [XI.3-I9] governance-identity, deriving nothing from the retracted per-device-functions wording.
2. **Annex XII provisional number** — all XII-derived findings (D1 one-mechanism phrasing, T4, Q13) are marked **[annex-number-provisional]**.
3. **IX.2 vs IX.3.1 capture methods** — IX.3.1 (three methods) applied as operative throughout; no finding relies on the IX.2 two-method wording.
4. **Login-Bound numbering** — all citations use the `[XI.LB§n]` prefix.
5. **"L" collision** — the codebase implements neither artifact verification level L (Annex VII, ledger-anchored) nor Verification Tier L (Annex IX, local hash chain); where the plan builds the local hash chain (Phase 5) it is explicitly the Annex IX Tier L. No conflation present in any finding.
