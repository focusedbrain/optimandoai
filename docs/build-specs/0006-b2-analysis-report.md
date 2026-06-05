# wrdesk — B2 Analysis Report: Email Depackaging Pipeline (raw mail → `depackage` → BEAP capsule)

**Type:** Static analysis only. No code changed except this report and the spec (`0005`). All paths are relative to `code/apps/electron-vite-project/` unless noted `code/packages/...`. Pre-flight passed: branch `feature/layered-sandbox`, working tree clean, B1 closeout commits present (`c6784f66`, `b408278f`, `c557d277`), `git pull` = already up to date.

**One-line conclusion:** the depackage *guest payload* and *seam contract* exist and are sound, but B2 is **substantially larger than a cutover**. Two facts dominate everything below: (1) for Gmail and Outlook the orchestrator **never possessed raw bytes** — it consumes the provider's parse, so "stop parsing in the orchestrator" requires changing the *API call itself* (`format=raw` / `/$value`), and Outlook raw retrieval is unverified in this codebase; (2) the current worker extracts `text/plain` only and **discards HTML**, so HTML-only mail (the common case) would depackage to an **empty body** — HTML→SafeText must be built before plain-mail parity can even be defined. Both are flagged as blocking.

---

## 1. Plain-mail trace + parse-location inventory (A)

### 1.1 End-to-end chain (live path)

| Hop | File:line | Role |
|-----|-----------|------|
| Manual / auto sync entry | `electron/main/email/ipc.ts:2615`, `:571` | `syncAccountEmails` |
| Orchestrator | `electron/main/email/syncOrchestrator.ts:353`, `:403` | per-account serialized sync |
| List phase | `syncOrchestrator.ts:574`-`709` | `emailGateway.listMessages` per folder |
| Detail + route loop | `syncOrchestrator.ts:741`-`800` | `getMessage` → `listAttachments` → `fetchAttachmentBuffer` → `mapToRawEmailMessage` → `detectAndRouteMessage` |
| Gateway | `electron/main/email/gateway.ts:1150`-`1245` | dispatches to provider, then `sanitizeMessageDetail` (`:2479`-`2504`) |
| Classify + store | `electron/main/email/messageRouter.ts:292` (`detectAndRouteMessage`), plain branch `:655`, INSERT `:259`-`269`, sealed write `:718`-`797` |
| UI push | `ipc.ts:2737` / `:508` → renderer `inbox:newMessages` |
| Render | `src/components/EmailMessageDetail.tsx:565`, `:1503` |

The live ingest call is one line:

```794:800:code/apps/electron-vite-project/electron/main/email/syncOrchestrator.ts
          const rawMsg = mapToRawEmailMessage(detail, attachments, { provider: accountInfo?.provider })
          const routeResult = await detectAndRouteMessage(db, accountId, rawMsg)

          newCount++
          result.newInboxMessageIds.push(routeResult.inboxMessageId)
          if (routeResult.type === 'beap') beapCount++
          else plainCount++
```

### 1.2 Where MIME / attacker structure is parsed in the orchestrator process (B2 cutover targets)

| # | Site | File:line | Library / mechanism | Parses attacker-controlled structure? |
|---|------|-----------|---------------------|----------------------------------------|
| T1 | IMAP detail | `providers/imap.ts:986`-`1011` | **`mailparser` `simpleParser`** on full RFC822 (`bodies: ''` at `:973`) | **Yes — full MIME** in main process |
| T2 | Gmail detail | `providers/gmail.ts:1360`-`1442` | custom recursive `payload.parts` walk (`extractBody`/`extractAttachments`) on `format=full` | **Yes — walks provider-parsed tree** |
| T3 | Outlook detail | `providers/outlook.ts:1077`-`1131` | reads Graph `body.content` + `internetMessageHeaders` | **Indirectly — trusts Graph's parse** |
| T4 | Classification | `messageRouter.ts:325`-`377` | inspects `attachments[].content`, `bodyText` (post-parse) | **Yes — consumes parsed parts** (see §3) |
| T5 | Gateway HTML→text | `gateway.ts:2482`-`2490`, `sanitizer.ts:305`-`339` | custom `sanitizeHtmlToText` | operates on already-parsed body |

T1–T3 are the per-provider parse sites; T4 (classification) is the carrier front-step (§3). T5 already produces text-only output but runs in-process on attacker HTML.

### 1.3 What is extracted, stored, displayed for a plain email

