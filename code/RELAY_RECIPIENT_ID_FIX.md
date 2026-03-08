# Relay Capsule Delivery Fix — Recipient ID Mismatch (Email vs UUID)

## Root Cause

| Context | Field | Value | Issue |
|---------|-------|-------|-------|
| **Initiator registration** | `acceptor_user_id` | email (e.g. `id@wrdesk.com`) | At initiate time, caller passes only `receiverEmail`; `main.ts` uses `receiverUserId: receiverEmail` |
| **Acceptor registration** | `acceptor_user_id` | UUID | Acceptor sends `session.wrdesk_user_id` ✓ |
| **Pending capsule** | `recipient_user_id` | email (from registry) | `getRecipientForSender` returns registry value |
| **WebSocket client** | `userId` | UUID (from JWT `sub`) | `clients` Map keyed by UUID |
| **Push logic** | `clients.get(recipientUserId)` | `client` | Fails when recipient=email |

**Flow:** Initiator registers first with `acceptor_user_id=email`. Initiator's initiate capsule is enqueued and POSTed. Relay stores `recipient_user_id=email`. Acceptor connects with UUID. `pushCapsule(email, ...)` → `clients.get(email)` → `undefined` → no delivery.

**Client-side source:** `electron/main.ts` lines 2209, 2229:

```typescript
receiverUserId: receiverEmail,  // BUG: email used as UUID
```

The `handshake:initiate` and `handshake:buildForDownload` IPC handlers receive only `receiverEmail` from the UI; they pass it as `receiverUserId` because the acceptor's UUID is unknown at initiate time.

---

## Fix Implemented: Dual-Key Matching (Option D)

The relay now matches recipients by **UUID or email**.

### 1. `packages/coordination-service/src/store.ts`

**`getPendingCapsules(userId, email?)`**
- When `email` is provided, also matches `recipient_user_id = email`.
- Ensures capsules stored with recipient=email are delivered when the client connects with UUID.

**`acknowledgeCapsules(ids, userId, email?)`**
- When `email` is provided, allows ACK for capsules where `recipient_user_id` is either `userId` or `email`.

### 2. `packages/coordination-service/src/wsManager.ts`

**`resolveClient(recipientUserId)`**
- New helper: `clients.get(recipientUserId)` first (UUID match).
- If not found and `recipientUserId` contains `@`, iterate clients and match by `client.email`.

**`pushCapsule`**
- Uses `resolveClient(recipientUserId)` instead of `clients.get(recipientUserId)`.

**`pushPendingCapsules`**
- Passes `client.email` to `getPendingCapsules(userId, client.email)`.

**`handleAck`**
- Passes `client?.email` to `acknowledgeCapsules(ids, userId, client?.email)`.

---

## Migration / Data Cleanup

After deploying the fix, optionally clear stale pending capsules:

```sql
-- Clear stale pending capsules (never delivered, likely for old handshakes)
DELETE FROM coordination_capsules WHERE pushed_at IS NULL;

-- Optionally clear old registry entries (keep only active handshakes)
-- DELETE FROM coordination_handshake_registry WHERE handshake_id NOT IN ('hs-94decc2c-2704-43d0-bc4b-8725f12e1537');
```

Run only **after** the fix is deployed so new capsules are stored and delivered correctly.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| **Acceptor not logged in yet** | Initiator registers with acceptor_user_id=email. Capsule stored with recipient=email. When acceptor logs in and connects, `resolveClient(email)` finds them by `client.email`. ✓ |
| **Self-handshake** | `initiator_user_id` = `acceptor_user_id` (same user). Registry lookup works; push uses same client. ✓ |
| **Acceptor registers first** | Acceptor's registration sets acceptor_user_id=UUID. Initiator's registration later overwrites with email (ON CONFLICT DO UPDATE). So initiator's capsule could still get recipient=email from the overwrite. The dual-key fix handles both. ✓ |
| **Email case sensitivity** | JWT `email` and registry may differ in case. Current matching uses `===`. If needed, add `.toLowerCase()` for email comparison. |

---

## Test Plan

1. **Unit:** Add `getPendingCapsules` and `acknowledgeCapsules` tests for email fallback.
2. **Integration:**
   - Initiate handshake from user A to user B (email).
   - Verify acceptor_user_id=email in registry.
   - User B accepts and connects.
   - Verify initiate capsule is pushed via `resolveClient(email)`.
   - Verify `pushPendingCapsules` delivers capsules with recipient=email.
3. **End-to-end:** Initiate → Accept → verify capsule delivery in UI.

---

## Optional: Client-Side UUID When Available

If the UI can provide the acceptor's UUID (e.g. from a previous relationship), use it:

```typescript
// In main.ts handshake:initiate handler
receiverUserId: receiverUserId ?? receiverEmail,  // Use UUID when provided
receiverEmail,
```

This would require the caller to pass `receiverUserId` when known. The relay fix handles both cases regardless.
