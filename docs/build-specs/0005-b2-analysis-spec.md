# wrdesk — B2 Analysis: Email Depackaging Pipeline (raw mail → `depackage` → BEAP capsule)

**Type:** Analysis only. No code changes except committing this spec verbatim as `docs/build-specs/0005-b2-analysis-spec.md` and your report as `0006-b2-analysis-report.md`. No builds, no flag changes, no rig execution required (static analysis; the rig items below are *specified*, not performed).

**Pre-flight:** `git pull`; branch `feature/layered-sandbox`; HEAD contains the B1 closeout commits (`c6784f66`, `b408278f`, `c557d277`). If not, STOP and report.

---

## 1. What B2 will eventually build (context — read before tracing)

B2 is the pipeline-1 cutover: provider email's raw bytes are parsed inside the isolation boundary (`dispatch({kind:'depackage'})` → microVM on paid/Linux, in-process-inside-the-boundary as the free floor), never in the orchestrator process. This is the true invariant-0 closure. The depackage result becomes a BEAP capsule — wrdesk's native format — and plain mail's stored/displayed form becomes SafeTextV1 + sealed original artifacts. Fetch relocation (sandbox/appliance fetches mail) is explicitly NOT part of B2; the current fetch location stays, but fetch must become a byte courier that hands raw bytes to the seam without parsing.

This analysis exists because five things must be established from code before the build can be specified. Cite file:line for every finding; report contradictions with this spec rather than absorbing them.

---

## 2. Investigation tasks

### A. Where the raw MIME parse lives today (the full plain-mail trace)
Trace the plain-email branch end to end per provider: `syncOrchestrator` → `emailGateway` / `imapFetchReliable` → `detectAndRouteMessage` → storage → UI. Establish precisely: which library/code performs MIME parsing (and where it runs), what is extracted (headers, text/html bodies, inline images, attachments), what `inbox_messages` (or other tables) stores for a plain email, and what the renderer displays (raw HTML? sanitized? text only?). List every code location that parses attacker-controlled mail structure in the orchestrator process — these are B2's cutover targets.

### B. What "raw bytes" means per provider (the byte-courier feasibility question)
The depackage job needs raw input. Per provider, establish what the fetch layer can obtain and what it currently obtains:
- **IMAP:** is the full RFC822 fetched, or are BODYSTRUCTURE/partial fetches used (which themselves rely on server-side structure parsing)? Does any MIME walking happen inside the fetch layer itself?
- **Gmail/Outlook APIs:** do we currently consume the provider's pre-parsed payload structure (e.g. Gmail `format=full` parts) — meaning the orchestrator walks attacker-influenced structure — or can/do we fetch `format=raw` (full RFC822)?
Recommend the standardized raw form per provider for handing to the depackage job, and identify what fetch-layer code must change to stop parsing (the byte-courier delta). Flag any provider where truly-raw retrieval is impossible or costly (quota, size limits).

### C. The carrier-email front step (this is subtle — get it exactly right)
BEAP packages arrive *inside* emails. Locating a qBEAP/pBEAP package within a message requires parsing the email's MIME structure — which means **classification itself is untrusted-structure parsing** and must move inside the depackage job. Trace how `detectAndRouteMessage` classifies today (what it inspects: subject markers? attachment names? body content? at `messageRouter.ts:291` onward) and how the BEAP package bytes are extracted from the carrier email before the (now seam-routed) pipeline-2 path takes over. Establish: after B2, `detectAndRouteMessage` must become a consumer of the depackage job's *typed result* (routing on it, not parsing) — document everything that has to move into the job for that to hold.

### D. What the Build 1 worker actually covers (gap the guest payload)
The depackage guest payload exists (`depackagingWorker.ts`, pure, bundled, rig-proven). Establish what it actually implements today versus what B2 needs: full MIME parsing? HTML-to-SafeText? inline images? attachment extraction + custody sealing (`blindCourier`)? carrier-BEAP extraction? nested messages (.eml attachments)? Produce the worker gap list. Also establish its hardening posture for hostile inputs (decompression/zip bombs in attachments, oversized parts, deeply nested MIME, malformed headers) and whether `limits.maxInputBytes`/wall-clock are enforced inside the guest or only outside.