- **Extracted** (`ParsedMail` / provider): subject, from/to/cc, date, `text`, `html`, RFC headers; attachments are extracted for **Gmail/Outlook** via provider APIs (`gmail.ts:1420`, `outlook.ts:427`) but **NOT for IMAP** — `imap.ts:1125`-`1132` `listAttachments` is a `return []` stub.
- **Stored** in `inbox_messages` (schema `handshake/db.ts:595`-`627`): `subject`, `body_text`, `body_html`, `depackaged_json` (canonical `content_type:'plain_email'`, built `messageRouter.ts:860`-`866`), plus `seal`/`seal_input_json`/`seal_key_source` (v64/v68). Plain mail **skips validator**; `validation_reason='plain_email_no_validation_required'`.
- **Displayed** (`EmailMessageDetail.tsx:1503`-`1520` → `safeLinks.ts:217`): **never raw HTML**. `body_html` (if present) goes through `DOMParser`, scripts/iframes/`on*` stripped, reduced to **text + safe http(s) link buttons** (`safeLinks.ts:138`-`146`); otherwise `body_text` shown `pre-wrap`. No `dangerouslySetInnerHTML`, no DOMPurify (regression-locked: `src/lib/__tests__/beapInboxUxSourceRegressions.test.ts:42`).
- **Caveat:** `sanitizeMessageDetail` never populates `bodySafeHtml`, and `mapToRawEmailMessage` maps `html: detail.bodySafeHtml` (`syncOrchestrator.ts:256`), so `body_html` is usually **NULL** at ingest — the UI already shows sanitized `body_text` in practice. *(This materially shrinks the G/UI delta — see §7.)*

---

## 2. Per-provider raw-bytes assessment + byte-courier delta (B)

Sync is two-phase for all providers (list → per-id detail). `RawEmailMessage` (`providers/base.ts:25`-`55`) has **no `rfc822Bytes` field** — so the byte-courier contract is a *new field* plus gateway/orchestrator plumbing, not just a fetch tweak.

### 2.1 IMAP (node-imap; **not** `imapflow`)
- Detail path already fetches **full source** (`bodies: ''`, `imap.ts:973`) then parses with `mailparser` (`:986`). **Truly-raw retrieval is available today** — the delta is to *stop* calling `simpleParser` and return `Buffer.concat(chunks)`.
- List path fetches headers only (`HEADER.FIELDS`, `imap.ts:871`); `struct:true` is requested but **never read** (no `attrs.struct` consumer anywhere). Date filtering is client-side (`:932`-`938`).
- **Cost flag:** full-RFC822 per message in sync multiplies bandwidth; `IMAP_PROVIDER_FETCH_MESSAGES_MS`/`IMAP_SYNC_LIST_MESSAGES_MS` = **45 s** (`imapSyncTelemetry.ts:13`); large mail risks timeout.
- **IMAP attachments are not implemented today** → raw RFC822 would become the *only* attachment source (good for B2; the worker must extract them).
- Dead code: `imapFetchReliable.ts` (no importers), `fetchMessagesSince`/`fetchMessagesBeforeExclusive` (no call sites).

### 2.2 Gmail (REST)
- Detail uses **`format=full`** (`gmail.ts:421`) — provider pre-parses into `payload.parts`, which the orchestrator then walks (`extractBody`/`extractAttachments`). **`format=raw` is never used anywhere** in `electron/main`.
- **Delta:** switch `fetchMessage` to `?format=raw`, base64url-decode `response.raw` to `Buffer`, drop `parseGmailMessage`/`extractBody`/`extractAttachments` from the fetch layer.
- **Cost flag:** same call count; `format=raw` payload can be larger; large attachments today come via a separate `attachments.get` (`gmail.ts:440`) — raw RFC822 folds them into one download. `syncMaxMessages` capped 500 (`gmail.ts:338`).

### 2.3 Outlook / Microsoft Graph
- Current code fetches **Graph-normalized JSON** (`body.content`, `internetMessageHeaders`, attachments via separate endpoints). **Raw MIME via `GET /me/messages/{id}/$value` is NOT referenced anywhere** (`grep`: zero `$value`/`mimeContent`).
- **Delta is the largest:** the orchestrator currently *consumes Microsoft's parse of attacker structure*. To become a byte courier it must call `/$value`, and whether that returns byte-faithful original RFC822 for all item types (encrypted, TNEF, calendar) is **unverified in this repo** — needs a spike.
- **Cost flag:** explicit 429 handling, concurrency 4 + 200 ms gaps (`outlook.ts:307`); two-phase = 1 list + N detail GETs.

