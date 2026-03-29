# Outbox Architecture — Analysis Report

**Scope:** Analysis only (no implementation).  
**Date:** 2026-03-28  
**Goal:** Plan a durable **Outbox** for outbound BEAP™ messages (what was sent, to whom, when, delivery status).

---

## Current State

### Sent message tracking

| Area | Finding |
|------|---------|
| **`executeDeliveryAction` success** | Returns a `DeliveryResult` to the caller only. **No automatic persistence** of the built package or compose metadata to a long-lived “sent log” in the Electron app’s primary inbox DB. |
| **Extension Zustand (`useBeapMessagesStore`)** | Has **`folder: 'outbox'`** and helpers like “add outbox message from send result” — used by **popup/extension** flows (e.g. draft composer, bulk send). This is **in-memory / extension storage**, not the same as Electron `inbox_messages`. |
| **Electron inline composer / inbox reply** | On success, UI shows feedback and may clear fields; **no insert** into a dedicated sent table was found on this path. |

**Conclusion:** End-to-end **“business outbox”** in the desktop app (durable list of sent BEAP with audit fields) **does not exist yet**; extension-side patterns exist for **outbox folder** in the BEAP message store.

### Database tables

| Table / artifact | Role |
|------------------|------|
| **`outbound_capsule_queue`** (handshake DB migration v6+) | Queues **P2P/capsule** sends: `handshake_id`, `target_endpoint`, `capsule_json`, `status` (`pending` / `sent` / `failed`), retries, errors, timestamps. **Operational queue**, not a user-facing outbox list. Rows move to **`sent`** or **`failed`**; not designed as an append-only “sent messages” history with rich preview. |
| **`inbox_messages`** (email pipeline) | **Inbound** (and email-centric) messages for the mail UI. **Not** a natural home for qBEAP user sends without schema extension. |
| **No `sent_messages` / `outbox_messages` table** | Not found as a first-class ledger for “user pressed Send on BEAP.” |

### P2P queue after success

- **`processOutboundQueue`** updates `outbound_capsule_queue` to **`sent`** on successful relay delivery (see `outboundQueue.ts`).
- That **retains** capsule JSON only while the row exists; semantics are **queue**, not **mailbox**. Failed rows persist with error; successful sends are **not** a user-visible “Sent folder” in the current UI.

### UI showing “sent” messages

- **BEAP extension:** `BeapMessageListView` / `OutboxMessagePreview` / `folder === 'outbox'` — **extension** outbox UX exists for the **popup/sidepanel** model.
- **Electron dashboard:** `EmailInboxView` / `BeapInlineComposer` focus on **inbox + compose**; **no** dedicated “Sent” tab for BEAP was found in the same sense as a mail client Sent folder.

---

## Reuse: Inbox patterns

1. **`inbox_messages` + direction flag**  
   - **Pros:** Single list API.  
   - **Cons:** Schema is **email-ingestion**-shaped (`from_address`, IMAP fields, etc.). qBEAP sends may not map cleanly; mixing directions increases complexity and risk.

2. **Separate `outbox_messages` (or `sent_beap_messages`)**  
   - **Pros:** Clear separation; columns tailored to BEAP (handshake id, delivery method, package hash, preview text, status).  
   - **Cons:** New migrations, sync with existing BEAP inbox types if unified UI is desired.

3. **`outbound_capsule_queue` as “Sent”**  
   - **Pros:** Already stores outbound payloads for P2P.  
   - **Cons:** Lifecycle is **queue**, not **archive**; successful rows may be unsuitable as long-term UX; **email** and **download** paths do not use this table the same way.

**Recommendation:** **Option B** — new table (or dedicated view backed by inserts at send time), with optional **materialized link** to queue row id for P2P retry correlation.

---

## What `executeDeliveryAction` returns (capturable data)

From `BeapPackageBuilder.ts`, `DeliveryResult` includes:

