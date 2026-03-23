# Email domain model (main process)

## Layers

| Concept | Where it lives | Notes |
|--------|----------------|-------|
| **Provider kind** | `EmailProvider` in `types.ts` | gmail \| microsoft365 \| imap |
| **Implementation profile** | `PROVIDER_IMPLEMENTATION_PROFILE` | Static inbound/send/mutation flags |
| **Account row** | `EmailAccountConfig` (JSON) | One connection + credentials + `folders` |
| **Connected identity** | `ConnectedAccountIdentity` | `accountIdentity.ts` — who the row represents |
| **Secrets** | `oauth` / `imap` / `smtp?` on config | Token/password storage (encrypted on disk) |
| **Sync targets** | `MailboxSyncPlan` | `mailboxSyncPlan.ts` — folders/labels inside the mailbox |
| **API surface** | `EmailAccountInfo` | Includes derived `capabilities` |

## UI vs provider code

- Renderer **connect-email** flow (`extension-chromium/.../connectEmailFlow.tsx`) only opens the wizard; it must not encode provider rules.
- **Capabilities** and **sync plan** are computed in the main process (`capabilitiesRegistry`, `mailboxSyncPlan`).

## Multi-mailbox

- **Persisted slices:** Optional `EmailAccountConfig.mailboxes[]` — same OAuth/IMAP credentials, multiple logical mailboxes (each with optional folder overrides). Resolved via `mailboxResolution.ts`.
- **Default row:** If `mailboxes` is absent, resolution synthesizes one slice (`mailboxId: default`).
- **Adapter auto-discovery:** `multiMailboxPerAuthGrantSupported` (IPC) mirrors `adapterAutoListsAdditionalMailboxes` — **false** until we list shared/delegated mailboxes from the vendor API. This does **not** block manually persisted slices.
- **Schema:** `supportsMultipleMailboxSlicesOnRow` is always **true** — the JSON model allows multiple slices per row.

## SMTP / IMAP

- Types allow `smtp` / `imap` on `EmailAccountConfig`; full SMTP/IMAP product paths are not implemented in this module alone. The capability registry already marks `imap` as sync/send/mutation-capable for when those flows land.
