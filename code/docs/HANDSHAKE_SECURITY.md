# Handshake Security Model

## Principles

1. **Handshake capsules carry ONLY identity metadata** — no content, no binary data, no free-text payloads.
2. **Content enters the trusted zone EXCLUSIVELY via validated BEAP capsules** that traverse the full 20+ step ingestor pipeline.
3. **Every ingestion path traverses Gate 1 (format) → Gate 2 (canonical rebuild) → Gate 3 (crypto verification)** — no exceptions, not even for locally-built capsules.
4. **The original JSON is never stored** — only the canonical-rebuilt object enters the database.
5. **LLM chat is strictly unidirectional** — context is read-only data in XML-escaped `<data>` tags, never instructions. User questions are the only user-role messages.
6. **Every capsule is cryptographically bound** — a `context_hash` (SHA-256) covers the full handshake state including both party identities, timestamps, nonces, and policy anchors.

---

## Security Analysis — Prior Design

### Guarantees that existed before hardening

| Guarantee           | Status  | Mechanism                                                    |
|---------------------|---------|--------------------------------------------------------------|
| Integrity           | Partial | `capsule_hash` covers 7 core fields, but not identity emails |
| Authentication      | Partial | `senderIdentity.email` was present but not hash-bound        |
| Replay protection   | Partial | `seq` + `prev_hash` chain, but no timestamp window or nonce  |
| Identity binding    | Weak    | `sender_email` existed in `senderIdentity` but could be swapped without detection since it was not covered by `capsule_hash` |
| Confidentiality     | N/A     | Out of scope (capsules carry metadata only)                  |

### Vulnerabilities identified

1. **No receiver identity binding** — capsules had no `receiver_id` or `receiver_email` field, so an intercepted capsule could be redirected to any orchestrator.
2. **Sender email not hash-bound** — `senderIdentity.email` existed in the capsule but was not included in the `capsule_hash` computation, allowing an attacker to modify it without detection.
3. **No nonce** — without a nonce, two capsules with identical fields at the same timestamp (within clock precision) produced identical hashes, weakening deduplication.
4. **No timestamp window enforcement** — the `CLOCK_SKEW_TOLERANCE_MS` constant existed but was not enforced during capsule verification.
5. **No contextual integrity proof** — the `capsule_hash` covered only chain-critical fields (seq, prev_hash, policy hash), not the full handshake state.

---

## Cryptographic Hardening (Current Design)

### New fields added to the wire capsule

| Field            | Type   | Validation                     | Purpose                           |
|------------------|--------|--------------------------------|-----------------------------------|
| `sender_email`   | email  | RFC-valid, NFC normalized      | Hash-bound sender identity        |
| `receiver_id`    | regex  | `/^[a-zA-Z0-9_-]{1,256}$/`    | Hash-bound receiver identity      |
| `receiver_email` | email  | RFC-valid, NFC normalized      | Hash-bound receiver identity      |
| `context_hash`   | regex  | `/^[a-f0-9]{64}$/` (SHA-256)  | Full contextual integrity proof   |
| `nonce`          | regex  | `/^[a-f0-9]{64}$/` (32 bytes) | Replay protection via uniqueness  |

### Dual-hash architecture

```
capsule_hash    = SHA-256(chain-critical fields)     — deduplication + chain integrity
context_hash    = SHA-256(full handshake context)     — tamper detection + identity binding
```

### Context hash coverage

The `context_hash` is computed over a deterministic canonical JSON of:

| Field                    | Always | Type-specific |
|--------------------------|--------|---------------|
| `capsule_type`           | ✅     |               |
| `handshake_id`           | ✅     |               |
| `nonce`                  | ✅     |               |
| `receiver_email`         | ✅     |               |
| `receiver_id`            | ✅     |               |
| `relationship_id`        | ✅     |               |
| `schema_version`         | ✅     |               |
| `sender_email`           | ✅     |               |
| `sender_id`              | ✅     |               |
| `sender_wrdesk_user_id`  | ✅     |               |
| `seq`                    | ✅     |               |
| `timestamp`              | ✅     |               |
| `wrdesk_policy_hash`     |        | initiate, accept, refresh |
| `wrdesk_policy_version`  |        | initiate, accept, refresh |
| `sharing_mode`           |        | accept        |
| `prev_hash`              |        | refresh       |

### Canonicalization algorithm

1. Build a plain object with only the fields listed above.
2. Sort keys alphabetically.
3. Serialize with `JSON.stringify` (no whitespace, no indentation).
4. Compute SHA-256 over the UTF-8 bytes.
5. Output as 64-character lowercase hex string.

Both sender and receiver independently execute this algorithm and must arrive at the same hash.

---

## Verification Algorithm

When the receiving orchestrator processes an incoming capsule:

