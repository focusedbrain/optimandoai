# BEAP Roundtrip Diagnostic — Windows System (info@optimando.ai, Acceptor)

## Executive Summary

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Capsule fe7b3b42 received but never processed | Pre-fix: no `.catch()` on `processIncomingInput().then()`, possible db null | Added db null check, `.catch()`, step-by-step logging |
| "Capsule rejected" in UI (Submit for verification) | Generic error hid actual ReasonCode | Now returns `handshake_result.reason`; `mapPipelineError` maps HANDSHAKE_NOT_FOUND, HANDSHAKE_OWNERSHIP_VIOLATION |
| Unknown handshake record state | No visibility into local DB | Added `[Coordination] Local handshake records:` diagnostic log |

---

## 1. What Happened to Capsule fe7b3b42?

### Code Path (coordinationWs.ts)

**After** `console.log('[Coordination] Capsule received:', id)`:

1. **Line 298–302** (new): Logs capsule payload (`type`, `id`, `capsule_type`, `handshake_id`)
2. **Line 303–307**: If `capsuleHandler` set → calls it; else → `processCapsuleInternal(msg.id, msg.capsule ?? msg, db, ssoSession, sendAck, onHandshakeUpdated)`
3. **processCapsuleInternal** (lines 52–210):
   - Checks `db` null → early return + ACK
   - **New**: Logs `[Coordination] Local handshake records:` (all handshake_id, state, local_role)
   - Calls `processIncomingInput(...).then(...).catch(...)`
   - `.then()`: validation → distribution gate → canonicalRebuild → processHandshakeCapsule
   - `.catch()`: logs error, sends ACK

### Why It Wasn't Processed (Before Fix)

1. **No `.catch()`**: If `processIncomingInput` rejected or `.then()` threw, the promise was unhandled and ACK was never sent.
2. **DB null**: `getHandshakeDb()` could return null before ledger was ready; `processHandshakeCapsule(db, ...)` would throw when `db` was null.
3. **Silent failure**: Errors were swallowed without logging.

### Fixes Applied

- `processCapsuleInternal`: db null check at start
- `.catch()` on `processIncomingInput().then()` chain
- Step-by-step `[Coordination]` logging
- `[Coordination] Capsule payload:` log after receive
- `[Coordination] Local handshake records:` diagnostic log

---

## 2. What Does "Capsule rejected" Mean in the UI?

### Source

- **Component**: `CapsuleUploadZone.tsx` (Import Capsule drop zone)
- **Trigger**: `handleSubmit` → `window.handshakeView?.submitCapsule(preview.rawJson)`
- **IPC**: `handshake:submitCapsule` → `handleIngestionRPC('ingestion.ingest', ...)`

### Flow

1. **main.ts** (2029): `ipcMain.handle('handshake:submitCapsule', ...)` → `handleIngestionRPC(...)`
2. **ingestion/ipc.ts** `handleIngestionRPC`:
   - `processIncomingInput` → `canonicalRebuild` → `processHandshakeCapsule`
   - Returns `{ success: false, error: 'Capsule rejected', reason, handshake_result }` on failure

### Where "Capsule rejected" Comes From

| Stage | Return |
|-------|--------|
| Validator | `{ success: false, reason: 'Capsule rejected', error: result.reason }` |
| Canonical rebuild | `{ success: false, error: 'Capsule rejected' }` |
| processHandshakeCapsule | `{ success: false, error: 'Capsule rejected', reason, handshake_result }` |

### Fixes Applied

- `handleIngestionRPC` now returns `reason` and `handshake_result` on handshake failure
- `CapsuleUploadZone` uses `res?.handshake_result?.reason ?? res?.reason ?? res?.error` for `mapPipelineError`
- `mapPipelineError` maps:
  - `HANDSHAKE_NOT_FOUND` → "No matching handshake found. Import the initiate capsule first, then accept."
  - `HANDSHAKE_OWNERSHIP_VIOLATION` → "Cannot process a capsule you sent yourself."

