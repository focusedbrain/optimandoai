# Handshake Receiver Email — Security Design Analysis

Design analysis for receiver email enforcement: current state, intent, and evaluation of design options.

---

## PART A — Current State and Intent

### 1. What is the receiver email field currently used for?

#### a) Routing/delivery (relay)

**No.** The relay does **not** use `receiver_email` for routing.

- **Initiate capsules:** Rejected by relay (`RELAY_ALLOWED_TYPES = ['accept', 'context_sync', 'refresh', 'revoke']`). Initiate never goes through relay.
- **Routing:** Uses `handshakeRegistry.getRecipientForSender(handshakeId, senderUserId)` → returns `initiator_user_id` or `acceptor_user_id` from the registry. Routing is by **user_id**, not email.
- **Registry:** Stores `acceptor_user_id` (set at registration). For `buildForDownload`, `acceptor_user_id` can be `receiverEmail` (see `handshakeRpc.ts` line 134: `receiverUserId: receiverEmail`), so the relay can match by email via `resolveClient(recipientUserId)` when `recipientUserId.includes('@')` — but this only affects **accept/context_sync** delivery, not initiate.

```typescript
// wsManager.ts lines 39-46
function resolveClient(recipientUserId: string): ConnectedClient | undefined {
  const byUuid = clients.get(recipientUserId)
  if (byUuid) return byUuid
  if (recipientUserId.includes('@')) {
    for (const client of clients.values()) {
      if (client.email === recipientUserId) return client
    }
  }
  return undefined
}
```

#### b) Display only

**Yes.** Shown to the initiator as the intended recipient:

```typescript
// HandshakeView.tsx line 61
return record.acceptor?.email ?? record.receiver_email ?? '(pending)'
```

```typescript
// PendingSlideOut.tsx line 159
<div>{r.receiver_email}</div>
```

#### c) Cryptographic binding

**Yes.** `receiver_email` is included in:

1. **Context hash** (`contextHash.ts` lines 72-73): `receiver_email` and `receiver_id` are in the canonical payload. Tampering invalidates the hash.
2. **Capsule hash** (`capsuleHash.ts` lines 75-77): For schema v2+, `receiver_email` is included in the capsule hash for initiate/accept.

```typescript
// capsuleHash.ts
if (input.receiver_email !== undefined) {
  canonical.receiver_email = input.receiver_email
}
```

So the capsule is **cryptographically bound** to the stated receiver email — but there is **no enforcement** that the acceptor’s identity matches it.

#### d) Relay push to a specific WebSocket

**Not for initiate.** Initiate capsules are not pushed. For accept/context_sync, the relay pushes to `recipientUserId` from the registry; if that was stored as an email (from `buildForDownload`), `resolveClient` can match by `client.email === recipientUserId`.

#### Flow from initiation form to delivery

```
InitiateHandshakeDialog.tsx
  → recipientEmail (user input)
  → initiateHandshake(receiverUserId, recipientEmail, ...)  // receiverUserId = recipientEmail when no lookup
  → handshake.initiate RPC
  → buildInitiateCapsuleWithContent(session, { receiverUserId, receiverEmail, ... })
  → capsule.receiver_email = opts.receiverEmail
  → persistInitiatorHandshakeRecord: record.receiver_email = capsule.receiver_email
  → registerHandshakeWithRelay: acceptor_email: receiverEmail (stored in registry)
  → sendCapsuleViaEmail(fromAccountId, receiverEmail, capsule)  // if email path
  → OR buildForDownload returns capsule JSON for file download
```

---

### 2. How does the receiver discover the handshake?

#### Polling

**Relay-server (Pro):** Host polls `GET /beap/pull` with `relay_auth_secret`. Returns **all** unacknowledged capsules — no per-user filter. The host processes each; `processHandshakeCapsule` accepts or rejects based on local handshake state.

**Coordination-service (Free):** No generic pull. WebSocket push only.

#### Relay push

**Coordination-service:** When a client connects via WebSocket (OIDC token), `handleConnection` calls `store.getPendingCapsules(userId, email)`. Capsules are stored with `recipient_user_id` when someone POSTs to `/beap/capsule`. So the user gets capsules **addressed to them** (by user_id or email match in `getPendingCapsules`).

