# Handshake ACCEPTED → ACTIVE State Machine Trace

## 1. State Transition Logic

### All possible handshake states

**File:** `apps/electron-vite-project/electron/main/handshake/types.ts` (lines 72–80)

```typescript
export enum HandshakeState {
  DRAFT = 'DRAFT',
  PENDING_ACCEPT = 'PENDING_ACCEPT',
  PENDING_REVIEW = 'PENDING_REVIEW',  // Acceptor imported .beap file, reviewing before accept
  ACCEPTED = 'ACCEPTED',  // Accept capsule processed; roundtrip (context exchange) not yet complete
  ACTIVE = 'ACTIVE',      // Roundtrip complete: context/signatures exchanged
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}
```

### Exact condition for ACCEPTED → ACTIVE

**File:** `apps/electron-vite-project/electron/main/handshake/enforcement.ts` (lines 657–676)

```typescript
/** context-sync: updates seq/hash; ACCEPTED → ACTIVE when roundtrip completes.
 * Only transition to ACTIVE when BOTH: (1) received other's context_sync (seq>=1),
 * (2) own context_sync was sent (context_sync_pending=false).
 * If own is still pending (vault was locked), stay ACCEPTED until we send ours.
 */
function buildContextSyncRecord(
  existing: HandshakeRecord,
  input: VerifiedCapsuleInput,
): HandshakeRecord {
  const receivedContextSync = existing.state === HS.ACCEPTED && input.seq >= 1
  const ownSent = !existing.context_sync_pending
  const nextState = receivedContextSync && ownSent ? HS.ACTIVE : existing.state
  return {
    ...existing,
    state: nextState,
    last_seq_received: input.seq,
    last_capsule_hash_received: input.capsule_hash,
  }
}
```

**Condition:** `receivedContextSync && ownSent`
- `receivedContextSync`: state is ACCEPTED and incoming capsule has `seq >= 1` (context_sync)
- `ownSent`: `context_sync_pending === false` (we have sent our context_sync)

### Function that performs the transition

**Function:** `buildContextSyncRecord` in `enforcement.ts`  
**Invoked by:** `processHandshakeCapsule` → pipeline → `recipientPersist` step when capsule type is `handshake-context-sync`

**State transition check:** `apps/electron-vite-project/electron/main/handshake/steps/stateTransition.ts` (lines 46–65)

```typescript
// ACCEPTED (after accept, before context roundtrip) — same as ACTIVE with last_seq_received=0
if (currentState === HandshakeState.ACCEPTED) {
  const lastSeq = handshakeRecord!.last_seq_received
  if (lastSeq === 0) {
    if (capsuleType === 'handshake-context-sync') return { passed: true }
    if (capsuleType === 'handshake-revoke') return { passed: true }
    // ...
  }
  // ...
}
```

---

## 2. The "Last Roundtrip" — What Happens After Acceptor Clicks Accept

### After AcceptHandshakeModal calls accept

**Flow:**
1. `AcceptHandshakeModal` → `acceptHandshake(handshakeId, sharingMode, fromAccountId, contextOpts)` (IPC)
2. IPC handler: `apps/electron-vite-project/electron/main/handshake/ipc.ts` case `handshake.accept` (lines 560–895)
3. Builds accept capsule, calls `submitCapsuleViaRpc(capsule, db, session)` — processes locally
4. In `setImmediate` (lines 818–858):
   - `registerHandshakeWithRelay` — registers handshake with coordination server
   - **Enqueue accept capsule:** `if (targetEndpoint) { enqueueOutboundCapsule(db, handshake_id, targetEndpoint, capsule) }` — **only if `record.p2p_endpoint` is set**
   - `tryEnqueueContextSync` — acceptor sends their context_sync
   - `processOutboundQueue` — flushes outbound queue
   - `replayBufferedContextSync` — replays any early context_sync from initiator

### Message/event sent back to initiator

- **Accept capsule** is enqueued and sent via `processOutboundQueue`:
  - Coordination mode: `sendCapsuleViaCoordination` → POST to `coordination_url/beap/capsule`
  - Non-coordination: `sendCapsuleViaHttp` to `record.p2p_endpoint`
