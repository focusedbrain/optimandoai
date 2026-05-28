# Stream B — Fetch and send inventory (role policy gates)

Checked-in audit for B2/B3. Every host orchestrator path below must call `rolePolicy` via `rolePolicyEnforce.ts` helpers.

## B2 — Fetch call sites (orchestrator)

| File | Function / handler | Account ID | Prior gate | Trigger | Policy gate |
|------|-------------------|------------|------------|---------|-------------|
| `syncOrchestrator.ts` | `syncAccountEmailsImpl` | `options.accountId` | edgeFetch.state skip (replaced) | timer, `inbox:syncAccount`, `inbox:pullMore`, auto-sync | `enforceFetchPolicyForAccountId` |
| `gateway.ts` | `listMessages` | `accountId` | none | sync, HTTP API, IPC `email:listMessages` | `enforceFetchPolicyForAccount` |
| `gateway.ts` | `getMessage` | `accountId` | none | IPC `email:getMessage`, UI hydrate | `enforceFetchPolicyForAccount` |
| `gateway.ts` | `sendReply` (provider fetch for threading) | `accountId` | none | IPC `email:sendReply` | `enforceFetchPolicyForAccount` before provider fetch |
| `main.ts` | `GET /api/email/accounts/:id/messages` | `req.params.id` | none | HTTP | via `gateway.listMessages` |
| `ipc.ts` | `inbox:syncAccount`, `inbox:pullMore` | `accountId` | none | user / timer | via `syncAccountEmails` → impl |
| `ipc.ts` | scheduled sync loop | `acc.id` | none | timer | via `syncAccountEmails` |

**Not gated (intentionally):** `testConnection`, `syncAccount` (connection test only), inbox DB reads (`inbox:listMessages`), edge mail-fetcher remote fetch.

**Unsure — verify:** provider-internal `fetchMessages` only reachable through `gateway.listMessages` or sync orchestrator.

## B3 — Send call sites (orchestrator)

| File | Function / handler | Account ID | Prior gate | Trigger | Policy gate |
|------|-------------------|------------|------------|---------|-------------|
| `gateway.ts` | `sendEmail` | `accountId` | none | all send paths | `enforceSendPolicyForAccount` |
| `gateway.ts` | `sendReply` | `accountId` | none | IPC `email:sendReply` | `enforceSendPolicyForAccount` |
| `ipc.ts` | `email:sendEmail` | `accountId` | none | renderer compose | via gateway + IPC `rolePolicyIpc` |
| `ipc.ts` | `email:sendReply` | `accountId` | none | renderer reply | via gateway + IPC |
| `ipc.ts` | `email:sendBeapEmail` | default account row | none | BEAP email send | via gateway |
| `main.ts` | `POST /api/email/send` | `req.body.accountId` | none | HTTP | via `gateway.sendEmail` |
| `main.ts` | `POST /api/email/send-beap` | default account | none | HTTP | via `gateway.sendEmail` |
| `main.ts` | `setEmailSendFn` callback | varies | none | internal | via `gateway.sendEmail` |

**Not gated:** P2P `handshake:sendBeapViaP2P` (not provider SMTP). Auto-reply / AI draft send that uses `emailGateway.sendEmail` is covered by gateway gate.

## B6 — Edge mail-fetcher

| Location | Enforcement |
|----------|-------------|
| `mail-fetcher/supervisor.ts` | Startup `rolePolicy.canSend` assertion; HTTP `isMailFetcherSendShapedRequest` → 403 |
| `pod-remote-edge.yaml` | No SMTP env or mounts (audit: no smtp in manifest) |
