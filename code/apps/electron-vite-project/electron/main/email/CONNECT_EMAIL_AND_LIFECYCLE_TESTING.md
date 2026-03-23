# Connect email & remote lifecycle — automated tests & QA

## A. Tests added (Vitest, repo root `pnpm test`)

| File | Focus |
|------|--------|
| `electron/main/email/domain/mailboxLifecycleMapping.test.ts` | `resolveOrchestratorRemoteNames` (Gmail / Outlook / IMAP), IMAP lifecycle field mapping, `describeOrchestratorRemoteOperation`, `REMOTE_DELETION_TARGETS` |
| `electron/main/email/domain/customImapSmtpPayloadValidation.test.ts` | Custom IMAP+SMTP payload validation (ports, credentials, optional lifecycle mailbox names) |
| `electron/main/email/__tests__/inboxOrchestratorRemoteQueue.enqueue.test.ts` | Enqueue skips / success paths; mocked `emailGateway` (no Electron) |
| `electron/main/email/__tests__/inboxLifecycleEngine.tick.test.ts` | `PENDING_*_RETENTION_MS`, cutoff math, `runInboxLifecycleTick` promotion + `queueRemoteDeletion` wiring (mocked DB + mocks) |
| `extension-chromium/src/shared/email/connectEmail.launch.test.ts` | `ConnectEmailLaunchSource` stability, required entrypoints, `wizardThemeFromFlowTheme` |

**Convenience (optional):**

```bash
pnpm exec vitest run \
  apps/electron-vite-project/electron/main/email/domain/mailboxLifecycleMapping.test.ts \
  apps/electron-vite-project/electron/main/email/domain/customImapSmtpPayloadValidation.test.ts \
  apps/electron-vite-project/electron/main/email/__tests__/inboxOrchestratorRemoteQueue.enqueue.test.ts \
  apps/electron-vite-project/electron/main/email/__tests__/inboxLifecycleEngine.tick.test.ts \
  apps/extension-chromium/src/shared/email/connectEmail.launch.test.ts
```

## B. Gaps that still need manual QA

| Area | Why hard to automate |
|------|----------------------|
| **Full `useConnectEmailFlow` + `EmailConnectWizard` UI** | Requires `jsdom` + RTL + heavy mocking of `window.emailAccounts` / `chrome.runtime`; high flake vs value for this pass. |
| **Real Gmail / Microsoft OAuth + IMAP/SMTP handshakes** | External services, secrets, browser/Electron OAuth windows. |
| **`applyOrchestratorRemoteOperation` on live providers** | Needs API tokens and real message IDs; idempotent error strings differ by server. |
| **IPC `email:accountConnected` → renderer refresh** | Couples BrowserWindow, preload, and React trees; better as E2E. |
| **`processOrchestratorRemoteQueueBatch` drain + backoff** | Pulls `emailGateway.applyOrchestratorRemoteOperation` and SQLite schema; covered partially via enqueue unit tests only. |
| **Gmail-specific idempotent modify errors** | Private provider helpers; behavior validated indirectly via manual/API tests. |

## C. Suggested manual QA checklist

### Connect email (all providers)

1. **Electron Inbox** — Connect Email → complete Gmail → list refreshes; repeat cancel (X) → no duplicate account.
2. **Electron Bulk Inbox** — same for Microsoft 365 / Outlook.
3. **WR Chat docked** — Connect Email → Custom (IMAP+SMTP) with valid host/port → success; invalid port → clear error.
4. **WR Chat popup** — same as docked; confirm `launchSource` appears in devtools log (`[ConnectEmailFlow] open`).
5. **Optional lifecycle mailboxes** on custom connect — very long name → validation error; ASCII names → saved on account.

### Remote lifecycle

6. Move message to **Pending Review** (UI) → confirm local state + remote folder/label (Gmail labels / Outlook folders / IMAP mailbox).
7. Wait or backdate `pending_review_at` in DB → run tick (or wait 5m) → message moves to **Pending Delete** locally and remote `pending_delete` enqueue fires.
8. After **7d** `pending_delete_at` (or test DB) → message enters deletion queue; remote trash/delete path runs per provider.
9. Repeat same remote operation (e.g. archive already archived) → UI still consistent; queue/provider tolerate duplicates where designed.

### Regression

10. Disconnect account → `email:accountConnected` not fired; list updates.
11. Connect second account → both appear; default selection sensible.