### 2.4 Byte-courier delta summary
| Provider | Raw available today? | Change | Risk |
|----------|---------------------|--------|------|
| IMAP | Yes (already fetched, then parsed) | stop `simpleParser`; return bytes | bandwidth/timeout on large mail |
| Gmail | No (`format=full`) | `format=raw` + decode | payload size |
| Outlook | **No, and unproven** | `/$value` MIME endpoint | **fidelity unverified — blocking spike** |

**Contradiction with the spec's framing** ("fetch must become a byte courier that hands raw bytes to the seam without parsing"): for Gmail/Outlook the fetch layer **never had raw bytes to stop parsing** — it consumes a provider-side parse. "Stop parsing" understates the change: the *API request* changes, and for Outlook the raw form may not be faithfully obtainable. See §10-C1.

---

## 3. Carrier / classification findings + what moves into the job (C)

### 3.1 How `detectAndRouteMessage` classifies today

Classification lives at `messageRouter.ts:319`-`377`. **Subject is never inspected** (no markers/prefixes). Decision order:

1. **BEAP-named/typed attachment** (`:325`-`343`): `isBeapAttachment` = filename `.beap` or content-type `application/vnd.beap+json` / `application/x-beap` (`:136`-`141`); then `detectBeapCapsule` / `detectBeapMessagePackage` on `att.content.toString('utf-8')` (≤65536).
2. **Body-text JSON** (`:345`-`360`): only if `bodyText.trim().startsWith('{')`, then capsule/package detection on the body string.
3. **`.json` attachment** (`:361`-`377`): `JSON.parse` → `detectBeapInJson`.

Discriminators (`:88`-`149`): capsule = `schema_version:number` + `capsule_type ∈ {initiate,accept,refresh,revoke}`; package = `header` + `metadata` + (`envelope`|`payload`) with `header.encoding ∈ {qBEAP,pBEAP}`.

**The crux:** every discriminator reads `attachments[].content` or `bodyText` — fields that exist **only because the MIME parse already ran** (T1–T3). So **classification is downstream of, and depends on, untrusted-structure parsing.** It cannot run before depackage.

### 3.2 BEAP byte extraction from the carrier (today)
- BEAP attachment → `att.content.toString('utf-8')` (`:329`).
- Plain body → `bodyText` (`:345`).
- `.json` attachment → `content.toString('utf-8')` → `JSON.parse` (`:369`).
- qBEAP/pBEAP split happens **after** detection in the depackage block (`:507`-`534`, verified): qBEAP→`decryptQBeapPackage`, pBEAP→`Buffer.from(packageObj.payload,'base64')`.

### 3.3 What must move into the job
For B2's invariant ("orchestrator never parses attacker structure") to hold, the depackage job must, inside the boundary:
1. Parse the MIME tree (replacing T1–T3).
2. **Locate and extract carrier BEAP packages** (replacing the `isBeapAttachment`/`detectBeap*` logic at `:325`-`377`) — **this logic does not exist in the worker today** (worker gap, §4).
3. Emit a **typed result** whose discriminant tells the orchestrator how to route — `detectAndRouteMessage` becomes a *consumer of the result*, routing on `result.type`, **never parsing**.

`detectBeapCapsule`/`detectBeapMessagePackage`/`isBeapAttachment`/`detectBeapInJson` (`messageRouter.ts:88`-`149`) are the exact heuristics to port into the guest. Note: these run on `text/plain`-decoded JSON today; in-guest they must run on raw MIME parts.

---

## 4. Worker gap list + hardening posture (D)

Worker: `depackaging-microvm/depackagingWorker.ts` (entry `runDepackagingJob` `:114` → `depackage` `:53`); MIME via `mimeExtract.ts` (`extractMime` `:92`); SafeText via `safeText.ts`; sealing via `quarantine-encrypt`.

### 4.1 Capability matrix
| B2 capability | Today | Citation | Gap |
|---------------|-------|----------|-----|
| `text/plain` body | yes | `mimeExtract.ts:109`,`127` | — |
| **HTML → SafeText** | **NO — HTML sealed as opaque artifact, discarded from text** | `mimeExtract.ts:112`-`114`; `safeText.ts:47`-`49` | **Large / blocking** |
| Inline images | as opaque artifacts only | `mimeExtract.ts:108`-`114` | medium (no inline metadata) |
| Attachment extract + seal | yes (raw bytes, in-guest X25519 seal) | `depackagingWorker.ts:74`-`93` | partial (no nested unpack) |
| Carrier-BEAP extraction | **NO** | absent in `depackaging-microvm/` | **Large / blocking** |
| Nested `.eml` (`message/rfc822`) | **NO** | single-level split `mimeExtract.ts:117`-`126` | large |
| Multipart semantics (`alternative`/`related`) | single-level only | `mimeExtract.ts:117`-`126` | large |