```
Step 1: Validate required fields     → reject if any missing
Step 2: Validate nonce format         → must be 64-char hex
Step 3: Validate timestamp freshness  → within ±5 min of receiver clock
Step 4: Check nonce replay            → reject if nonce seen before
Step 5: Verify receiver_email         → must match local orchestrator's email
Step 6: Reconstruct canonical payload → same algorithm as sender
Step 7: Recompute context_hash        → SHA-256 over canonical JSON
Step 8: Compare with provided hash    → constant-time comparison
Step 9: Verify capsule_hash           → existing chain integrity check
```

Failure at any step produces a typed reason for audit logging.

---

## Capsule Field Allowlist

Only the fields listed below may exist in a handshake capsule. Any unlisted field is silently stripped during canonical rebuild. Any *denied* field causes immediate rejection.

### Required Fields

| Field                    | Type       | Validation                                      |
|--------------------------|------------|--------------------------------------------------|
| `schema_version`         | literal    | Must be `1`                                      |
| `capsule_type`           | enum       | `initiate`, `accept`, `refresh`, `revoke`        |
| `handshake_id`           | regex      | `/^hs-[a-f0-9-]{1,128}$/`                       |
| `relationship_id`        | regex      | `/^rel-[a-f0-9-]{1,128}$/`                      |
| `sender_id`              | regex      | `/^[a-zA-Z0-9_-]{1,256}$/`                      |
| `sender_wrdesk_user_id`  | regex      | `/^[a-zA-Z0-9_-]{1,256}$/`                      |
| `sender_email`           | email      | RFC-valid, NFC normalized                        |
| `receiver_id`            | regex      | `/^[a-zA-Z0-9_-]{1,256}$/`                      |
| `receiver_email`         | email      | RFC-valid, NFC normalized                        |
| `capsule_hash`           | regex      | `/^[a-f0-9]{64}$/` (SHA-256 hex)                |
| `context_hash`           | regex      | `/^[a-f0-9]{64}$/` (SHA-256 hex)                |
| `nonce`                  | regex      | `/^[a-f0-9]{64}$/` (32 bytes hex)               |
| `timestamp`              | ISO 8601   | Parseable date string                            |
| `seq`                    | integer    | `0 ≤ seq ≤ 2,147,483,647`                       |
| `external_processing`    | enum       | `none`, `local_only`                             |
| `reciprocal_allowed`     | boolean    | Strict boolean                                   |
| `wrdesk_policy_hash`     | string     | Max 256 chars, NFC normalized                    |
| `wrdesk_policy_version`  | string     | Max 128 chars, NFC normalized                    |

### Required Nested Objects

**`senderIdentity`:**

| Field              | Type    | Validation                                |
|--------------------|---------|-------------------------------------------|
| `email`            | email   | RFC-valid, NFC normalized                 |
| `iss`              | string  | Max 512 chars                             |
| `sub`              | string  | Max 256 chars                             |
| `email_verified`   | literal | Must be `true`                            |
| `wrdesk_user_id`   | regex   | `/^[a-zA-Z0-9_-]{1,256}$/`               |

**`tierSignals`:**

| Field                  | Type   | Validation                                        |
|------------------------|--------|---------------------------------------------------|
| `plan`                 | enum   | `free`, `pro`, `publisher`, `enterprise`           |
| `hardwareAttestation`  | object | `null` or `{ verified: true, fresh, attestedAt }`  |
| `dnsVerification`      | object | `null` or `{ verified: true, domain }`             |
| `wrStampStatus`        | object | `null` or `{ verified: true, stampId }`            |

### Optional Fields

| Field                    | Type    | Validation                                 | When       |
|--------------------------|---------|--------------------------------------------|------------|
| `sharing_mode`           | enum    | `receive-only`, `reciprocal`               | `accept`   |
| `prev_hash`              | regex   | `/^[a-f0-9]{64}$/`                        | `refresh`, `revoke` |
| `context_block_proofs`   | array   | Max 1000 entries; each `{ block_id, block_hash }` | `refresh`  |

**`context_block_proofs` entry:**

| Field        | Type   | Validation                        |
|--------------|--------|-----------------------------------|
| `block_id`   | regex  | `/^blk_[a-f0-9]{1,64}$/`         |
| `block_hash` | regex  | `/^[a-f0-9]{64}$/` (SHA-256 hex)  |

---

## Denied Fields

Presence of ANY of these fields triggers immediate rejection of the entire capsule:

```
context_blocks, data, payload, body, content,
attachment, attachments, file, files, binary,
script, code, html, exec, command, eval
```

---

## Entry Points & Gate Coverage

Every path into the system traverses the full gate sequence:

