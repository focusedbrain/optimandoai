# Handshake Security Model

## Principles

1. **Handshake capsules carry ONLY identity metadata** — no content, no binary data, no free-text payloads.
2. **Content enters the trusted zone EXCLUSIVELY via validated BEAP capsules** that traverse the full 20+ step ingestor pipeline.
3. **Every ingestion path traverses Gate 1 (format) → Gate 2 (canonical rebuild) → Gate 3 (crypto verification)** — no exceptions, not even for locally-built capsules.
4. **The original JSON is never stored** — only the canonical-rebuilt object enters the database.
5. **LLM chat is strictly unidirectional** — context is read-only data in XML-escaped `<data>` tags, never instructions. User questions are the only user-role messages.

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
| `capsule_hash`           | regex      | `/^[a-f0-9]{64}$/` (SHA-256 hex)                |
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
| Malicious content in blocks    | `context_blocks` is a denied field — rejected outright. Content only via BEAP-Capsule pipeline |
| Prompt injection via context   | LLM sees context only in `<data_entry readonly="true">` XML tags; system prompt is hardcoded |
| SQL injection via field values | Prepared statements (better-sqlite3) + canonical rebuild with validated formats            |
| Unicode/encoding attacks       | All strings NFC-normalized; control characters (U+0000–U+001F except newline) stripped      |
| Oversized payloads             | 64KB max per capsule; field-level length limits; 1000 max proofs per capsule                |
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
