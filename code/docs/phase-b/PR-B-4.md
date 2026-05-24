# PR B-4 — P2P Relay Migration + Sandbox-Side Quarantine Receive

**Phase B, PR 4/11**  
**Status:** Shipped  
**Prerequisites:** B-1, B-2, B-3, B-3.1

---

## Summary

Closes the last ingestion-path bypass identified in B-3.1: P2P-arrived BEAP
messages were written to `p2p_pending_beap` (SQLite staging) and later drained
by `processPendingP2PBeapEmails` without ever passing through the validator
subprocess or sealed-storage gate. Any message arriving via P2P could persist
to `inbox_messages` unsealed.

This PR eliminates the staging table entirely, wires all P2P entry points to
`processBeapPackageInline` (validate-before-write), implements the sandbox-side
quarantine receive branch, and drops `p2p_pending_beap` in schema migration v66.

---

## Decisions (load-bearing inputs from canon owner)

| ID | Decision |
|----|----------|
| A | P2P relay reuses `messageRouter`'s pattern: `bytes → parse → depackage → validate → seal → write`. No SQLite-backed buffer. |
| B | P2P arrivals go through the same quarantine flow as email arrivals (encrypted blob, sealed `quarantine_messages` row, host UI). |
| C | Sandbox-side decrypt uses the sandbox's own `local_x25519_private_key_b64` via `decryptQuarantineBlob`. |
| D | All `p2p_pending_beap` consumers were investigated; all migratable; table dropped in v66. |
| E | `retryPendingQbeapDecrypt` migrated to sealed updates via `prepareSealedUpdate`. |

---

## Step A — Consumer Classification

`rg "p2p_pending_beap" -n --type ts` results before migration:

| File | Consumer | Classification | Action |
|------|----------|----------------|--------|
| `p2p/coordinationWs.ts:294` | `insertPendingP2PBeap` on WS push | P2P relay | ✅ Migrated to `processBeapPackageInline` |
| `p2p/p2pServer.ts:288` | `insertPendingP2PBeap` on HTTP POST | P2P relay | ✅ Migrated to `processBeapPackageInline` |
| `p2p/relayPull.ts:163` | `insertPendingP2PBeap` on relay pull | P2P relay | ✅ Migrated to `processBeapPackageInline` |
| `email/beapSync.ts:238` | `insertPendingP2PBeap` for body detection | Email-body package | ✅ Migrated to `processBeapPackageInline` |
| `email/beapSync.ts:312` | `insertPendingP2PBeap` for attachment detection | Email-attachment package | ✅ Migrated to `processBeapPackageInline` |
| `main.ts:3664` | `insertPendingP2PBeap` in `handshake:importBeapMessage` IPC | Manual file import | ✅ Migrated to `processBeapPackageInline` (approved by canon owner) |
| `handshake/counterpartyRepair.ts` | reads via `getP2pPendingPackageJsonsForHandshake` | Dev diagnostic tool | ✅ Migrated to query `inbox_messages.beap_package_json` (approved) |
| `email/remoteDeletion.ts:72` | DELETE row on inbox delete | Cleanup | ✅ Wrapped in try/catch (no-op on v66+) |

No non-P2P, non-email consumers were found that could not be migrated. No stop-and-report condition triggered on Decision D.

---

## Deliverable 1 — `processBeapPackageInline` (beapEmailIngestion.ts)

New public entry point for all P2P BEAP package ingestion.

### Flow

```
processBeapPackageInline(db, packageJson, handshakeId, options)
  └─ processBeapPackageInlineInternal(...)
       ├─ detect sandbox_clone_quarantine → processSandboxQuarantineReceive
       ├─ detect outbound qBEAP echo → buildOutboundQbeapDepackagedJson
       ├─ attempt qBEAP decrypt → decryptQBeapPackage
       ├─ fallback pBEAP depackage → beapPackageToMainProcessDepackaged
       ├─ validatorOrchestrator.validate(...)
       │    outcome ok → writeP2PInboxRow → prepareSealedInsert
       │    outcome quarantine → encryptForQuarantine → writeQuarantineBlob → writeP2PQuarantineRow → prepareSealedInsert
       └─ returns P2PInlineResult { outcome: 'inbox'|'quarantine'|'error', rowId, error }
```

