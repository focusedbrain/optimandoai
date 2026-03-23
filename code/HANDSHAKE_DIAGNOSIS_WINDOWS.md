# Handshake Status & Processing — Windows Diagnosis Report

**Date:** 2026-03-08  
**Log source:** `%USERPROFILE%\.opengiraffe\electron-console.log`

---

## 1. Capsule receive + processing chain

| Step | Status | Evidence |
|------|--------|----------|
| Capsule received | ✅ | `[Coordination] Capsule received: fe7b3b42...` (16:02:01), `a21e474b...` (16:18:59) |
| Processing capsule | ❌ | No `[Coordination] Processing capsule:` in log |
| DB check | ❌ | No `[Coordination] DB check:` in log |
| State updated | ❌ | No `processHandshakeCapsule result: success` |
| ACK sent | ❌ | No `[Coordination] ACK sent for:` |

**Conclusion:** Capsules are received by the coordination WebSocket, but the processing pipeline does not log any subsequent steps. Either the Windows build is older (no `Processing capsule` / `DB check` logs) or the pipeline fails before the first log.

---

## 2. Context sync status

| Check | Status | Evidence |
|-------|--------|----------|
| Context sync triggered | ⚠️ | One `context_sync` sent at 12:16:13 for `hs-276ef0e9` (different handshake) |
| After ACCEPTED | ❌ | No `Initial context_sync enqueued` or `Reverse context_sync enqueued` for recent handshakes |
| Vault locked | N/A | Session logs show UNLOCKED; no `VAULT_LOCKED` or `context_sync_pending` in log |

**Conclusion:** Context sync is not being triggered for the capsules received via WebSocket. The Windows build may be missing migrations 16/17 and the `tryEnqueueContextSync` flow.

---

## 3. Database used

| Operation | DB used | Evidence |
|-----------|---------|----------|
| Coordination receive | `getLedgerDb()` | `main.ts` line 7059: `() => getLedgerDb()` |
| Submit capsule | Ledger | `[SUBMIT-CAPSULE] getLedgerDb(): ok` |
| Handshake DB | Ledger or vault fallback | `getHandshakeDb = getLedgerDb() ?? vaultService.getDb?.() ?? null` |

**Issue:** Coordination client uses `getLedgerDb()` only. If ledger is not ready when a capsule arrives (e.g. vault fallback), `db` can be null and processing fails silently.

---

## 4. Errors in processing chain

| Error | Count | Notes |
|-------|-------|-------|
| `capsule_type_not_allowed` (initiate via relay) | Many | Expected — initiate must be out-of-band; relay accepts accept, context_sync, refresh, revoke |
| `Capsule processing failed` | 0 | None in log |
| `DB check: FAILED` | 0 | None in log (older build may not have this) |
| `Custom handler failed` | 0 | None in log |

---

## 5. Migrations

| Migration | Applied | Evidence |
|-----------|---------|----------|
| v15 (ACCEPTED state) | ✅ | `[HANDSHAKE DB] Applied migration 15: Schema v15: ACCEPTED state` |
| v16 (PENDING_REVIEW) | ❌ | Not in log |
| v17 (context_sync_pending) | ❌ | Not in log |

**Conclusion:** Windows build has migrations 1–15 only. No migrations 16 or 17. The `context_sync_pending` column and vault-deferred logic are absent.

---

## 6. Handshake lifecycle (hs-4c66603c)

| Time | Event |
|------|-------|
| 18:44:10 | Register handshake OK |
| 18:44:11 | Sending accept capsule to relay |
| 19:10:52 | FORCE_REVOKE — record found: state=ACCEPTED |

**Conclusion:** Handshake stayed at ACCEPTED, never reached ACTIVE. Windows never received context_sync from Mac (initiator).

---

## 7. WebSocket / relay

| Check | Status |
|-------|--------|
| Connected | ✅ `[Coordination] Connected to relay WebSocket — ready to receive capsules` |
| Auth | ✅ No 401/502/Forbidden |
| Capsule delivery | ✅ `Capsule received` for fe7b3b42, a21e474b |

---

## 8. Root causes

1. **Build too old:** Migrations 16 and 17 are not applied. No `context_sync_pending` or vault-deferred logic.
2. **DB fallback:** Coordination uses `getLedgerDb()` only. If ledger is not ready when a capsule arrives (e.g. vault fallback), `db` can be null and processing fails silently.

---

## 9. Fixes applied

### Fix 1: Use `getHandshakeDb()` for coordination

**File:** `electron/main.ts`

```diff
- () => getLedgerDb(), // Ledger only — receive works without vault
+ () => getHandshakeDb(), // Handshake DB (ledger or vault fallback) — receive works when either is ready
```

**Reason:** Handshake DB can come from ledger or vault. Coordination client must use the same DB as `tryP2PStartup`, so it works when ledger is not yet open.

### Fix 2: Error message update

**File:** `electron/main/p2p/coordinationWs.ts`

```diff
- console.error('[Coordination] DB check: FAILED — getLedgerDb() returned null')
+ console.error('[Coordination] DB check: FAILED — getHandshakeDb() returned null')
```

---

## 10. Next steps

1. **Deploy build58** (or latest) to Windows so migrations 16 and 17 run.
2. **Verify logs** after deployment: look for `[Coordination] Processing capsule:`, `DB check: OK`, `processHandshakeCapsule result: success`, `Initial context_sync enqueued`.
3. **Test end-to-end:**  
   - Mac: initiate → send accept via relay  
   - Windows: receive accept → send context_sync  
   - Mac: receive context_sync → send reverse context_sync  
   - Both: transition to ACTIVE
