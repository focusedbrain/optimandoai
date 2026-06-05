# wrdesk — B2 Build Spec: Email Depackaging Cutover (docs/build-specs/0007)

**Type:** Build. Flag-gated end to end; zero behavior change with the flag off. Commit this spec verbatim as `docs/build-specs/0007-b2-build-spec.md` before any code.

**Pre-flight:** `git pull`; branch `feature/layered-sandbox`; HEAD contains the B2 analysis commits (`0005`/`0006` present in `docs/build-specs/`). Final report lands as `0008-b2-build-report.md`.

---

## 1. Rulings (binding) and the new invariant

**R1 — HTML→SafeText.** The HTML-to-text derivation the live path performs at `gateway.ts:2485` moves **inside the key-less guest** — same algorithm/library, or a pure equivalent with proven output-equivalence on a corpus. The original HTML is preserved as a custody-sealed artifact (input to the future `view-attachment` job — preserve only, do not design viewing). Links surface through SafeTextV1's link channel matching today's renderer treatment. Plain-mail parity is hereby defined as: **same derived text as today**, plus sealed original artifacts.

**R2 — Provider input is an opaque-payload union.** `rfc822-raw` (IMAP native; Gmail `format=raw`; Outlook `/$value` where the spike proves it faithful) **or** `provider-structured-json` (the provider's payload shipped into the guest unparsed; the guest walks it). The orchestrator inspects neither form. The Outlook `/$value` spike (timeboxed; real test account; fidelity corpus vs the structured payload covering attachments, encodings, large messages, throttling) determines **preference order per provider, never feasibility** — a negative spike result routes Outlook to the structured-json input, not to inline parsing.

**R3 — Carrier extraction + capsule.** Port the detection logic from `messageRouter.ts:319–377` into the guest **verbatim**, documented as an explicit rule list; parity is the goal; tightening the rules is a separate later change. Extracted BEAP packages travel in a **dedicated opaque channel** (not custody-sealed; integrity via the existing job-result signature) and are handed to the B1-routed pipeline-2 path at the consumer. Capsule form is **consumer-wrap**: the key-less guest emits the typed result; the key-holding orchestrator seals/stores as today; forwarding-as-BEAP is a send-time operation, out of scope.

**INV-7 — No risk routing (high-assurance rule).** Whenever any step cannot establish its safety contract — opaque payload unobtainable, guest failure, limits exceeded, safe-text rejection, **ambiguous or partially-matching carrier classification**, fidelity doubt — the message is quarantined (raw/opaque bytes custody-sealed, typed reason code) or the operation fails closed. There is never a best-effort inline parse, partial-trust display, or silent downgrade of the isolation level. Tier and topology may change **where** the boundary sits (in-process-inside-the-VM vs microVM); they never change **whether** untrusted structure crosses into the orchestrator unparsed. Encode INV-7 in the seam invariant docs and enforce it in every error-mapping branch of this build.

---

## 2. Phase 0 — Rig prerequisites (parallel track; gates Phase 3's exit, not Phases 1–2)

1. Fix the `/dev/vhost-vsock` ACL on the mini-PC.
2. Land the carried-forward Build A proof: a `depackage` job through `dispatcher.dispatch()` end-to-end via the microVM (signature + safe-text verification in `verify.ts`, overlay confirmed nuked). Dated append to `rig/README.md`.

## 3. Phase 1 — Worker uplift (off-rig, pure; rig re-verify after Phase 0)

All changes to the guest payload are pure and testable against the bare-Node bundle first; rebundle `worker-bundle.cjs`; rig re-verify when Phase 0 is done.

1. **HTML derivation (R1)** with the output-equivalence corpus (build the corpus from real fixture mail: text-only, HTML-only, multipart-alternative, inline images, nested .eml).
2. **Carrier extraction (R3)**: the verbatim-ported rule list; multi-package and mixed cases handled.
3. **Typed result union**: `plain | beap-carrier | mixed`, multiple packages, carrier body SafeText where present, plus the **failure taxonomy** — every failure class maps to a quarantine reason code (INV-7), including `ambiguous-classification`.
4. **Opaque package channel (R3)** distinct from custody-sealed artifacts.
5. **C4 hardening (must-fix)**: honor `limits.maxInputBytes` inside the guest (the spec value wins over the hardcoded 8 MiB); add nesting-depth, per-part-size, and decompression-ratio guards; all fail closed inside the guest, re-checked outside.

## 4. Phase 2 — Provider opaque-input work

1. Gmail: `format=raw` retrieval path. IMAP: confirm full-RFC822 fetch and strip any fetch-layer structure walking. Outlook: the R2 spike, then wire the winning input form; structured-json fallback path implemented regardless (it is also the safety net for any provider edge case).
2. **Byte-courier delta**: remove or flag-gate every orchestrator-side parse location identified in finding A so that, flag-on, fetch yields only an opaque payload + minimal envelope metadata the provider supplies outside the MIME body (ids, folder, timestamps).
3. **INV-7 enforcement**: if no opaque form is obtainable for a message, it is held/quarantined with a typed reason — never parsed inline, never skipped silently.

## 5. Phase 3 — Flag-gated cutover

1. Flag `WRDESK_SEAM_DEPACKAGE_CUTOVER` (env + persisted config key), default **OFF**; the original inline path is retained verbatim behind the flag (no deletion).
2. `detectAndRouteMessage` becomes a **consumer of the typed result**: routes on the union, never inspects raw bytes or post-parse structure; extracted packages → the existing (B1-routed) pipeline-2 path; plain → consumer-wrap, seal, store reusing `depackaged_json` for SafeText (migration only if the report's storage findings require it).
3. **Quarantine mapping table** extending B1's discipline: every dispatcher error and every Phase 1 failure-taxonomy entry mapped; no unvalidated insert, no silent drop, no inline fallback while flag-on (INV-3 + INV-7). INV-5 logging at all touched sites.
4. **Parity, per mail kind**: flag off → byte-identical suites. Flag on → (a) carrier mail: extracted packages byte-identical to today's extraction on the corpus, identical downstream pipeline-2 behavior; (b) plain mail: derived text equal per the R1 corpus, sealed originals added, renderer output unchanged (sanitized text + safe links as today); (c) failures: quarantine outcomes per the mapping table.
5. Extend `ENTRYPOINT_AUDIT.md` to cover the email ingress (the analysis showed it currently does not), so the documented invariant matches the trace.

## 6. Exit criteria

1. Flag off: full suites green, zero behavioral diff.
2. Flag on (dev box, in-process resolution): per-kind parity green; INV-7 proofs — unobtainable-opaque → quarantine; ambiguous classification → quarantine; limits breach → quarantine; in no case the inline path.
3. Rig e2e: a real fetched email depackaged in a per-action crosvm microVM via `dispatch()`; guard instrumentation proving the orchestrator never parsed the raw bytes; overlay nuked; sealed insert + UI notification normal. Dated `rig/README.md` append: invariant-0 closed for the sandbox+microvm configuration on the email path.
4. Fail-closed on a no-KVM box with exec=microvm: quarantine per mapping, never inline (INV-3/INV-7).
5. Final report (`0008`): per-phase evidence, spike result + chosen Outlook input form, the verbatim detection rule list, parity corpora contents, mapping table, deviations with rationale.

## 7. Out of scope

Fetch relocation to sandbox/appliance. `decrypt-qbeap` (decrypt blocks remain byte-untouched). Build C / handshake `critical_job_*` / appliance plumbing. `view-attachment`/`open-link` implementation (originals are sealed for it; nothing more). B1 default-flip + inline-path deletion. Detection-rule tightening beyond verbatim parity. Extension Stage-5.

## 8. Process

Small conventional commits; each leaves the branch working flag-off. Phases 1–2 may interleave; Phase 3 starts only when both are green. Of the analysis report's nine ranked open questions, the top three are resolved by R1–R3; if any of the remaining six blocks a phase and is not resolved by this spec, list it verbatim before starting that phase. Report contradictions; never absorb them.