### Sealed SQL constants

```typescript
const P2P_INBOX_INSERT_SQL = `INSERT INTO inbox_messages (...) VALUES (...)` // sealed insert
const P2P_QUARANTINE_INSERT_SQL = `INSERT INTO quarantine_messages (...) VALUES (...)` // sealed insert
const P2P_INBOX_SEALED_BACKFILL_UPDATE_SQL = `UPDATE inbox_messages SET ... WHERE id = ?` // sealed update
```

### `processSandboxQuarantineReceive` (sandbox-side decrypt)

When the host clones a quarantined blob to the sandbox via the existing
clone-messages mechanism, the sandbox's receive pipeline calls this function:

1. Detects `sandbox_clone_quarantine: true` in outer package metadata
2. Decrypts `encryptedMessage` (base64 `QuarantineBlobFile` JSON) via
   `decryptQuarantineBlob` with sandbox's `local_x25519_private_key_b64`
3. Parses original BEAP bytes from blob
4. Calls `processBeapPackageInlineInternal` with `isSandboxDecryptedBlob: true`
   to prevent re-entry into the clone detection branch

If decryption fails, writes a sandbox-side quarantine row with
`rejection_reason: 'blob_decrypt_failed'` and sentinel blob fields
(`blob_storage_id: '__sandbox_final_state__'`, `blob_sha256: 'sandbox_final_state_no_blob'`).

### Sentinel constants

```typescript
const SANDBOX_FINAL_STATE_BLOB_ID = '__sandbox_final_state__'
const SANDBOX_FINAL_STATE_BLOB_SHA = 'sandbox_final_state_no_blob'
const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'
```

---

## Deliverable 2 — `retryPendingQbeapDecrypt` migration (beapEmailIngestion.ts)

Updated to use `prepareSealedUpdate` with validator subprocess call:

1. Queries `inbox_messages` with `seal IS NULL` and
   `depackaged_metadata LIKE '%beap_qbeap_pending_main%'`
2. For each row: calls `decryptQBeapPackage` (or `buildOutboundQbeapDepackagedJson` for echoes)
3. Calls `validatorOrchestrator.validate(...)` on the decrypted capsule JSON
4. On success: runs `prepareSealedUpdate` → sealed `inbox_messages` row
5. On validator reject: skips row (leaves `seal IS NULL` — read-path filters it)

The `beap_qbeap_pending_main` format for new rows is eliminated. New P2P
arrivals with qBEAP packages go directly to quarantine if decryption is
unavailable.

---

## Deliverable 3 — Schema migration v66

```sql
-- schema v66 (Phase B, PR B-4)
DROP TABLE IF EXISTS p2p_pending_beap;
```

Added to `HANDSHAKE_MIGRATIONS` array in `handshake/db.ts`. `migrateHandshakeTables`
runs this on every app start after upgrade.

`insertPendingP2PBeap` and related functions (`getPendingP2PBeapMessages`,
`markP2PPendingBeapProcessed`, `deletePendingP2PBeap`) are marked `@deprecated`
and silently no-op on v66+ databases.

---

## Files Changed