### E. The depackage result contract (design from what you find in A–D)
Propose the typed result union the job returns, e.g.:
- `{ type: 'plain', safeText: SafeTextV1, artifacts: CourierRecord[] }`
- `{ type: 'beap-carrier', extractedPackages: OpaquePackageBytes[], carrierSafeText?: SafeTextV1, artifacts?: CourierRecord[] }`
- mixed/multiple-package cases, and the failure taxonomy (malformed MIME, limits exceeded, safe-text rejection).
Key design point: extracted BEAP packages are returned **opaque and unparsed** (qBEAP is ciphertext; pBEAP is structured JSON whose parsing is pipeline-2's `validate-native-beap` — already seam-routed by B1). Decide and justify whether extracted packages travel in the artifacts channel (custody-sealed) or a dedicated opaque channel, considering that they must be handed onward to pipeline 2 at the consumer, not stored sealed.

### F. The BEAP-capsule contract ("creates a BEAP capsule out of it")
Map what capsule structures exist (`capsuleBuilder.ts`, pBEAP/qBEAP wire formats, `message_package`) and design where and how a depackaged plain email becomes a BEAP capsule. Constraint (INV-2/INV-6): the depackage VM is key-less — any capsule form requiring handshake signing or qBEAP encryption **cannot** be produced inside the job. Evaluate at minimum: (i) key-less wrap inside the job (pBEAP-style or a new internal `dBEAP` type, integrity-bound by the existing job-result signature), consumer seals/stores; (ii) job returns the typed result, the consuming orchestrator wraps with its own keys. Recommend one, with the storage and re-share/forwarding implications (can the user forward a depackaged email as BEAP to a counterparty later? what does that require of the capsule form?).

### G. Storage + UI delta (the product-visible change O must bless)
Compare today's plain-mail storage/rendering (from A) against the SafeTextV1 world: what columns/tables change (migration sketch), what the inbox shows for an HTML email post-cutover, how sealed original artifacts surface in the UI (open-original = future `view-attachment` microVM job — note the dependency, do not design it), and what visibly degrades or changes for the user. Produce an explicit, plain-language list of product-visible deltas for sign-off — this is a decision input, not a footnote.

### H. Entry-point confirmation + failure semantics
Confirm provider sync is the only raw-mail ingress (P2P/WS/relay/file carry wire BEAP, not MIME — verify against the ENTRYPOINT_AUDIT). Then map depackage-failure handling onto the existing quarantine machinery: what blob is quarantined when MIME parsing fails (the raw bytes, custody-sealed?), reason codes, retry semantics, and the `E_SAFETEXT_REJECTED` path — consistent with B1's error-mapping discipline (no unvalidated insert, no silent drop, no inline fallback).

---

## 3. Deliverables beyond the findings

1. **B2 build plan sketch** — ordered, flag-gated steps (its own flag, e.g. `WRDESK_SEAM_DEPACKAGE_CUTOVER`, default OFF; original inline path retained), each leaving the branch working. Include the worker-gap build items (D), the byte-courier fetch delta (B), the `detectAndRouteMessage` conversion to a result-consumer (C), capsule wrap (F), storage migration (G), and parity strategy: flag-off byte-identical; flag-on parity must be **redefined** per kind of mail (BEAP-carrier emails: identical downstream pipeline-2 behavior given identical extracted packages; plain mail: equivalence per the blessed delta list from G, not byte-identity).
2. **Rig proof obligations (specified, not run):** prerequisite = fix the `/dev/vhost-vsock` ACL and land the deferred Build A dispatcher-path microVM proof; then B2's end-to-end proof = a real fetched email depackaged in a per-action crosvm microVM through `dispatch()`, orchestrator provably never parsing the raw bytes (guard instrumentation), overlay nuked, sealed insert + UI notification normal; plus fail-closed on a no-KVM box. State these as the B2 build's exit criteria.
3. **Open questions ranked by blocking weight**, with anything you could not determine from code listed as unknown, not guessed.

---

## 4. Out of scope (do not analyze beyond noting touchpoints)

Fetch relocation to sandbox/appliance (later build). `decrypt-qbeap` (later build; the decrypt blocks stay). Build C / handshake `critical_job_*` family / appliance role plumbing. `view-attachment`/`open-link` implementation (note dependencies only). B1 default-flip + inline-path deletion (separate cleanup after soak). Extension Stage-5 (its Chromium-side depackaging is a parallel mechanism — note any contract it shares with the worker, nothing more).

---

## 5. Report structure (`0006-b2-analysis-report.md`)

1. Plain-mail trace + parse-location inventory (A) · 2. Per-provider raw-bytes assessment + byte-courier delta (B) · 3. Carrier/classification findings + what moves into the job (C) · 4. Worker gap list + hardening posture (D) · 5. Proposed result contract (E) · 6. Capsule contract recommendation (F) · 7. Storage/UI delta + product sign-off list (G) · 8. Entry-point confirmation + failure mapping (H) · 9. Build plan sketch + rig exit criteria · 10. Contradictions found · 11. Ranked open questions.