- **`success`**, **`message`**, **`action`** (`sent` | `copied` | `downloaded` | `preflight`)
- **P2P:** `delivered`, `code`, `queued`, `coordinationRelayDelivery`, `recipientIngestConfirmed`, `p2pOutboundDebug`, etc.
- **Details:** e.g. email `to`, download `filename`, clipboard content

**Before** transport, **`buildPackage`** yields `PackageBuildResult` with optional **`package`** (`BeapPackage`) and **`packageJson`**.

**Insert point (recommended):** Immediately after **`executeDeliveryAction`** returns **`success: true`** in:

- `BeapInlineComposer` `handleSend`
- `EmailInboxView` `handleSendCapsuleReply`
- Any extension entry that calls `executeDeliveryAction`

Capture at minimum: **timestamp**, **handshake_id** (if private), **delivery_method**, **subject / preview** (from config), **attachment names**, **has encrypted body**, **optional package content hash** (from `BeapPackage.header`), **serialized `DeliveryResult` subset** (no secrets).

---

## P2P delivery status (relay / recipient)

- **Relay:** RPC / queue path exposes **`coordinationRelayDelivery`** (`pushed_live` vs `queued_recipient_offline`) and **`delivered`** / error codes from Electron.
- **Recipient ingest:** **`recipientIngestConfirmed`** when reported by coordination (optional).
- **UI states:** Can map to: **Pending** → **Relay accepted** → **Delivered** (or **Queued for recipient** / **Failed** / **Retrying**).

---

## Email delivery status

- Plain email send (`EmailInlineComposer` / gateway) returns **gateway success**; not the same as BEAP `executeDeliveryAction`.
- For **BEAP-over-email** (`executeEmailAction`), capture transport result from `DeliveryResult.details` / message strings; SMTP does not guarantee read receipts — label states honestly (**Sent via SMTP** vs **Provider accepted**).

---

## Recommended schema (sketch)

```sql
CREATE TABLE IF NOT EXISTS sent_beap_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  handshake_id TEXT,
  counterparty_preview TEXT,
  subject TEXT,
  public_preview TEXT,
  has_encrypted_inner INTEGER NOT NULL DEFAULT 0,
  delivery_method TEXT NOT NULL,
  package_content_hash TEXT,
  outbound_queue_row_id INTEGER,
  delivery_status TEXT NOT NULL,
  delivery_detail_json TEXT,
  attachment_summary_json TEXT
);
```

Indexes: `created_at DESC`, `handshake_id`, `delivery_status`.

---

## Insert point

- **After** `executeDeliveryAction` returns success in Electron (and optionally extension), **IPC** `handshake:insertSentBeap` or email DB helper to append row.
- **Do not** block UI on insert; fire-and-forget with error logging.

---

## UI design

- **Option A:** Tab **Inbox | Sent** in the left column of `EmailInboxView` (or BEAP-specific panel).
- **Option B:** Top-level nav tab **Outbox** next to Inbox / Handshakes.
- **Row columns:** Time, recipient label, subject/ preview, method badge (P2P / Email / Download), status pill, overflow **View** / **Retry** (failed P2P only if queue supports).

---

## Implementation phases

1. **DB migration + IPC** — create `sent_beap_outbox`, minimal columns; insert from `BeapInlineComposer` + inbox reply on success.
2. **Read API + simple list** — query newest N rows; render in a **Sent** strip or panel.
3. **Status enrichment** — map `DeliveryResult` + optional poll of `outbound_capsule_queue` for retry state.
4. **Retry / view package** — link failed sends to queue retry; read-only package viewer from stored `packageJson` hash or optional encrypted blob policy.

---

## Summary

| Question | Answer |
|----------|--------|
| Is sent BEAP stored automatically after send? | **No** (except queue rows for P2P transport, not user outbox). |
| Is there a sent table today? | **No** dedicated user outbox; **`outbound_capsule_queue`** is operational. |
| Extension outbox folder? | **Yes** — Zustand / `folder: 'outbox'` for extension BEAP UI; **different** from Electron durable store. |
| Next step | **New table + insert on success** + **Sent** UI surface in Electron. |