| File | Change |
|------|--------|
| `electron/main/email/beapEmailIngestion.ts` | New: `processBeapPackageInline`, `processSandboxQuarantineReceive`, `processBeapPackageInlineInternal`, `buildP2PProvenance`, `writeP2PInboxRow`, `writeP2PQuarantineRow`; updated `retryPendingQbeapDecrypt`; deprecated `processPendingP2PBeapEmails` (no-op stub); removed `resolveP2PPendingPackageColumnExpr` |
| `electron/main/email/messageRouter.ts` | `export`ed `findPairedSandboxHandshake`; updated module comment |
| `electron/main/p2p/coordinationWs.ts` | Replaced `insertPendingP2PBeap` with `processBeapPackageInline` (fire-and-forget async) |
| `electron/main/p2p/p2pServer.ts` | Replaced `insertPendingP2PBeap` with `processBeapPackageInline` (fire-and-forget async) |
| `electron/main/p2p/relayPull.ts` | Replaced `insertPendingP2PBeap` with `await processBeapPackageInline` |
| `electron/main/email/beapSync.ts` | Replaced Strategy 1b `insertPendingP2PBeap` calls with `await processBeapPackageInline`; updated module comment |
| `electron/main.ts` | Migrated `handshake:importBeapMessage` IPC from `insertPendingP2PBeap` to `processBeapPackageInline` |
| `electron/main/handshake/db.ts` | `getP2pPendingPackageJsonsForHandshake` now queries `inbox_messages.beap_package_json`; added schema v66; deprecated P2P pending functions; removed `p2p_pending_beap` column repair entries |
| `electron/main/email/remoteDeletion.ts` | Wrapped `DELETE FROM p2p_pending_beap` in try/catch (no-op on v66+) |
| `electron/main/email/__tests__/b4P2PRelayMigration.test.ts` | **New** — B-4 test suite |

---

## What this PR does NOT deliver

- BEAP attachment hash binding (deferred to B-5).
- Host-side `quarantine:cloneToSandbox` IPC handler (deferred to separate PR per canon owner decision).
- Extension Stage-5 merge migration (B-5).
- IPC content updates, extension store writes (B-7, B-8).

---

## Stop-and-Report conditions encountered

None. All pre-implementation questions (two stop-and-reports from the
assessment phase) were resolved with explicit canon-owner answers before
implementation began:

1. `main.ts` file-import IPC consumer → approved for B-4 (same inline processor).
2. `counterpartyRepair.ts` dev script → approved to query `inbox_messages` instead.
3. Host-side quarantine clone IPC → excluded from B-4 scope (separate PR).

---

## Verification Log

### rg audit (post-implementation)

```
rg "INSERT INTO p2p_pending_beap" --type ts
→ 0 production hits (only inside deprecated insertPendingP2PBeap function body in handshake/db.ts)

rg "INSERT INTO inbox_messages|UPDATE inbox_messages SET" electron/main/email/ --type ts
→ All call sites use prepareSealedInsert / prepareSealedUpdate or are inside
  the now-deprecated processPendingP2PBeapEmails stub (returns 0 immediately)

rg "validatorOrchestrator.validate" electron/main/email/ --type ts
→ Called in: processBeapPackageInlineInternal, retryPendingQbeapDecrypt,
  detectAndRouteMessage (messageRouter.ts) — all P2P and email paths

rg "p2p_pending_beap" --type ts (production code only)
→ Only in: handshake/db.ts (migration DDL, deprecated functions, fallback
  legacy path in getP2pPendingPackageJsonsForHandshake), remoteDeletion.ts
  (try/catch no-op), test files
```

### What was NOT verified

- **sandbox-side branch against a real paired host**: tested with synthetic
  mocks; the `processSandboxQuarantineReceive` function exercises the decrypt
  path against a mocked `decryptQuarantineBlob`. Live end-to-end requires a
  real paired sandbox instance.
- **host-side quarantine clone IPC**: not implemented in B-4. The
  `sandbox_clone_quarantine: true` metadata flag is produced by B-3's
  `BeapPackageBuilder` but the host IPC handler that triggers the clone is a
  separate PR.
- **In-memory queue overflow semantics**: P2P arrivals are processed inline
  (no queue introduced). If the validator subprocess is unavailable, the call
  to `validatorOrchestrator.validate` throws; the P2P arrival is not persisted.
  This is the intended "subprocess unavailable = system unavailable" property
  per the Phase B architecture canon.
- **`retryPendingQbeapDecrypt` sealed update on live production data**: the
  `prepareSealedUpdate` call uses the seal API and was tested with mocked
  validator responses; running against a production DB with pre-B-4 unsealed
  rows requires the vault to be unlocked.