### 4.2 SafeTextV1
`safeText.ts:18`-`26`: `{ schema:'safe-text/v1', subject, body_text, attachment_refs[] }`. Built by **positive construction** (NFC, CRLF→LF, strip C0/C1 + bidi/zero-width, caps subject 2 000 / body 1 000 000) — **not** denylist sanitization, **no HTML library**. HTML is deliberately excluded. Host re-validates via `validateSafeText` (`safeText.ts:107`-`143`, wired `critical-jobs/verify.ts:97`).

### 4.3 Sealing locality
Custody **encryption** is **in-guest**: `encryptForQuarantine(bytes, sandboxPeerX25519PubB64)` (`depackagingWorker.ts:74`-`75`; X25519+HKDF+AES-256-GCM, `quarantine-encrypt/index.ts:69`), plaintext zeroized (`:76`-`80`). **Courier projection** (`blob`→`ciphertext`) is **host-side** after signature+schema verify (`blindCourier.ts:55`; `critical-jobs/verify.ts:41`,`101`).

### 4.4 Hardening posture
- **In-guest:** `MAX_INPUT_BYTES` 8 MiB (truncates, not rejects, `mimeExtract.ts:31`,`93`), `MAX_PARTS` 64 (`:32`), `MAX_HEADERS_BYTES` 64 KiB (`:33`), SafeText caps (`safeText.ts:31`-`34`). VM caps 1024 MiB/2 vCPU (`crosvmProvider.ts:87`).
- **Host:** wall-clock (`dispatcher.ts:132`; crosvm `?? 60_000` `crosvmProvider.ts:131`), signature verify, SafeText re-validate, no-fallback-on-workstation, zero-egress VM.
- **Declared-but-DEAD:** `JobSpec.limits.maxInputBytes` is passed (`microVmExecutor.ts:77`, `inProcessExecutor.ts:112`) but **never read** by guest/crosvm → the orchestrator's input cap does not bind the guest (hardcoded 8 MiB wins).
- **Absent:** nesting-depth cap, per-part post-decode size cap, decompression/zip-bomb guards (no attachment decompression exists at all today), reliable fail-closed on malformed MIME (`mimeExtract.ts:88` comment claims fail-closed but `extractMime` does not throw → produces partial/empty parse).

The module self-describes as "the smallest correct thing for Build 1's vertical slice" (`mimeExtract.ts:4`-`10`) — production MIME is explicitly a future guest-image concern. **B2 is that concern.**

---

## 5. Proposed result contract (E)

The current seam `depackage` output is `DepackageOutput { safeText, artifacts }` (`critical-jobs/types.ts:169`-`172`), with input `{ inputBytes: Buffer }` (`:187`) and a public `custodyPubKeyB64` (INV-2, `:236`-`244`). B2 must generalize the output to a **discriminated union** so the orchestrator routes without parsing:

```ts
type DepackageResultV2 =
  | { type: 'plain';        safeText: SafeTextV1; artifacts: CourierArtifactRecord[] }
  | { type: 'beap-carrier'; extractedPackages: OpaquePackageBytes[];
                            carrierSafeText?: SafeTextV1; artifacts?: CourierArtifactRecord[] }
  | { type: 'mixed';        extractedPackages: OpaquePackageBytes[];
                            safeText: SafeTextV1; artifacts: CourierArtifactRecord[] }

interface OpaquePackageBytes {     // never parsed in the guest beyond locating it
  readonly encodingHint: 'qBEAP' | 'pBEAP' | 'unknown'  // from header.encoding only
  readonly bytes: Buffer            // exact carrier package bytes, unparsed
  readonly carrierPart?: string     // provenance: which MIME part it came from
}
```

**Failure taxonomy** (typed errors, fail-closed, mapping to existing codes):
- `E_MALFORMED_MIME` — parse failed / structure unrepresentable.
- `E_LIMITS_EXCEEDED` — input/parts/nesting/part-size over bound (B2 must make limits real, §4.4).
- `E_SAFETEXT_REJECTED` — host re-validation failed (already exists, `critical-jobs/types.ts:278`, `verify.ts:99`).
- `E_DECOMPRESSION_BOMB` — new, if/when bounded decompression is added.

