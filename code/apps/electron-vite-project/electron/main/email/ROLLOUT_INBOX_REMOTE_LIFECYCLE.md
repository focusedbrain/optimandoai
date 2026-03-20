# Rollout: inbox remote lifecycle + connect email

## A. Hardening changes made (this pass)

| Area | Change |
|------|--------|
| **Provider routing** | `getProviderSync` now **throws** if the account id is missing instead of defaulting to `imap` (avoid wrong API for Gmail/Graph). |
| **Deletion queue** | `queueRemoteDeletion` resolves **provider type before** marking `deleted=1`, so a missing account does not leave the message soft-deleted without a `deletion_queue` row. |
| **Stuck `processing` rows** | Reset uses **parameterized ISO cutoff** from Node (`updated_at < ?`) instead of mixing SQLite `datetime('now')` with JS ISO strings. |
| **Drain resilience** | On drain **exception**, schedules another drain after **15s** (reduces stranded queue until the next 5m lifecycle tick). |
| **Observability** | `processOrchestratorRemoteQueueBatch` logs **`[OrchestratorRemote] batch done processed=…`** when work ran. |
| **Enqueue visibility** | `fireRemoteOrchestratorSync` **warns** when all rows in a batch were skipped (data shape / account issues). |
| **Ghost queue rows** | `applyOrchestratorRemoteOperation` returns **`{ ok: false }`** for missing accounts (no throw). Batch processor treats **“Account not found”** / **“does not implement remote orchestrator”** as **terminal** (fail fast, no 8 wasted attempts). |

---

## B. Remaining risks

| Risk | Mitigation |
|------|------------|
| **`remote_orchestrator_mutation_queue` growth** (`completed` rows) | No automatic purge yet; support can `DELETE … WHERE status='completed' AND updated_at < …`. Consider a nightly job post-stabilization. |
| **OAuth / IMAP secrets** | Unchanged contract: OAuth + sealed passwords on disk; no new secrets in the queue table (only ids + errors). |
| **Provider idempotency** | Gmail/Outlook/IMAP still depend on provider-specific behavior; queue dedupes by `(message_id, operation)` only. |
| **Extension + Electron version skew** | Older extension without Custom Email still talks to older IPC; new fields are additive on payloads. |
| **Lexicographic `updated_at` compare** | Stuck-row and purge logic assume **UTC ISO** strings as written by the app; consistent today. |

---

## C. Rollout plan

### Migration steps

1. **Ship Electron build** that includes handshake migrations **v35–v36** (queue + lifecycle columns). App startup runs `migrateHandshakeTables` — **idempotent**, safe on repeat.
2. **Existing accounts** without `orchestratorRemote`: **unchanged behavior** — `resolveOrchestratorRemoteNames` uses defaults.
3. **Extension** (WR Chat): publish after or with Electron so Custom IMAP + `connectEmailFlow` stay aligned (no hard requirement if users only update Electron first).
4. **Optional feature flags** (if you use a config service later): `INBOX_REMOTE_ORCHESTRATOR_ENABLED` to skip `fireRemoteOrchestratorSync` / drain — **not implemented in code** today; add only if you need a kill switch without redeploy.

### Safe deployment order

1. Internal / beta channel with **one** Gmail + **one** M365 + **one** IMAP account.
2. Monitor logs: `[OrchestratorRemote]`, `[Inbox] Remote orchestrator`, `[InboxLifecycle]`.
3. General release after 24–48h without spike in `failed` queue rows or support tickets.

### Rollback considerations

- **App rollback**: older binary may not read new JSON fields — usually **ignored**; DB migrations **do not auto-downgrade** (SQLite columns/tables remain; old app should tolerate extra columns if queries use explicit column lists).
- **Worst case**: disable remote mirroring by shipping a patch that no-ops `fireRemoteOrchestratorSync` (small change) — local inbox/lifecycle still works.
- **Queue cleanup**: `UPDATE remote_orchestrator_mutation_queue SET status='pending'` for stuck `processing` if needed (rare after stuck-row fix).

---

## D. Post-release QA checklist

- [ ] Connect **Gmail** / **M365** / **Custom IMAP** from **Inbox** and **WR Chat**; accounts list refreshes.
- [ ] Move message to **Pending Review** → remote label/folder/mailbox; `remote_orchestrator_mutation_queue` shows `completed` or sensible `last_error`.
- [ ] After promotion tick: **review → pending delete** enqueues `pending_delete` remote op.
- [ ] Remove email account → **no** new enqueue with wrong provider; queue rows for missing account → **failed** with clear error (not endless retry).
- [ ] Simulate drain failure (e.g. brief DB lock) → within **~15s** another drain attempt (log noise acceptable).
- [ ] Logs: batch summary lines appear under load; no PII beyond account id / message id (errors may contain provider text — scrub in support exports if needed).
