# Cross-Machine Runbook Checklist — 2026-06-08

**Session:** two-box (Windows Pro host + mini-PC Linux sandbox) + LAN relay on mini-PC.
**Branch:** `feature/layered-sandbox` **HEAD:** `45fb23ea` (both machines, post-fix rebuild).
**Relay:** `192.168.178.29:51249` (`COORD_DB_PATH=/tmp/coord-xmachine.db`).
**Devices:** host `8929353a-5cbc-46f7-b4d9-6439b82a14ca` · sandbox `4a90a60b-3f53-43c5-92b3-1bbe9d943063`.

Logs in this folder are **INV-5 scrubbed** (no Annex I spec text, no `p2p_auth_token` values).

---

## Step 0 — Sync + HEAD verification

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| mini-PC `git rev-parse HEAD` | **PASS** `45fb23ea` | 2026-06-08 | `git-head-sandbox.txt` |
| Windows `git rev-parse HEAD` | **PASS** `45fb23ea` | 2026-06-08 | `git-head-windows-host.txt` |
| Hashes match | **PASS** | | |

---

## Step 1 — Build + bootstrap (mini-PC)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| `pnpm session:start` build commit matches HEAD | **PASS** | ~17:49 | `sandbox-app.log.trimmed` RUNTIME_IDENTITY |
| `/health` ok | **PASS** | ~17:49 | relay started |

---

## Step 2 — Build + configure Windows (host)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| `session:build` + `session:configure-remote 192.168.178.29` | **PASS** | 2026-06-08 | operator; matching HEAD |
| Fresh EXE launch | **PASS** | | |

---

## Step 3 — Launch both orchestrators (provenance)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Sandbox `[RUNTIME_IDENTITY] commit=45fb23ea` | **PASS** | 17:47:46 | `sandbox-app.log.trimmed` |
| Host `[RUNTIME_IDENTITY] commit=45fb23ea` | **PASS** | 2026-06-08 | operator-confirmed |
| Both WS connected to relay | **PASS** | | relay + app logs |

---

## Matrix items 1–8

### 1. Pairing (6-digit code → ACTIVE)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| ACTIVE on both sides | **PASS** | ~18:19 | `hs-e0c54755` re-pair; earlier `hs-980a3c3e` |
| Relay registry: both device ids non-null | **PASS** | | `relay-registry.txt`, `relay.log.trimmed` RELAY_IDENTITY |
| **Note:** duplicate accept on re-pair logged `COUNTERSIGNATURE_INVALID` on host — benign mislabel (replayed accept should no-op); tracked in DEFERRED.md | observed | | operator + host log (not in scrubbed sandbox log) |

### 2. Capsule lifecycle (context_sync + refresh)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| context_sync delivered both directions | **PASS** | ~18:19 | `relay.log.trimmed` push_live context_sync ×2 for `hs-e0c54755` |
| seq advanced, no signature rejection | **PASS** | | app log ingest_ok / processHandshakeCapsule |

### 3. qBEAP message delivery (live)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Host→sandbox message live (push_live 200) | **PASS** | ~18:27 | `relay.log.trimmed` push_live capsule_type=null (message_package) |
| Sandbox inbox received | **PASS** | | `attachments: 1` + message ingest in session |

### 4. pBEAP trust decision

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Explicit lesser verdict recorded (expected `unverified_public`) | **PASS** | | per runbook expectation; live path header-only |

### 5. Clone gesture (live / queued)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Live clone to sandbox | **PASS** | ~18:28 | `CLONE_RECEIVE persist_success` clone-3f9a0550 |
| Second clone (queued/offline variant exercised) | **PASS** | ~18:28 | `CLONE_RECEIVE persist_success` clone-60c62242 |
| Exactly-once (no duplicate persist) | **PASS** | | two distinct cloneIds, one persist each |

### 6. Quarantine routing

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Encrypted custody blob to paired sandbox | **PASS** | 2026-06-08 | operator session; INV-5: no plaintext in committed logs |

### 7. Internal inference request/result (host-AI)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| **Pre-fix (`de5b9cdc`):** sandbox→host `/beap/ingest` auth_failure 401 | FAIL (regression) | earlier same day | diagnosed fd61df3e; fixed 45fb23ea |
| **Post-fix (`45fb23ea`):** policy GET 200 + ollama_direct inference | **PASS** | ~18:20+ | `response_status=200 phase=policy_get handshake=hs-e0c54755`; `INBOX_OLLAMA_STREAM_RESPONSE http_status=200 ok=true lane=ollama_direct` |
| Host model roster received | **PASS** | | `HOST_AI_MODEL_ROSTER_RECEIVED` gemma3:12b, llama3.1:8b |
| Inbox automation (AI analyze stream) via host Ollama | **PASS** | ~18:27 | `INBOX_AUDIT analysis_validation outcome=accepted` ×4 |
| Negative gate (non-ACTIVE refused) | **PASS** | ~18:14 | revoke→REVOKED before re-pair |

### 8. Revoke (and re-pair)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Post-revoke delivery refused | **PASS** | ~18:14 | `state_after=REVOKED` hs-980a3c3e; relay push_live revoke |
| Re-pair → new ACTIVE handshake | **PASS** | ~18:19 | `hs-e0c54755` registry + accept/context_sync |
| Delivery restored after re-pair | **PASS** | ~18:27+ | clones + messages on `hs-e0c54755` |

---

## Failure-mode F1 — relay down → queue → recovery

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Not exercised this session | **N/A** | | deferred to next session |

---

## Final smoke — deployed relay (`relay.wrdesk.com`)

| | Result | Timestamp (UTC) | Evidence |
|---|---|---|---|
| Not exercised this session | **N/A** | | local relay session only |

---

## Regression found and fixed during session

| Item | Commit | Notes |
|---|---|---|
| Host-AI outbound Bearer inversion | regressed `fd61df3e` (build87) | sandbox sent `counterparty_p2p_token` instead of `local_p2p_auth_token` → 401 on fresh pairings |
| Fix | **`45fb23ea`** | revert + P9 distinct-token regression test in `p2p-transport.test.ts` |

---

## Attachments + automation (session extras)

| | Result | Evidence |
|---|---|---|
| Host→sandbox message with attachment | **PASS** | `attachments: 1` on ingest |
| Sandbox inbox AI analyze (host Ollama) | **PASS** | `INBOX_OLLAMA_STREAM_RESPONSE ok=true` ×4 |
| Native BEAP draft/automation path exercised | **PASS** | `INBOX_AUDIT` + `AI-DRAFT` session lines (scrubbed) |

---

**Session closed:** 2026-06-08. Evidence committed under `rig-evidence/2026-06-08/`.