**Critical:** Initiate capsules are **never** sent via relay. So the relay does **not** push initiate handshakes to anyone.

#### How the receiver actually gets the handshake

| Path | Mechanism | Filtering |
|------|-----------|-----------|
| **Email** | `sendCapsuleViaEmail` sends to `receiverEmail` via user’s Gmail/Outlook | Email goes to that address; can be forwarded |
| **File** | User downloads .beap, shares file | **None** — anyone with the file can import |
| **Relay** | N/A for initiate | Initiate rejected by relay |

**Import flow:** `handshake.importCapsule` → `processIncomingInput` (validation only) → `persistRecipientHandshakeRecord` (direct). No receiver check. Any user who imports the file gets a PENDING_REVIEW record.

**Handshake list:** `listHandshakeRecords(db, filter)` returns all records. No filter by `receiver_email`. Every user sees every handshake in their DB.

#### Summary

- **No relay-based discovery** for initiate handshakes.
- Receiver gets it via **email** (to `receiverEmail`) or **file** (no restriction).
- **No filtering** on who can import or who sees pending handshakes.

---

### 3. What identity does each party have?

#### SSO account identity

From `SSOSession` and JWT:

```typescript
// types.ts
interface SSOSession {
  wrdesk_user_id: string;  // sub or custom claim
  email: string;           // from JWT email or preferred_username
  iss: string;
  sub: string;
  // ...
}
```

```typescript
// coordination-service auth.ts
const email = typeof payload.email === 'string' ? payload.email : (payload.email as string[])?.[0] ?? ''
// ...
email: email || (payload.preferred_username as string) || sub
```

- **Primary identifier:** `sub` (OIDC subject)
- **Email:** `email` claim, or first element of `email[]`, or `preferred_username`, or `sub`
- **wrdesk_user_id:** Custom claim or `sub`

#### Multiple emails per account

- JWT can have `email` as string or array; code uses first element.
- No explicit handling of multiple addresses or aliases.
- `preferred_username` is a fallback; often an email in Keycloak.

#### Public identifier (DID, public key, org ID)

- **Ed25519 keys:** Generated per handshake/device in `generateSigningKeypair()`. Not pre-registered; initiator does not know receiver’s key before handshake.
- **No DID** in the current model.
- **No org/domain** in JWT; only `email`, `sub`, `preferred_username`, roles.

#### Identity in handshake record

```typescript
// types.ts
interface PartyIdentity {
  email: string;
  wrdesk_user_id: string;
  iss: string;
  sub: string;
}

interface HandshakeRecord {
  initiator: PartyIdentity;
  acceptor: PartyIdentity | null;
  receiver_email?: string | null;  // intended recipient (initiator side)
  // ...
}
```

- **Initiator:** Set at creation from session.
- **Acceptor:** Set when accept capsule is processed from `senderIdentity`.
- **receiver_email:** Intended recipient from initiate capsule; not enforced against acceptor.

---

## PART B — Design Options Analysis

### Option 1: Strict email match

**Mechanism:** Only the account whose SSO email matches `receiver_email` can see/accept.

**Implementation:** Add `session.email === record.receiver_email` (case-insensitive) in:
- Accept handler
- Import flow (before persist)
- `receiverBinding` pipeline step
- Optional: filter `handshake.list` for acceptor role

**Security:** Strong. Only the intended account can accept.

**Usability:** Risk of false rejections:
- Sender uses work email, SSO has personal
- Alias (e.g. `info@` vs `john@`)
- Typo in email
- Different normalization (e.g. `+`)

**Implementation complexity:** Low. A few checks in existing code paths.

**Compatibility:** Fits current architecture. No relay changes.

**Recommendation:** Implement with clear user-facing error and optional “email aliases” later.

---

### Option 2: Relay-routed with claim-based acceptance

**Mechanism:** Relay delivers to the specified email; receiver must prove control of that email (e.g. one-time code or signed link in an email).

**Current state:**
- Relay does **not** send emails. `sendCapsuleViaEmail` is in the Electron app and uses the user’s own email account.
- Initiate capsules are **rejected** by the relay.
- No “claim” or proof-of-email flow exists.