- **Context_sync capsule** (acceptor’s) is also enqueued and sent the same way

### When initiator receives the acceptance

**File:** `apps/electron-vite-project/electron/main/p2p/coordinationWs.ts` (lines 80–230)

- Coordination WebSocket receives capsule from relay
- `processCapsuleInternal` → `processIncomingInput` → handshake pipeline
- Capsule type `handshake-accept` → `processHandshakeCapsule` → state → ACCEPTED
- **After ACCEPTED** (lines 199–224): `tryEnqueueContextSync` — initiator sends their context_sync

```typescript
if (newState === 'ACCEPTED') {
  const lastHash = (rebuildResult.capsule as unknown as Record<string, unknown>)?.capsule_hash as string ?? ''
  const contextResult = tryEnqueueContextSync(db, record.handshake_id, ssoSession, {
    lastCapsuleHash: lastHash,
    lastSeqReceived: 0,
  })
  if (contextResult.success) {
    setImmediate(() => { processOutboundQueue(db, getOidcToken).catch(() => {}) })
  } else if (contextResult.reason === 'VAULT_LOCKED') {
    console.log('[Coordination] Context sync deferred for initiator — vault locked')
  } else {
    console.warn('[Coordination] Initial context_sync skipped, reason=', contextResult.reason)
  }
  // Replay buffered context_sync...
}
```

### Does initiator need to send confirmation back?

Yes. Both sides must send a **context_sync** capsule (seq=1). There is no separate “finalize” step; ACTIVE is reached when each side:

1. Has sent its own context_sync (`context_sync_pending = false`)
2. Has received the other’s context_sync (`last_seq_received >= 1`)

---

## 3. Signature and Context Exchange in the Final Step

### Where signatures are exchanged

- **Accept capsule:** Signed by acceptor; initiator verifies when receiving
- **Context_sync capsule:** Signed by sender; receiver verifies via `verifyCapsuleSignature` in the pipeline
- Signing keys: `local_public_key`, `local_private_key` on each side; `counterparty_public_key` from the other side

### Context graph merge/sync

**File:** `apps/electron-vite-project/electron/main/handshake/contextIngestion.ts`  
- Incoming context_sync blocks are ingested into `context_store`  
- No explicit “merge” step; each side stores the other’s blocks as received

### Could context attachment failure prevent ACTIVE?

Yes. `tryEnqueueContextSync` can fail and leave the handshake stuck in ACCEPTED:

| Reason | File | Line |
|--------|------|------|
| `VAULT_LOCKED` | contextSyncEnqueue.ts | 57–62 |
| `NO_P2P_ENDPOINT` | contextSyncEnqueue.ts | 83–86 |
| `NO_SIGNING_KEYS` | contextSyncEnqueue.ts | 89–93 |
| `INVALID_STATE` | contextSyncEnqueue.ts | 74–77 |
| `HANDSHAKE_NOT_FOUND` | contextSyncEnqueue.ts | 69–72 |
| `ENQUEUE_FAILED` (catch) | contextSyncEnqueue.ts | 159–161 |

If context_sync is never sent, `context_sync_pending` stays true (or is never cleared), and `ownSent` is false, so ACTIVE is never reached.

---

## 4. Error Handling and Silent Failures

### Try/catch around finalization

**coordinationWs.ts** (lines 111–139):

```typescript
try {
  const result = await processIncomingInput(rawInput, 'coordination_ws', {...})
  // ...
  if (!result.success) {
    console.warn('[Coordination] Capsule rejected:', result.reason)
    // ... quarantine ...
    sendAckFn([id])
    return
  }
  // ...
} catch (err: any) {
  console.error('[Coordination] Capsule processing failed:', err?.message ?? err, err)
  console.error('[Coordination] NOT acknowledging — capsule will be retried')
  // Do NOT sendAckFn — let relay retry
}
```

- Errors are logged; capsule is not ACKed so the relay can retry
- No explicit “handshake activated” log when transitioning to ACTIVE