| Entry Point                              | Gate 1 | Gate 2 | Gate 3 | Notes                                |
|------------------------------------------|--------|--------|--------|--------------------------------------|
| `ingestion/ipc.ts` → `handleIngestionRPC` | ✅     | ✅     | ✅     | Primary RPC path                     |
| `ingestion/ipc.ts` → HTTP POST route     | ✅     | ✅     | ✅     | REST API path                        |
| `beapSync.ts` → Email body detection     | ✅     | ✅     | ✅     | Calls `handleIngestionRPC`           |
| `beapSync.ts` → .beap attachment         | ✅     | ✅     | ✅     | 64KB pre-parse guard + `handleIngestionRPC` |
| `CapsuleUploadZone.tsx` → IPC submit     | ✅     | ✅     | ✅     | Routes through `handshake:submitCapsule` → `handleIngestionRPC` |
| `capsuleTransport.ts` → local loopback   | ✅     | ✅     | ✅     | Self-built capsules also pass Gate 2 (defense-in-depth) |
| `handshake/ipc.ts` → `buildForDownload`  | —      | —      | —      | BUILD path (no ingestion); capsule enters Gate 2 on receiver side |

---

## Threat Model

| Attack Surface                 | Protection                                                                                 |
|--------------------------------|--------------------------------------------------------------------------------------------|
| Manipulated `.beap` file       | No free-text field; every field has strict format (UUID, email, ISO timestamp, SHA-256 hex) |
| Capsule field tampering        | `context_hash` binds ALL identity/temporal/policy fields — any mutation invalidates the hash |
| Sender email spoofing          | `sender_email` is included in `context_hash` — modification is detected                    |
| Receiver misdirection          | `receiver_email` and `receiver_id` are hash-bound — capsule can only be accepted by the intended party |
| Replay attack                  | `nonce` (32 bytes, CSPRNG) + timestamp window (±5 min) + `seq` chain make replay infeasible |
| Malicious content in blocks    | `context_blocks` is a denied field — rejected outright. Content only via BEAP-Capsule pipeline |
| Prompt injection via context   | LLM sees context only in `<data_entry readonly="true">` XML tags; system prompt is hardcoded |
| SQL injection via field values | Prepared statements (better-sqlite3) + canonical rebuild with validated formats            |
| Unicode/encoding attacks       | All strings NFC-normalized; control characters (U+0000–U+001F except newline) stripped      |
| Oversized payloads             | 64KB max per capsule; field-level length limits; 1000 max proofs per capsule                |
| Timing side-channel on hash    | Constant-time comparison (`crypto.timingSafeEqual`) for `context_hash` verification         |
| XSS via LLM output            | Output rendered as plain text (`whiteSpace: pre-wrap`), never HTML/Markdown                 |
| Preload bridge exploitation    | No generic IPC proxy; each function maps to exactly one hardcoded channel with input validation |

---

## Dual-Path Architecture

The handshake system is accessible from two entry points — both converge on the same backend:

```
Chrome Extension (sidepanel/popup)
  └── handshakeRpc.ts
      └── chrome.runtime.sendMessage
          └── background.ts → WebSocket
              └── Electron main.ts → handleHandshakeRPC(method, params, db)

Analysis Dashboard (Electron renderer)
  └── window.handshakeView.*
      └── ipcRenderer.invoke (preload.ts)
          └── ipcMain.handle (main.ts) → handleHandshakeRPC(method, params, db)
```

All actions — initiate, accept, decline, list, buildForDownload — call the same `handleHandshakeRPC` function regardless of origin.

---

## Key Files

| File | Role |
|------|------|
| `electron/main/handshake/contextHash.ts` | Context hash computation — canonical payload builder + SHA-256 + nonce generation |
| `electron/main/handshake/handshakeVerification.ts` | Full 8-step cryptographic verification pipeline for received capsules |
| `electron/main/handshake/capsuleHash.ts` | Chain integrity hash (capsule_hash) — deduplication + prev_hash chain |
| `electron/main/handshake/canonicalRebuild.ts` | Gate 2 — field allowlist, denied field check, canonical rebuild |
| `electron/main/handshake/sanitize.ts` | NFC normalization, control char stripping, email validation |
| `electron/main/handshake/enforcement.ts` | Gate 3 — `extractVerifiedInput`, `processHandshakeCapsule` |
| `electron/main/handshake/ipc.ts` | `handleHandshakeRPC` — central dispatch |
| `electron/main/handshake/capsuleBuilder.ts` | Builds wire-format capsules (initiate, accept, refresh, revoke) |
| `electron/main/ingestion/ipc.ts` | `handleIngestionRPC` — Gate 1 + Gate 2 insertion |
| `electron/main/email/beapSync.ts` | Email polling, body/attachment detection |
| `electron/preload.ts` | IPC bridge with input validation, no generic proxy |
| `src/components/contextEscaping.ts` | LLM prompt construction with XML escaping |
| `src/components/HandshakeChatSidebar.tsx` | Chat UI — plain text rendering only |