**Channel decision (justified): extracted BEAP packages travel in a dedicated `extractedPackages` opaque channel, NOT the custody-sealed `artifacts` channel.** Reasons:
1. They must be **handed onward to pipeline-2 at the consumer** (qBEAP→`decryptQBeapPackage`, pBEAP/native→`validate-native-beap` — already seam-routed by B1). Custody-sealing them to the sandbox X25519 key (what `artifacts` does) would make them **undecryptable by the workstation consumer** that needs to feed pipeline-2.
2. They are **not secrets**: qBEAP is already ciphertext (only the key-holder can read it); pBEAP is public JSON. So no custody seal is warranted.
3. **Integrity** in transit is already provided by the per-job Ed25519 result signature (`depackagingWorker.ts:118`, verified host-side `verify.ts:94`) — sufficient for opaque-byte handoff.

`artifacts` (custody-sealed) remains for **plain-mail attachments/HTML/inline parts** that get *stored* sealed and opened later via the future `view-attachment` job.

---

## 6. Capsule contract recommendation (F)

### 6.1 What exists
- **Handshake capsules** (`handshake/capsuleBuilder.ts:177`-`247`): require Ed25519 signing (and stored handshake keys for refresh/revoke). **Not key-less.**
- **qBEAP** (`extension-chromium/.../BeapPackageBuilder.ts:611`): hybrid X25519+ML-KEM+AES-GCM ciphertext; requires **handshake private/ML-KEM secret keys** + Ed25519. **Not key-less; excluded from a key-less VM by INV-2/INV-6.**
- **pBEAP** (`BeapPackageBuilder.ts:1821`): public JSON + base64 payload, `encryption_mode:'NONE'`, but **Ed25519-signed** (`:1929`); signing key is vault-backed or ephemeral fallback. **Not handshake-keyed, but not unsigned.**
- **`internal_draft`** (`packages/ingestion-core/src/plainTransform.ts:7`-`14`): `{ schema_version:1, capsule_type:'internal_draft', timestamp, content }`. **Fully key-less.** Validator requires only `timestamp` and skips hash/sender checks (`validator.ts:101`,`913`-`920`).
- Today plain mail is **not** wrapped as a wire BEAP capsule at all; it is stored as canonical `content_type:'plain_email'` JSON in `depackaged_json` + host HMAC seal (`messageRouter.ts:860`, seal `:869`).