### Log lines for ACTIVE transition

**enforcement.ts:** No dedicated log when `buildContextSyncRecord` sets `nextState = ACTIVE`.

**contextSyncEnqueue.ts** (completePendingContextSyncs, lines 186–190):

```typescript
if (record && record.last_seq_received >= 1) {
  db.prepare("UPDATE handshakes SET state = 'ACTIVE' WHERE handshake_id = ?").run(row.handshake_id)
  console.log(`[Vault] Handshake ACTIVE (roundtrip complete):`, row.handshake_id)
}
```

This path runs only when completing deferred context_sync after vault unlock, not for the normal coordination path.

**coordinationWs.ts** (line 188):

```typescript
console.log('[Coordination] processHandshakeCapsule result: success, newState=', newState, 'capsuleType=', capsuleType, 'seq=', ...)
```

So a successful transition to ACTIVE would show `newState=ACTIVE` in this log.

### Timeout or retry for final exchange

**Outbound queue:** `apps/electron-vite-project/electron/main/handshake/outboundQueue.ts`
- Retries: `max_retries = 10`, exponential backoff (5s initial, up to 5 min)
- `processOutboundQueue` is called on P2P startup and after accept/context_sync enqueue

**Stuck ACCEPTED retry:** `apps/electron-vite-project/electron/main.ts` (lines 7853–7870)

```typescript
const stuckRows = handshakeDb.prepare(
  `SELECT handshake_id, last_capsule_hash_received, last_seq_received
   FROM handshakes
   WHERE state = 'ACCEPTED'
     AND context_sync_pending = 0
     AND last_seq_received = 0
     AND created_at < datetime('now', '-5 seconds')`
).all()
for (const row of stuckRows) {
  console.log('[P2P] Re-triggering context_sync for stuck ACCEPTED handshake:', row.handshake_id)
  const result = tryEnqueueContextSync(...)
  // ...
}
```

- Runs on P2P startup (`tryP2PStartup`)
- Only for rows with `context_sync_pending = 0` and `last_seq_received = 0` (we sent, they haven’t)
- Does not cover the case where we never sent (`context_sync_pending = 1`)

---

## 5. Critical Path Summary

```
ACCEPTOR clicks Accept
  → submitCapsuleViaRpc (local ACCEPTED)
  → setImmediate:
      → registerHandshakeWithRelay
      → if (record.p2p_endpoint) enqueueOutboundCapsule(accept)  ← BUG: skip if p2p_endpoint empty
      → tryEnqueueContextSync (acceptor's context_sync)
      → processOutboundQueue
      → replayBufferedContextSync

INITIATOR receives accept (via coordination WebSocket)
  → processCapsuleInternal → processHandshakeCapsule
  → state → ACCEPTED
  → tryEnqueueContextSync (initiator's context_sync)
  → processOutboundQueue

BOTH receive other's context_sync (seq=1)
  → buildContextSyncRecord
  → receivedContextSync && ownSent → ACTIVE
```

### Likely failure points for stuck ACCEPTED

1. **Accept capsule not enqueued:** In `ipc.ts` line 833, `targetEndpoint = record.p2p_endpoint?.trim()`. If `record.p2p_endpoint` is empty, the `if (targetEndpoint)` guard (line 834) fails and the accept capsule is **never enqueued**. The initiator would not receive the accept via coordination. (If both show ACCEPTED, initiator may have received via email or a different path.) For coordination mode, a fallback to `getEffectiveRelayEndpoint` (as in `contextSyncEnqueue`) would ensure the accept is always enqueued.
2. **Context_sync not sent:** `tryEnqueueContextSync` fails (VAULT_LOCKED, NO_P2P_ENDPOINT, NO_SIGNING_KEYS, etc.) → `context_sync_pending` stays true → `ownSent` false → no ACTIVE.
3. **Context_sync not delivered:** Relay/coordination delivery failure → other side never receives seq=1 → `last_seq_received` stays 0.
4. **Context_sync rejected:** Signature/ownership/chain validation failure → capsule rejected, not processed.
