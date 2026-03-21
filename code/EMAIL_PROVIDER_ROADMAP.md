# Email provider roadmap (WR Desk)

## Shipped today

| Provider | Pull / classify | Remote folder sync |
|----------|-----------------|---------------------|
| **Microsoft 365 / Outlook** | Yes | **Full** (Microsoft Graph folder moves) |
| **IMAP / SMTP** | Yes | **Best-effort** (IMAP `MOVE`, provider-dependent; throttled in-app) |
| **Gmail (OAuth)** | Yes (when configured) | **Improving** — today uses the same remote queue path as other accounts; native Gmail API labels are the target architecture below |

## Why Gmail API (future) is faster than IMAP

- **Stable IDs** — Gmail message ids for API differ from IMAP UIDs across sessions/moves.
- **Labels** — add/remove labels (e.g. “Pending Delete”) instead of open-mailbox → search → MOVE → verify.
- **Batching** — `users.messages.batchModify` can touch many messages per HTTP round-trip.
- **Documented quotas** — easier to stay inside limits than opaque IMAP connection policies.

Illustrative shape (not implemented here):

```ts
await gmail.users.messages.modify({
  userId: 'me',
  id: messageId,
  requestBody: {
    addLabelIds: [pendingDeleteLabelId],
    removeLabelIds: ['INBOX'],
  },
})
```

## Priority (product)

1. **Gmail API** — highest after Graph is stable in the field.
2. **Zoho API** — second (common in SMB).
3. **Yahoo / consumer IMAP-only** — lower priority.

## User-facing principle

- **OAuth / API providers** — first-class for remote sync.
- **IMAP** — fully supported for ingestion and sorting in WR Desk; remote mirroring is honest, slow, and throttled where needed.

See also: `apps/electron-vite-project/electron/main/email/REMOTE_ORCHESTRATOR_SYNC.md`.