**Required changes:**
- Relay (or a new service) sends invitation emails.
- Invitation includes a one-time token or signed link.
- Receiver proves control by presenting that token when accepting.
- New state: e.g. PENDING_CLAIM → user proves email → PENDING_REVIEW.

**Security:** Strong. Requires email control.

**Usability:** Extra step; user must use the link/code.

**Implementation complexity:** High. New service or relay changes, token storage, new UI flow.

**Compatibility:** Requires new relay/email capabilities.

**Recommendation:** Good long-term design; treat as a later phase.

---

### Option 3: Open acceptance with identity disclosure + confirmation

**Mechanism:** Any account can accept, but initiator sees acceptor identity and must confirm. Flow: initiate → accept → **confirm** → active.

**State machine changes:**
- New state: e.g. `PENDING_CONFIRM` (or reuse `ACCEPTED` with a confirmation flag).
- Accept creates `ACCEPTED` or `PENDING_CONFIRM`.
- Initiator must call `handshake.confirmAccept(handshakeId)`.
- Only after confirm → `ACTIVE`.

**Required changes:**
- New RPC: `handshake.confirmAccept`
- Initiator UI: show acceptor identity, confirm/reject
- Acceptor: see “pending your confirmation” instead of active
- Relay: deliver confirm/reject capsules

**Security:** Medium. Initiator can reject wrong acceptor, but wrong acceptor can still see/attempt accept before rejection.

**Usability:** Extra step for initiator; more friction.

**Implementation complexity:** Medium. New state, RPC, UI, and messaging.

**Compatibility:** Works with current relay; accept/confirm are normal capsules.

**Recommendation:** Viable if strict match is too brittle; adds a human gate.

---

### Option 4: Organization/domain-level restriction

**Mechanism:** Acceptor must belong to the same domain as `receiver_email` (e.g. `@optimando.ai`).

**Current state:** JWT has no domain or org. Only `email` (and `preferred_username`). Domain can be derived from email (e.g. `user@domain.com` → `domain.com`).

**Implementation:** Extract domain from `receiver_email` and `session.email`, compare case-insensitively.

**Security:** Medium. Any user in the same domain can accept. Fine for org-level handshakes, weak for person-specific.

**Usability:** Good when targeting a team/org rather than a person.

**Implementation complexity:** Low. Domain extraction and comparison.

**Compatibility:** No relay changes.

**Recommendation:** Useful as an optional mode (e.g. “allow any @optimando.ai”) alongside strict match.

---

### Option 5: Public key / DID based addressing

**Mechanism:** Initiator uses receiver’s public key or DID; only the holder of the private key can accept.

**Current state:**
- Ed25519 keys are generated per handshake; not pre-registered.
- Initiator does not know receiver’s key before the handshake.
- No DID or key directory.

**Required changes:**
- Key directory or DID registry.
- Initiator looks up receiver by DID/key.
- Capsule addressed to that key; only matching key holder can accept.
- Possibly: Web of Trust or verified key directory.

**Security:** Strong. Cryptographic binding to the key.

**Usability:** Poor. Sender needs receiver’s key/DID; not human-friendly.

**Implementation complexity:** High. New infra and UX.

**Compatibility:** Significant changes to capsule and handshake model.

**Recommendation:** Future enhancement; not a near-term fix.

---

## Summary Comparison

| Option | Security | Usability | Complexity | Compatibility |
|--------|----------|-----------|-------------|---------------|
| 1. Strict email match | High | Medium (aliases) | Low | Full |
| 2. Claim-based | High | Medium | High | New infra |
| 3. Confirm by initiator | Medium | Medium | Medium | Full |
| 4. Domain restriction | Medium | High (org use) | Low | Full |
| 5. Public key/DID | High | Low | High | Major |

---

## Recommended Path

1. **Short term:** Implement **Option 1 (strict email match)** in accept handler, import flow, and `receiverBinding`. Add a clear error when the email does not match.
2. **Optional:** Add **Option 4 (domain mode)** as a policy (e.g. “allow any @domain.com”) for org-level handshakes.
3. **Later:** Consider **Option 2 (claim-based)** for high-assurance flows and **Option 3 (confirmation)** if strict match causes too many rejections.
4. **Future:** Explore **Option 5** for key-based addressing when directory/DID infra exists.
