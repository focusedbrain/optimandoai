# Handshake Receiver Email Security Trace

**CRITICAL SECURITY BUG:** When initiating a handshake, the sender specifies a receiver email (e.g., `info@optimando.ai`). However, **ANY authenticated account can accept this handshake** — the receiver email is not validated against the accepting user's identity. This breaks the handshake trust model.

**Expected behavior:** Only the SSO account whose email matches the specified receiver email should be able to see and accept the handshake.

---

## 1. Where is the receiver email stored during initiation?

### Storage location
- **Table:** `handshakes` (SQLite, via `apps/electron-vite-project/electron/main/handshake/db.ts`)
- **Column:** `receiver_email` (TEXT, nullable)
- **Schema migration:** v14 (`ALTER TABLE handshakes ADD COLUMN receiver_email TEXT`)

### Field name
- **Handshake record:** `receiver_email` (see `HandshakeRecord` in `types.ts` line 363)
- **Capsule wire format:** `receiver_email` (see `HandshakeCapsuleWire` in `types.ts` line 290)

### Insert code
- **Initiator persist:** `initiatorPersist.ts` line 110:
  ```typescript
  receiver_email: capsule.receiver_email ?? null,
  ```
- **Recipient persist:** `recipientPersist.ts` line 114:
  ```typescript
  receiver_email: c.receiver_email ?? null,
  ```

### Capsule builder
- **Initiate capsule:** `capsuleBuilder.ts` lines 247, 264, 284:
  ```typescript
  receiver_email: opts.receiverEmail,
  ```
- **Source:** `InitiateHandshakeDialog.tsx` line 92-103 — user enters `recipientEmail`, passed as both `receiverUserId` and `receiverEmail` to `initiateHandshake(...)`

### Summary
The receiver email is correctly stored in the capsule and handshake record. The issue is **enforcement**, not storage.

---

## 2. How does the handshake reach the receiver?

### Delivery mechanisms
| Mechanism | Used for initiate? | Routing by receiver_email? |
|-----------|--------------------|----------------------------|
| **Email** | Yes (`sendCapsuleViaEmail`) | Yes — email is sent to `receiverEmail` |
| **File (.beap)** | Yes — user downloads and shares | **No** — file can be forwarded to anyone |
| **Relay/Coordination** | **No** — initiate capsules are **rejected** by relay | N/A |

### Relay behavior
- **Initiate capsules:** Explicitly rejected at `packages/coordination-service/src/server.ts` lines 200-216:
  ```typescript
  const RELAY_ALLOWED_TYPES = ['accept', 'context_sync', 'refresh', 'revoke']
  if (!RELAY_ALLOWED_TYPES.includes(capsuleType)) {
    sendError(res, 400, { error: 'capsule_type_not_allowed', ... })
  }
  ```
- **Routing:** Relay uses `handshakeRegistry.getRecipientForSender(handshakeId, identity.userId)` — routing is by **user_id** from the registry, not by `receiver_email` from the capsule.
- **Registry:** When initiator registers, `acceptor_user_id` is set to `receiverUserId` (which can be `receiverEmail` when using `buildForDownload` — see `handshakeRpc.ts` line 134: `receiverUserId: receiverEmail`).

### Critical conclusion
**The handshake is delivered out-of-band (file/email).** The recipient gets the file by:
1. **Email:** Sent to `receiverEmail` — but the email can be forwarded.
2. **File:** Downloaded and shared — **anyone can receive the file.**

There is **no server-side routing** that restricts who can receive the initiate capsule. The relay does not deliver initiate capsules; it only delivers accept/context_sync/refresh/revoke.

---

## 3. What happens when a user tries to accept a handshake?

