# Handshake Acceptance — Full Flow Test Guide

**After the `resolveHsProfilesForHandshake` fix** (rpc.ts: added to `__og_vault_service_ref`)

---

## Prerequisites

- Both sides (initiator and acceptor) have WR Desk running with vault unlocked
- At least one HS Context Profile with documents (e.g. "Outperform") in WRVault
- Coordination mode enabled (relay) or direct P2P configured

---

## Test Steps

### 1. Revoke the existing handshake with info@optimando.ai

- Open WR Desk → Handshakes
- Find the handshake with info@optimando.ai
- Click **Revoke** (or equivalent)
- Confirm revocation
- Verify state shows REVOKED

### 2. Re-initiate a new handshake with context attached

- Click **Initiate Handshake** (or equivalent)
- Enter info@optimando.ai as recipient
- Open **Context Graph** → **Vault Profiles** tab
- Select at least one profile (e.g. "Outperform") with documents
- Optionally add ad-hoc text in the **Ad-hoc** tab
- Initiate the handshake
- Verify the handshake reaches PENDING_ACCEPT (or PENDING_REVIEW)

### 3. Accept from the other side with context attached

**On the acceptor machine (info@optimando.ai side):**

- Open the handshake invitation
- Open **Context Graph** → **Vault Profiles** tab
- Select at least one profile with documents
- Optionally add ad-hoc text
- Click **Accept**

### 4. Verification checklist

| Check | Expected | How to verify |
|-------|----------|---------------|
| **a. State transition to ACTIVE** | Handshake shows ACTIVE (not stuck in ACCEPTED) | Handshake list / detail view |
| **b. Context Graph count** | Count > 0 (not 0 blocks) | Context Graph tab shows Sent/Received blocks |
| **c. Both sides' context visible** | Public/Private, Sent/Received items visible | Context Graph UI |

---

## If the handshake stays ACCEPTED

### A. Check coordination WebSocket logs

Run WR Desk from a terminal to see main-process logs:

```bash
cd apps/electron-vite-project
npm run dev
```

**Look for these log lines:**

| Log prefix | Meaning |
|------------|---------|
| `[Coordination] Triggering initial context_sync` | Acceptor/initiator is attempting to send context_sync |
| `[Coordination] Initial context_sync enqueued` | context_sync was successfully enqueued |
| `[Coordination] Initial context_sync skipped, reason=` | Enqueue failed — note the reason |
| `[ContextSync] Building capsule:` | Building context_sync capsule (blockCount, seq, targetEndpoint) |
| `[ContextSync] Enqueued successfully` | Capsule sent to outbound queue |
| `[ContextSync] NO_P2P_ENDPOINT` | No delivery endpoint — coordination/relay may not be configured |
| `[ContextSync] NO_SIGNING_KEYS` | Signing keys missing — accept may have failed to store them |
| `[ContextSync] VAULT_LOCKED` | Vault locked — context_sync deferred |
| `[HANDSHAKE] context_sync processing:` | Incoming context_sync received and processed |
| `[HANDSHAKE] context_sync result state:` | State after processing (ACTIVE when both sides complete) |
| `[Coordination] Buffering early context_sync` | context_sync arrived before accept — will replay |
| `[Coordination] Replaying buffered context_sync` | Replaying buffered capsule after accept |

**Errors to watch for:**

- `[P2P] context_sync enqueue skipped after accept:` — reason will indicate why
- `[Coordination] Capsule processing failed:` — delivery/processing error
- `[Coordination] Handshake rejected:` — capsule validation failed

### B. Inspect handshake record after acceptance

The handshake DB stores `context_sync_pending` and `last_seq_received`. To inspect:

**Option 1: SQLite (if you have direct DB access)**

DB path (Windows): `%USERPROFILE%\.opengiraffe\electron-data\handshake-ledger.db`  
DB path (macOS/Linux): `~/.opengiraffe/electron-data/handshake-ledger.db`

```bash
# Windows PowerShell
sqlite3 "$env:USERPROFILE\.opengiraffe\electron-data\handshake-ledger.db" "SELECT handshake_id, state, context_sync_pending, last_seq_received, last_seq_sent, p2p_endpoint FROM handshakes ORDER BY created_at DESC LIMIT 5;"
```

```sql
SELECT handshake_id, state, context_sync_pending, last_seq_received, last_seq_sent, p2p_endpoint
FROM handshakes
WHERE handshake_id = '<your-handshake-id>';
```

**Interpretation:**

| Field | Meaning | Healthy values |
|-------|---------|----------------|
| `state` | Current state | `ACTIVE` when complete |
| `context_sync_pending` | 1 = we haven't sent our context_sync yet | 0 after we send |
| `last_seq_received` | Highest seq we received from counterparty | 1 when we got their context_sync |
| `last_seq_sent` | Highest seq we sent | 1 after we send context_sync |
| `p2p_endpoint` | Counterparty's delivery URL | Non-null for coordination/relay |

**ACCEPTED → ACTIVE condition:** `last_seq_received >= 1` AND `context_sync_pending = 0` (we received their context_sync and sent ours).

**Option 2: Via handshake.queryStatus RPC**

If the app exposes handshake status, check for `last_seq_received`, `context_sync_pending`, and `state`.

### C. Profile resolution diagnostic

After the fix, the accept handler logs profile block resolution:

```
[Handshake Accept] Profile resolution: profileIds=2, profileBlocks=2
```

- If `profileBlocks=0` with `profileIds>0`, the fix may not be applied or vault service ref is still missing `resolveHsProfilesForHandshake`.
- If `profileBlocks>0`, profile content is being included in the accept capsule and context_store.

---

## Rebuild before testing

Ensure the fix is in the build:

```bash
cd apps/electron-vite-project
npm run build
# Or for dev: npm run dev
```

The change is in `electron/main/vault/rpc.ts` — `setupEmbeddingServiceRef` now adds `resolveHsProfilesForHandshake` to `__og_vault_service_ref`.
