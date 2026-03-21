# Mailbox lifecycle mapping (internal ↔ remote)

## A. Mapping model

| Internal operation (`OrchestratorRemoteOperation`) | Intent | Gmail | Microsoft 365 (Graph) | IMAP (custom) |
| --- | --- | --- | --- | --- |
| `archive` | Leave inbox / archive on server | Remove labels in `gmailArchiveRemoveLabelIds` (default `INBOX`) | Move to well-known **Archive** folder | `MOVE` to configured archive mailbox (default `Archive`) |
| `pending_review` | Server-side quarantine bucket | Add user label `gmailPendingReviewLabel`, remove archive labels + pending-delete + urgent labels | Move to root folder `outlookPendingReviewFolder` | `MOVE` to `imapPendingReviewMailbox` |
| `pending_delete` | Server-side pre-delete bucket | Add user label `gmailPendingDeleteLabel`, remove archive labels + pending-review + urgent labels | Move to root folder `outlookPendingDeleteFolder` | `MOVE` to `imapPendingDeleteMailbox` |
| `urgent` | High-priority bucket | Add user label `gmailUrgentLabel` (default `Urgent`), remove archive labels + other lifecycle labels | Move to root folder `outlookUrgentFolder` (default `Urgent`) | `MOVE` to `imapUrgentMailbox` |
| *(delete API, not orchestrator op)* | Trash / recoverable delete | `POST …/messages/{id}/trash` | `POST …/move` → `deleteditems` | `MOVE` from inbox to `imapTrashMailbox` |

Single source of truth for defaults and merge logic: `domain/mailboxLifecycleMapping.ts` → `resolveOrchestratorRemoteNames(account)`.

Per-account overrides live on `EmailAccountConfig.orchestratorRemote` (`OrchestratorRemoteNamesInput` in `types.ts`).

## B. Provider handling

- **Gmail** (`providers/gmail.ts`): uses resolved label **display names** and label ids from the API; archive uses configurable **remove** label id list.
- **Outlook** (`providers/outlook.ts`): archive uses Graph well-known `archive`; pending buckets use resolved **display names** under Inbox (created on demand).
- **IMAP** (`providers/imap.ts`): resolved mailbox **names** for `addBox` / `MOVE` from the configured inbox folder.

Deletion helpers: `REMOTE_DELETION_TARGETS` in `mailboxLifecycleMapping.ts` (Gmail trash suffix, Outlook deleted-items id).

## C. Configuration points

1. **Defaults** — `DEFAULT_ORCHESTRATOR_REMOTE_NAMES` in `mailboxLifecycleMapping.ts`.
2. **Persisted overrides** — `EmailAccountConfig.orchestratorRemote` (any provider); merge at runtime via `resolveOrchestratorRemoteNames`.
3. **Custom IMAP connect** — optional payload fields `imapLifecycle*` on `CustomImapSmtpConnectPayload`; gateway stores them via `orchestratorRemoteFromImapLifecycleFields` when connecting (`gateway.connectCustomImapSmtpAccount`).
4. **Validation** — `emailGateway.validateImapLifecycleRemote(accountId)` (IMAP only): LIST + attempt CREATE for each lifecycle mailbox. Exposed as IPC `email:validateImapLifecycleRemote` and preload `emailAccounts.validateImapLifecycleRemote`.

## D. Remaining edge cases

- **IMAP nested paths** (e.g. `INBOX/Archive`): matching uses flat name / path suffix heuristics; `CREATE` uses the string as given — nested mailboxes may need to exist already or use a server-specific path.
- **Gmail `gmailArchiveRemoveLabelIds`**: must be valid Gmail **label ids** for the modify API; wrong values cause API errors (not all product defaults are ids — `INBOX` is special-cased by Gmail).
- **Outlook folder rename**: if an operator renames a child folder in Outlook, the app creates a new folder by display name on next use; old folder may still exist.
- **IMAP `deleteMessage`**: assumes the message UID is still in the configured **inbox** folder (same as previous expunge behavior).
- **Unicode / RFC 3501 modified UTF-7**: non-ASCII mailbox names depend on server and library behavior; keep ASCII names for broad compatibility.