### 6.2 Recommendation: **(ii) consumer wraps** (key-less job emits typed result; the key-holding orchestrator wraps/seals/stores)
Rationale:
- The depackage VM is **key-less** (INV-2): it cannot sign with handshake keys, and there is no value in building a wire capsule in-VM since the **authoritative integrity is the host HMAC seal** that must be re-applied host-side anyway (today's model, `messageRouter.ts:869`-`880`). The job-result Ed25519 signature already protects transit.
- Plain mail's stored form becomes **SafeTextV1 (subject + body_text + attachment_refs)** carried in the canonical content; the consumer seals it exactly as today. No new key operation enters the job.
- **Forwarding/re-share as BEAP to a counterparty** is a *separate, later, consumer-key operation*: to forward, the consumer takes the SafeText content and runs the existing `BeapPackageBuilder` (pBEAP = Ed25519 only; qBEAP = handshake keys). The depackage capsule form therefore **does not need to be forwardable** — forwarding is re-wrapping at send time, not at ingest. This keeps the job key-less and avoids baking sender identity into a key-less artifact.

**Rejected option (i)** (key-less in-guest `dBEAP`/`internal_draft` wrap): adds a capsule type and in-guest construction for no integrity gain (host re-seals regardless) and risks implying forwardability the key-less form can't honor. If structural uniformity is later desired, an `internal_draft`-shaped envelope can be synthesized **host-side** from the typed result at zero extra risk.

---

## 7. Storage / UI delta + product sign-off list (G)

### 7.1 Storage migration sketch
- `inbox_messages` already has `depackaged_json` + `depackaged_metadata` (v63) + `seal*` (v64/v68). **No SafeText column exists today.**
- Minimal migration: persist SafeTextV1 **inside `depackaged_json`** under a new `content_type:'plain_email_safetext_v1'` (subject, body_text, attachment_refs) — sealed exactly as today; OR add explicit `safe_text_json` column. Reusing `depackaged_json` avoids a column add and keeps the seal contract unchanged. **Recommend reuse** + bump `depackaged_metadata.format`.
- `body_html` becomes **vestigial** (already usually NULL — §1.3) → write NULL going forward; keep column for back-compat.
- Attachments already encrypted at rest (`inbox_attachments` `encryption_key/iv/tag`, v45) and shown via "Open original" — this **largely already matches** the "sealed original artifacts" target; the worker's in-guest seal replaces the current in-process attachment encryption.

### 7.2 Product-visible deltas (for sign-off)
1. **HTML rendering:** *minimal change* — the UI already renders sanitized text + safe link buttons, not HTML (`safeLinks.ts`). The visible change is mostly internal (text now sourced from SafeText body rather than `sanitizeHtmlToText`).
2. **HTML-only emails (no `text/plain` part):** **REGRESSION RISK.** Today `sanitizeHtmlToText` derives text from HTML (`gateway.ts:2485`). The current worker would yield an **empty SafeText body** for HTML-only mail (it discards HTML). Until HTML→SafeText exists in the guest (§4.1), these emails show **no body**. This is the single biggest product-visible risk and is *blocking* (§10-C2 / §11-Q1).
3. **Inline images:** become sealed artifacts ("Open original"), not inline in the body — a visible change for image-rich mail; depends on the future `view-attachment` microVM job (note dependency only, do not design).
4. **Attachments:** opening requires the future `view-attachment` job; today PDFs render extracted text and others are "open original". Net: similar UX, gated on `view-attachment`.
5. **IMAP attachments:** today **not ingested at all** (stub). Post-cutover, raw RFC822 lets the worker extract them — a *net improvement*, but new behavior to bless.

### 7.3 Dependency note
"Open original" of a sealed artifact = future `view-attachment` microVM job (INV-6 custody-local). B2 **depends on** but does **not design** it. Today's path is `InboxAttachmentRow.tsx:72` `openAttachmentOriginal`.

---

## 8. Entry-point confirmation + failure mapping (H)

### 8.1 Ingress inventory
| Ingress | Entry | Payload | Raw MIME? |
|---------|-------|---------|-----------|
| **Provider email sync** | `syncOrchestrator.ts:795` → `detectAndRouteMessage` | provider-parsed `RawEmailMessage` | **the only MIME ingress** |
| P2P HTTP | `p2p/p2pServer.ts:437` (handshake) / `:356` (`processBeapPackageInline`) | structured BEAP JSON | no |
| Coordination WS | `p2p/coordinationWs.ts:328` / `:370` | structured BEAP JSON | no |
| Relay pull | `p2p/relayPull.ts:164` / `:206` | structured BEAP JSON | no |
| File import | `handshake/ipc.ts:806` → `processIncomingInput` | structured BEAP capsule | no |
| Ingestion API (WS/HTTP) | `ingestion/ipc.ts:57`,`243` | structured BEAP | no |

**Confirmed:** provider email sync is the **only raw-MIME ingress**; P2P/WS/relay/file all carry already-structured BEAP (`application/vnd.beap+json`). Nuance vs `ENTRYPOINT_AUDIT.md`: that doc covers **handshake-capsule** ingress only (it does not mention email/`detectAndRouteMessage` at all, `ENTRYPOINT_AUDIT.md:5`,`73`) — so it confirms the *BEAP* side but is **silent on email**; B2's claim rests on the sync trace, not on that doc. Legacy `beapSync.ts` (email→`processIncomingInput`) is **not wired from `main.ts`** (`beapSync.ts:347`-`353` admits legacy status).

### 8.2 Failure mapping (consistent with B1: no unvalidated insert, no silent drop, no inline fallback)
- **Quarantine machinery** exists: `quarantine_messages` (`handshake/db.ts:1126`-`1138`) with `rejection_reason`, custody-sealed blob (`quarantine-blob-storage` + `quarantine-encrypt`, sealed to sandbox X25519), `paired_sandbox_handshake_id`, `seal`.
- **What to quarantine on depackage failure:** the **raw RFC822 input bytes** (the depackage job input), custody-sealed — symmetric with today's BEAP quarantine which seals the package bytes (`messageRouter.ts:601`).
- **Reason codes:** map the §5 failure taxonomy to `rejection_reason` strings, mirroring B1's `seam_validation_dispatch_failed:<code>` convention (`messageRouter.ts:538` block) → e.g. `seam_depackage_failed:E_MALFORMED_MIME`, `:E_SAFETEXT_REJECTED`, `:E_LIMITS_EXCEEDED`.
- **Retry:** reuse the existing retry/drain semantics (`extensionMergeRetryBuffer.ts` pattern, max 3) for transient executor-unavailable; permanent parse failures quarantine immediately.
- **`E_SAFETEXT_REJECTED`** already enforced host-side at job-result verification (`verify.ts:99`) — wire it to quarantine, not to a silent plain insert.
- **Fail-closed:** when flag ON and dispatch fails, **quarantine** (or retry) — never fall back to in-process MIME parse, mirroring B1's discipline.

---

## 9. Build plan sketch + rig exit criteria

### 9.1 Ordered, flag-gated steps — flag `WRDESK_SEAM_DEPACKAGE_CUTOVER` (env) / `seamDepackageCutover` (persisted), **default OFF**, inline path retained; each step leaves the branch working
0. **Prereq (carried from B1):** fix `/dev/vhost-vsock` ACL and land the deferred Build A dispatcher-path microVM rig proof. B2 cannot finish its rig exit without it.
1. **Worker-gap build (D)** — pure guest payload, no live wiring: HTML→SafeText (port/adapt `sanitizeHtmlToText` into the guest or define an HTML-derived text field), carrier-BEAP extraction (port `detectBeap*`/`isBeapAttachment` onto raw parts), `multipart/alternative|related` semantics, decide nested `.eml` scope; **make limits real** (bind `maxInputBytes`, add nesting-depth + per-part caps, fail-closed on malformed MIME, decompression guards if any decode added). Unit + fuzz/hostile-input tests.
2. **Result contract (E)** — generalize `JobOutputMap['depackage']` to the discriminated union + `OpaquePackageBytes` + failure taxonomy; flag-gated types only, no live caller.
3. **Byte-courier fetch delta (B)** — add `rfc822Bytes` to `RawEmailMessage` + gateway/orchestrator plumbing; per provider raw retrieval behind flag (IMAP `bodies:''` no-parse; Gmail `format=raw`; **Outlook `/$value` after the fidelity spike**). Flag-off keeps current parsed fields.
4. **`detectAndRouteMessage` → result-consumer (C)** — when flag ON, route raw bytes through `dispatch({kind:'depackage'})`, classify on `result.type`, store plain via SafeText, hand `extractedPackages` to the existing pipeline-2 (validate-native-beap already seam-routed B1; decrypt blocks unchanged). Orchestrator parses nothing.
5. **Capsule wrap + storage (F/G)** — consumer wraps SafeText into canonical + host seal; `depackaged_json` reshape (`plain_email_safetext_v1`); `body_html`→NULL going forward; UI sources body from SafeText.
6. **Parity (redefined per mail kind):** flag-OFF byte-identical (no seam loaded — reuse B1's dynamic-import discipline so flag-off cost is zero); flag-ON: **BEAP-carrier** = identical downstream pipeline-2 behavior given identical extracted packages; **plain** = equivalence per the **blessed §7.2 delta list**, *not* byte-identity (SafeText body of HTML mail will differ from `sanitizeHtmlToText`).

### 9.2 Rig proof obligations (specified, not run) — B2 exit criteria
- A **real fetched email** is depackaged in a **per-action crosvm microVM** through `dispatch({kind:'depackage'})`.
- The **orchestrator provably never parses the raw bytes** — guard instrumentation asserting no `simpleParser`/`extractMime`/provider-parse call in the main process while the flag is ON (e.g. a process-scoped tripwire counter).
- Overlay is **nuked** after the action (per-action flush).
- **Sealed insert + UI notification** behave normally for plain mail; carrier mail's extracted packages reach pipeline-2.
- **Fail-closed on a no-KVM box** (no in-process fallback on workstation).

---

## 10. Contradictions found

- **C1 (medium-high): "fetch becomes a byte courier that stops parsing" understates the API-provider reality.** For Gmail/Outlook the orchestrator **never had raw bytes** — it consumes the provider's parse (`gmail.ts:1360`-`1442` `format=full`; `outlook.ts:1077`-`1131` Graph JSON). The delta is changing the *API request* (`format=raw` / `/$value`), and **Outlook raw retrieval is unverified in this codebase** (no `$value` reference). The spec's "stop parsing" framing should be "switch to raw retrieval and verify fidelity," with Outlook flagged as a spike/risk. (§2)
- **C2 (high / blocking): HTML-only mail would depackage to an empty body.** The worker extracts `text/plain` only and discards HTML (`mimeExtract.ts:112`; `safeText.ts:47`). The live path *does* derive text from HTML today (`gateway.ts:2485`). Without HTML→SafeText in the key-less guest, the common HTML-only email loses its body post-cutover. Plain-mail parity (§9.1-6) **cannot be defined** until this is resolved. (§4.1, §7.2)
- **C3 (medium): carrier classification cannot precede depackage.** The spec correctly says classification must move into the job; confirming the contradiction with *any* design that keeps `detectAndRouteMessage` parsing first — its discriminators read post-parse fields (`messageRouter.ts:325`-`377`), and the carrier-BEAP extraction logic **does not exist in the worker** (§3.3, §4.1). This is a build item, not a blocker, but must be sequenced before step 4.
- **C4 (low): `JobSpec.limits.maxInputBytes` is dead.** Declared and passed but never read by guest/crosvm (`hypervisorProvider.ts:66`; unused in `depackagingWorker`/`crosvmProvider`); the guest's hardcoded 8 MiB wins. Any B2 reliance on per-job input caps is currently illusory. (§4.4)
- **C5 (informational): `ENTRYPOINT_AUDIT.md` does not cover email.** It validates the BEAP/handshake ingress claim but is silent on `detectAndRouteMessage` (`ENTRYPOINT_AUDIT.md:5`,`73`). The "provider sync is the only raw-MIME ingress" conclusion rests on the live sync trace (§8.1), which holds, but the audit doc should not be cited as proof for the email side.

---

## 11. Ranked open questions (by blocking weight)

1. **(BLOCKING) HTML→SafeText policy for the key-less guest.** How does SafeText represent HTML-only mail — port `sanitizeHtmlToText` into the guest, a vetted HTML-to-text lib in the guest image, or a new SafeText field? Determines whether plain-mail parity is even definable. *Cannot be answered from code; needs a product+security decision.* (C2)
2. **(BLOCKING) Outlook/Graph raw-MIME fidelity.** Does `GET /me/messages/{id}/$value` return byte-faithful original RFC822 for all item types (encrypted, TNEF, calendar)? If not, B2's "orchestrator never parses attacker structure" invariant **cannot hold for Outlook**. *Unknown from code — requires a live spike.* (C1)
3. **(HIGH) Carrier-BEAP extraction spec inside the guest.** Exact rules to locate qBEAP/pBEAP within raw MIME (which parts, size caps, multiple-package handling) and the `OpaquePackageBytes` shape handed to pipeline-2. *Designable from §3/§5; needs sign-off.*
4. **(HIGH) Capsule form + storage sign-off (F/G).** Accept consumer-wrap (ii) + `depackaged_json` reuse? Bless the §7.2 product-visible delta list, especially HTML-only and inline-image changes.
5. **(HIGH) Cost/limits for raw retrieval.** Gmail `format=raw` size/quota; IMAP full-RFC822 within the 45 s timeout for large mail (`imapSyncTelemetry.ts:13`). *Partly unknown — needs measurement.*
6. **(MEDIUM) Guest hardening scope.** Bind `maxInputBytes`, add nesting-depth/per-part caps, decompression bounds, reliable fail-closed. How aggressive (reject vs truncate)? (C4, §4.4)
7. **(MEDIUM) Nested `.eml` / `message/rfc822` scope** — in or out of B2? Worker has none today (§4.1).
8. **(LOW) Dead-code disposition** — delete `imapFetchReliable.ts`, `fetchMessagesSince`/`fetchMessagesBeforeExclusive` as part of the byte-courier rework, or leave?
9. **(LOW, noted not analyzed) Extension Stage-5 contract overlap** — the Chromium-side depackaging (`BeapPackageBuilder.ts`) is a parallel mechanism; does it share the SafeText/worker contract or diverge? Out of scope per spec §4; flagged only.

---

### Evidence base
Findings cross-checked against the live code; the most load-bearing claims (classification `messageRouter.ts:319`-`377`, depackage block `:507`-`534`, seam contract `critical-jobs/types.ts:168`-`220`) were read directly during this analysis. Remaining `file:line` citations were gathered by scoped read-only exploration of `electron/main/email/`, `depackaging-microvm/`, `critical-jobs/`, `ingestion/`, `handshake/`, `src/`, and `packages/ingestion-core/`.