### Accept handler flow
**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts` lines 620-861

**Checks performed:**
1. `handshake_id` and `sharing_mode` required
2. `requireSession()` — user must be authenticated
3. `getHandshakeRecord(db, handshake_id)` — record must exist
4. `record.state === PENDING_ACCEPT || PENDING_REVIEW`
5. Sharing mode clamped if initiator did not allow reciprocal

**❌ MISSING CHECK:**
```typescript
// NO validation that session.email === record.receiver_email
// There is NO line like:
// if (record.receiver_email && record.receiver_email.toLowerCase() !== session.email?.toLowerCase()) {
//   return { success: false, error: 'Handshake not intended for this account' }
// }
```

### Pipeline (receiverBinding step)
**File:** `apps/electron-vite-project/electron/main/handshake/steps/receiverBinding.ts`

**Docstring says:** "For initiate capsules: the receiver_email must match the local session email (i.e. the capsule is addressed to us)."

**Actual implementation:**
```typescript
if (input.capsuleType !== 'handshake-initiate') return { passed: true }
if (!input.receiver_email) return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
if (!input.sender_email) return { passed: false, reason: ReasonCode.POLICY_VIOLATION }
if (input.receiver_email === input.sender_email) return { passed: false, reason: ReasonCode.HANDSHAKE_OWNERSHIP_VIOLATION }
return { passed: true }
```

**❌ BUG:** The step does **NOT** compare `input.receiver_email` to `ctx.ssoSession.email`. It only checks that the capsule is not addressed to the sender. The context has `ssoSession` available but it is never used.

### Import flow bypass
**File:** `apps/electron-vite-project/electron/main/handshake/ipc.ts` lines 309-360

**`handshake.importCapsule`** does **NOT** call `processHandshakeCapsule`:
1. `processIncomingInput` → validation only
2. If `capsuleType === 'initiate'` → `canonicalRebuild` → `persistRecipientHandshakeRecord` (direct)
3. **Pipeline (including receiverBinding) is never executed** for import

So even if `receiverBinding` were fixed to check `receiver_email === session.email`, the **import path** would still bypass it.

### handshakeVerification.ts (not used in production)
**File:** `apps/electron-vite-project/electron/main/handshake/handshakeVerification.ts` lines 114-120

```typescript
if (capsule.receiver_email !== expectedReceiverEmail) {
  return { verified: false, step: 'receiver_binding', reason: `...` }
}
```

This function **does** perform the check, but it is **not used** in the production pipeline. See `BEAP_CODEBASE_ANALYSIS.md`: "verifyHandshakeCapsule — 8-step full verification — **not used** in production pipeline".

---

## 4. Where SHOULD the check be enforced?

| Layer | Current state | Required |
|-------|---------------|----------|
| **a) Client-side (handshake list)** | `listHandshakeRecords` returns ALL records — no filter by `receiver_email` | Filter handshakes where `local_role === 'acceptor'` AND `receiver_email` matches session email to show only "for me" handshakes |
| **b) Accept handler (local)** | **No check** — any authenticated user can accept | Add: `if (record.receiver_email && record.receiver_email.toLowerCase() !== session.email?.toLowerCase()) return { success: false, error: '...' }` |
| **c) Pipeline receiverBinding** | Only checks `receiver_email !== sender_email`; **does not** check `receiver_email === session.email` | Add: `if (input.receiver_email.toLowerCase() !== ctx.ssoSession.email?.toLowerCase()) return { passed: false }` |
| **d) Import flow** | Bypasses pipeline entirely | Either route import through `processHandshakeCapsule`, or add explicit receiver check before `persistRecipientHandshakeRecord` |
| **e) Relay/server-side** | No validation — registry only stores initiator/acceptor user_ids; relay does not validate acceptor email matches intended receiver | Register with `receiver_email`; when acceptor POSTs accept capsule, verify `identity.email` matches `receiver_email` from registry |
| **f) Capsule verification (initiator side)** | When initiator receives accept capsule, `verifyCapsuleSignature` and `verifyCapsuleHashIntegrity` are used; acceptor's identity is in the capsule | Initiator could verify `acceptor.senderIdentity.email` matches `record.receiver_email` — **not currently done** |

---

## 5. How is the current user's email/identity available?

### Electron app
- **Session:** `session.email` from `SSOSession` (see `main.ts` line 3588: `email: userInfo.email`)
- **Source:** `getCachedUserInfo()` / `ensureSession()` → `SessionUserInfo.email` from JWT payload (`email` claim or `preferred_username`)
- **File:** `apps/electron-vite-project/src/auth/session.ts`

### Chrome extension
- **RPC:** Extension sends RPC to Electron; Electron backend uses `requireSession()` / `_getSession()` → same `session.email`
- **Extension does not directly call accept** — it invokes `handshake.accept` RPC; backend has session

### Capsule signing identity
- **Accept capsule:** `senderIdentity` in capsule contains `email`, `sub`, `iss` from acceptor's session
- **Verification:** `verifyCapsuleSignature` validates the signature; identity comes from SSO session

### Spoofing risk
- **Session email:** Comes from OIDC JWT validated by Keycloak; not easily spoofed by client
- **Capsule identity:** Acceptor signs with their key; session identity is used when building the capsule. A malicious acceptor could not spoof `info@optimando.ai` in the capsule's `senderIdentity` without having that SSO account — but the **initiator** does not currently verify that the acceptor's email matches the intended receiver.

---

## 6. Coordination WebSocket authentication

### Connection auth
**File:** `packages/coordination-service/src/server.ts` lines 329-344

```typescript
wss.on('connection', async (ws, req) => {
  const token = tokenFromUrl ?? auth.extractBearerToken(authHeader)
  if (!token) { ws.close(4001, 'Unauthorized'); return }
  const identity = await auth.validateOidcToken(token)
  if (!identity) { ws.close(4001, 'Unauthorized'); return }
  // ...
})
```

- **Identity:** `ValidatedIdentity` from `auth.ts`: `{ userId, email, tier }` — extracted from JWT (`sub`, `email`, `preferred_username`)
- **Connection:** Each WebSocket is bound to one identity (one user per connection)

### Could a client connect with one identity and accept handshakes for another?
- **WebSocket:** Client connects with their own OIDC token → identity is fixed per connection
- **Capsule POST:** When acceptor POSTs accept capsule to `/beap/capsule`, `identity.userId` comes from the Bearer token. So the acceptor must use their own token.
- **Registry:** When acceptor registers, they send `acceptor_user_id: session.wrdesk_user_id` — their real ID. The relay does **not** validate that this acceptor matches the `receiver_email` the initiator specified.

**Conclusion:** A client cannot connect with a different identity (JWT is validated). But **any** authenticated user who receives the file can import it and accept. The relay trusts the registry; the registry is populated by whoever imports and accepts — there is no check that the acceptor's email matches the intended receiver.

---

## Summary of enforcement gaps

| Location | File | Issue |
|----------|------|-------|
| `receiverBinding` step | `handshake/steps/receiverBinding.ts` | Docstring says check `receiver_email === session.email`; implementation only checks `receiver_email !== sender_email` |
| `handshake.importCapsule` | `handshake/ipc.ts` | Bypasses pipeline; no receiver check before persist |
| `handshake.accept` | `handshake/ipc.ts` | No check that `record.receiver_email === session.email` |
| `listHandshakeRecords` | `handshake/db.ts` | No filter by receiver_email; all handshakes visible to all users |
| Relay registration | `coordination-service/server.ts` | No validation that acceptor email matches intended receiver |
| `verifyHandshakeCapsule` | `handshakeVerification.ts` | Has correct check but **not used** in production |

---

## Recommended fixes (priority order)

1. **Accept handler:** Add `record.receiver_email === session.email` check before building accept capsule.
2. **Import flow:** Add receiver check before `persistRecipientHandshakeRecord`; reject if `capsule.receiver_email !== session.email`.
3. **receiverBinding step:** Fix implementation to compare `input.receiver_email` to `ctx.ssoSession.email` (for any path that uses the pipeline).
4. **Client-side filter:** Filter `handshake.list` results for acceptor role to only show handshakes where `receiver_email` matches current user (defense in depth).
5. **Relay:** When registering accept, require `acceptor_email` to match `receiver_email` from the handshake record (requires relay to store/fetch receiver_email).
6. **Initiator verification:** When processing accept capsule, verify `acceptor.senderIdentity.email` matches `record.receiver_email`.