---

## 3. "Submit for verification" Flow

### Trace

1. **Button**: `CapsuleUploadZone.tsx` line 233 — "Submit for verification"
2. **Handler**: `handleSubmit` → `window.handshakeView?.submitCapsule(preview.rawJson)`
3. **Preload**: `ipcRenderer.invoke('handshake:submitCapsule', jsonString)`
4. **Main**: `ipcMain.handle('handshake:submitCapsule', ...)` → `handleIngestionRPC('ingestion.ingest', { rawInput, sourceType, transportMeta }, db, ssoSession)`
5. **handleIngestionRPC` → `processIncomingInput` → Validator → Distribution Gate → `canonicalRebuild` → `processHandshakeCapsule`

### What It Does

- **Submit for verification** = run the capsule through the full ingestion pipeline (validation, canonical rebuild, handshake processing).
- **Local only**: no relay or network; uses the same pipeline as WebSocket and file import.

### Common Failure Reasons

- **HANDSHAKE_NOT_FOUND**: Accept/refresh/context_sync capsule for a handshake that does not exist locally.
- **HANDSHAKE_OWNERSHIP_VIOLATION**: Submitting a capsule you sent (e.g. accept capsule).
- **Denied field**: `canonicalRebuild` rejects denied fields.
- **Hash/signature**: Invalid or tampered capsule.

---

## 4. Local DB and Handshake Record

### Table

- **Table**: `handshakes` (not `handshake_records`)
- **Schema**: `handshake_id`, `state`, `local_role`, `initiator_json`, `acceptor_json`, etc.

### Diagnostic

- **New log**: `[Coordination] Local handshake records:` — JSON array of `{ id, state, role }` for all handshakes.
- **When**: At start of `processCapsuleInternal`, before processing.
- **Use**: If the capsule’s `handshake_id` is missing, the pipeline returns `HANDSHAKE_NOT_FOUND`.

### Acceptor vs Initiator

- **Acceptor (Windows)**: Imports initiate .beap → creates record with `local_role: 'acceptor'`.
- **Incoming capsule**: Must match an existing `handshake_id` in `handshakes`.
- **WebSocket capsule fe7b3b42**: Likely initiator’s initiate capsule. Acceptor should already have a record if they imported and accepted.

---

## 5. Accept Capsule and Outbound Queue

### Flow

1. Acceptor accepts → `handshake.accept` → `registerHandshakeWithRelay` → `enqueueOutboundCapsule(accept capsule)`.
2. `processOutboundQueue` → `sendCapsuleViaCoordination` → POST to relay.
3. Relay stores → pushes to initiator when connected.

### Log Check

```powershell
Select-String -Path "$env:USERPROFILE\.opengiraffe\electron-console.log" -Pattern "enqueue|outbound|queue" | Select-Object -Last 30
```

---

## 6. Files Changed

| File | Changes |
|------|---------|
| `coordinationWs.ts` | Capsule payload log, local handshake records diagnostic |
| `ingestion/ipc.ts` | Return `reason` and `handshake_result` on handshake failure; validator failure returns `error` |
| `CapsuleUploadZone.tsx` | Use `handshake_result.reason` first; add ReasonCode mappings in `mapPipelineError` |

---

## 7. Verify After Fix

1. Restart app with build52.
2. Import initiate .beap → accept.
3. When a capsule arrives via WebSocket, look for:
   ```
   [Coordination] Capsule received: <id>
   [Coordination] Capsule payload: {"type":"capsule","id":"...","capsule_type":"...","handshake_id":"..."}
   [Coordination] Local handshake records: [{"id":"hs-...","state":"...","role":"..."}]
   [Coordination] Processing capsule: <id> handshake=hs-... type=...
   [Coordination] Capsule validated OK
   [Coordination] Handshake state updated to: ACCEPTED
   ```
4. If "Submit for verification" fails, the UI should show the mapped ReasonCode message instead of generic "Capsule rejected".
