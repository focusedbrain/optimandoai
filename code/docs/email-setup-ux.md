# Email setup UX — surfaces, triggers, and copy reference

_Last updated: 2026-06-12 (UX-1 D1–D6, UX-3 D1–D3 / copy audit pass)_

This document is the **single source of truth for all user-facing copy** introduced in the
multi-machine email ingestion UX (Prompts 1–5 engineering, UX-1/UX-3 build prompts). It
exists so that future copy changes have a reference point and can be reviewed for
consistency without re-reading the implementation.

---

## Terminology standards (enforced)

| Concept | Canonical term | Notes |
|---------|---------------|-------|
| The host machine | **host** / **Host** (in beat headers) | Never "master", "main device", "server" |
| The paired sandbox machine | **sandbox device** (from host POV) / **this device** (from sandbox POV) | Never "microVM", "virtual machine", "disposable device", "separate hardware" — those claims are gated on the paid microVM tier (currently unproven, per `DEFERRED.md`) |
| Email account being connected | **email account** | Never "mail account" as a noun; "mail" OK as uncountable noun in phrases ("inbound mail", "fetch mail", "cannot send mail") |
| The account that fetches mail on sandbox | **read-only email account** | Never "IMAP account", "read client", or "sandbox account" in UI |
| The account that sends from host | **existing account** (in revoke context) | Never "send client" in UI |
| WR Desk's inbox (host side) | **BEAP inbox** | Used only in the handshake-dialog beat; never in end-user status copy |
| Inbound mail flow direction | **Inbound mail** | Never "incoming messages", "email ingestion" in UI |

**Tier-accuracy rule (all tiers):** Do not claim microVM, crosvm, disposable sandbox, or
separate hardware in any user-facing string on the current path. These claims are reserved
for the paid microVM tier and are blocked by `OutlookOpaqueUnprovenError` / `DEFERRED.md`
until the rig proof is complete.

---

## Copy table

Each row: **#** · **Surface** · **Component** · **Node** · **Trigger condition** · **Exact copy** · **Tier-accuracy** · **Dismissal**

---

### 1 — Host migration modal (Trigger A)

| Field | Value |
|-------|-------|
| **Surface** | Full-screen modal (inbox view) |
| **Component** | `IngestionDelegationModal` (`src/components/IngestionDelegationModal.tsx`) |
| **Node** | Host |
| **Trigger** | `topology:ingestionDelegated` IPC event — fires once after `autoWireTopologyForHandshake` succeeds on the host AND the host has ≥1 connected email account |
| **One-time guard** | `localStorage['wr.ingestionDelegation.dismissed.<handshakeId>']` |

**Copy:**

> **Your sandbox is now connected.**
>
> Inbound mail is now fetched on your sandbox device — connect a read-only email account
> there to resume receiving mail.
>
> Sending from this device is unchanged and keeps working.
>
> [Got it]

**Tier-accuracy:** ✓ No microVM/hardware claims. "sandbox device" is the opaque peer — no implementation claim.

---

### 2 — Persistent ingestion banner — read consent needed (Trigger B pre-condition)

| Field | Value |
|-------|-------|
| **Surface** | Amber strip above message list |
| **Component** | `IngestionStatusBanner` (`src/components/IngestionStatusBanner.tsx`) — `ACTION_NEEDED_READ_CONSENT` |
| **Node** | Shown on sandbox (banner visible when `status.code === 'ACTION_NEEDED_READ_CONSENT'`) |
| **Trigger** | `email:getIngestionStatus` returns `ACTION_NEEDED_READ_CONSENT` (sandbox owns ingestion, no read token present) |
| **Dismissal** | Persistent until status code changes; not manually dismissible |

**Copy:**

> **Inbound mail is paused**
>
> Connect a read-only email account on your sandbox device to resume receiving mail.
>
> [Connect now] ← CTA shown only when `thisNodeRole === 'sandbox'`

**Tier-accuracy:** ✓ No microVM/hardware claims.

---

### 3 — Persistent ingestion banner — sandbox unreachable

| Field | Value |
|-------|-------|
| **Surface** | Amber strip above message list |
| **Component** | `IngestionStatusBanner` — `PAUSED_SANDBOX_UNREACHABLE` |
| **Node** | Host |
| **Trigger** | `email:getIngestionStatus` returns `PAUSED_SANDBOX_UNREACHABLE` |
| **Dismissal** | Persistent until status code changes |

**Copy:**

> **Inbound mail is paused**
>
> Your sandbox device is unreachable. Check that it is online and the handshake is active.

**Tier-accuracy:** ✓

---

### 4 — Persistent ingestion banner — held messages (degraded)

| Field | Value |
|-------|-------|
| **Surface** | Softer amber strip above message list |
| **Component** | `IngestionStatusBanner` — `DEGRADED_HELD_MESSAGES` |
| **Node** | Host |
| **Trigger** | `email:getIngestionStatus` returns `DEGRADED_HELD_MESSAGES` |
| **Dismissal** | Persistent until status code changes |

**Copy:**

> **Some messages were held**
>
> Some messages were held for review on your sandbox. Check the sandbox device for details.

**Tier-accuracy:** ✓ "sandbox" is the peer device; no implementation details.

---

### 5 — Sandbox read-consent wizard — intro (Trigger B)

| Field | Value |
|-------|-------|
| **Surface** | Full-screen modal wizard (inbox view) |
| **Component** | `SandboxReadConsentWizard` (`src/components/SandboxReadConsentWizard.tsx`) — `intro` step |
| **Node** | Sandbox |
| **Trigger** | `ACTION_NEEDED_READ_CONSENT` + `thisNodeRole === 'sandbox'`; opened via banner CTA ("Connect now") or `useSandboxReadConsent` hook |

**Copy:**

> **Connect a read-only email account**
>
> Connect a read-only email account on this device so WR Desk can fetch mail safely.
> This connection cannot send mail, and credentials stay only on this device.
>
> [Cancel]  [Choose provider]

**Tier-accuracy:** ✓ "this device" — no microVM/hardware claim.

---

### 6 — Sandbox read-consent wizard — provider pick

| Field | Value |
|-------|-------|
| **Component** | `SandboxReadConsentWizard` — `providerPick` step |
| **Node** | Sandbox |

**Copy:**

> **Choose your mail provider**
>
> [Gmail — Sign in with Google — read-only access]
> [Outlook / Microsoft 365 — Sign in with Microsoft — read-only access]
>
> [Cancel]

---

### 7 — Sandbox read-consent wizard — connecting

| Field | Value |
|-------|-------|
| **Component** | `SandboxReadConsentWizard` — `connecting` step |
| **Node** | Sandbox |

**Copy:**

> **Opening sign-in…**
>
> Complete the sign-in in your browser. Only read access is requested — no mail will be sent.

---

### 8 — Sandbox read-consent wizard — success

| Field | Value |
|-------|-------|
| **Component** | `SandboxReadConsentWizard` — `success` step |
| **Node** | Sandbox |

**Copy:**

> **Read account connected**
>
> WR Desk will begin fetching mail on this device on the next sync tick.
>
> [Done]

---

### 9 — Revoke transition banner — happy path (Trigger D, host has account)

| Field | Value |
|-------|-------|
| **Surface** | Indigo-tinted strip above message list |
| **Component** | `RevocationNoticeBanner` (`src/components/RevocationNoticeBanner.tsx`) — `hasAccounts: true` |
| **Node** | Host |
| **Trigger** | `topology:handshakeRevoked` IPC event, `hasAccounts=true` (host has ≥1 active email account at revoke time) |
| **Dismissal** | Manually dismissible; auto-expires after **24 hours** (persisted in `localStorage['wr.revokeNotice.<handshakeId>']`) |

**Copy:**

> **Sandbox unlinked.**
>
> Inbound mail is fetched on this device again using your existing account.
> No extra setup needed if your connection is still active.  [✕]

**Tier-accuracy:** ✓ "Sandbox unlinked" — no microVM/hardware claim.

---

### 10 — Revoke transition banner — no-account edge (Trigger D, host has no account)

| Field | Value |
|-------|-------|
| **Surface** | Indigo-tinted strip above message list |
| **Component** | `RevocationNoticeBanner` — `hasAccounts: false` |
| **Node** | Host |
| **Trigger** | `topology:handshakeRevoked`, `hasAccounts=false` (sandbox-first user who never set up a host email account) |
| **Dismissal** | Same 24h TTL |

**Copy:**

> **Sandbox unlinked.**
>
> To receive inbound mail on this device, connect an email account here.  [✕]

**Tier-accuracy:** ✓

---

### 11 — Sandbox read-cleanup hint (Trigger D, sandbox side)

| Field | Value |
|-------|-------|
| **Surface** | Amber-tinted strip above message list |
| **Component** | `SandboxReadCleanupHint` (`src/components/SandboxReadCleanupHint.tsx`) |
| **Node** | Sandbox |
| **Trigger** | `topology:sandboxReadCleanupHint` IPC event — fires on sandbox when handshake is revoked (both local-user and remote-capsule paths) AND sandbox has ≥1 account with an orphaned read token |
| **Dismissal** | One-time forever (no TTL; `localStorage['wr.sandboxReadCleanupHint.dismissed.<handshakeId>']`) |

**Copy:**

> **Read-only mail connection no longer in use**
>
> Your read-only connection for **{email}** is no longer used.
> Not removing it is fine — it cannot send mail. You can remove it from this device
> and revoke access in your provider's account settings.
>
> [Remove from this device]  [Google Account security page ↗ / Microsoft account security settings ↗]  [✕]

Provider links:
- Gmail → `https://myaccount.google.com/permissions`
- Microsoft 365 / Outlook → `https://account.microsoft.com/privacy/app-access`

**Action semantics:** "Remove from this device" calls `deleteRoleScopedTokens(accountId, 'read')` (token file only; gateway row kept; orphaned-poll noise is DEFERRED).

**Tier-accuracy:** ✓ No microVM/hardware claims.

---

### 12 — Handshake dialog — Host beat 2 ("What to expect next")

| Field | Value |
|-------|-------|
| **Surface** | Expandable beat block inside `InitiateHandshakeDialog` |
| **Component** | `InitiateHandshakeDialog.tsx` in `apps/extension-chromium` |
| **Node** | Host (shown when `isInternal && deviceRole === 'host'`) |
| **Trigger** | User opens "Initiate handshake" dialog in internal mode on the host |

**Copy:**

> **What to expect next (Host):** When the handshake activates you will see a notice that
> inbound mail has moved to your sandbox device. **Sending from this Host continues
> unchanged.** No extra email setup is needed here — the sandbox user will be prompted on
> their device to connect a read-only account.

**Tier-accuracy:** ✓ "sandbox device" = opaque peer. No microVM/hardware claim.

---

### 13 — Handshake dialog — Sandbox beat 2 ("What to expect next")

| Field | Value |
|-------|-------|
| **Surface** | Expandable beat block inside `InitiateHandshakeDialog` |
| **Component** | `InitiateHandshakeDialog.tsx` in `apps/extension-chromium` |
| **Node** | Sandbox (shown when `isInternal && deviceRole === 'sandbox'`) |
| **Trigger** | User opens "Initiate handshake" dialog in internal mode on the sandbox |

**Copy:**

> **What to expect next (Sandbox):** After the handshake activates, you will be prompted to
> connect a **read-only** email account on this device so WR Desk can fetch mail safely.
> That account **cannot send mail** — credentials stay only on this device. Your BEAP inbox
> and outbound mail remain on the Host.

**Tier-accuracy:** ✓ "this device" (no Sandbox capitalization in flowing body copy). "BEAP inbox" is accurate (it is literally the BEAP inbox on the Host).

---

## Copy audit results (2026-06-12)

### Issues found and fixed

| # | File | Old string | New string | Rationale |
|---|------|-----------|-----------|-----------|
| A | `IngestionDelegationModal.tsx` | "read-only **mail** account" | "read-only **email** account" | Standardize noun to "email account" |
| B | `IngestionStatusBanner.tsx` ACTION_NEEDED detail | "read-only **mail** account on your sandbox device" | "read-only **email** account on your sandbox device" | Same standard |
| C | `SandboxReadConsentWizard.tsx` intro title | "Connect a read-only **mail** account" | "Connect a read-only **email** account" | Title/body disagreement — body already used "email account" |
| D | `SandboxReadConsentWizard.tsx` intro body | "credentials stay only on **this sandbox**" | "credentials stay only on **this device**" | Canonical same-device address is "this device"; "sandbox" is a peer's name not a self-reference |
| E | `InitiateHandshakeDialog.tsx` sandbox beat | "credentials stay only on this **Sandbox** device" | "credentials stay only on **this device**" | Mid-sentence capital S incorrect; simplified to match D |

### Issues NOT present (confirmed clean)

- No surface claims microVM, crosvm, disposable device, or separate hardware ✓
- No surface exposes BEAP in end-user status copy (only in handshake-dialog technical beat) ✓
- No surface leaks `roleScopedTokenStore`, `connectReadClient`, or internal function names ✓
- "read-only" consistently hyphenated ✓
- "inbound mail" consistently lowercase ✓
- "sandbox device" consistently lowercase in flowing copy ✓

---

## Silence map (states with no banner)

| Status code | Why silent |
|-------------|-----------|
| `OK_SINGLE_MACHINE` | Healthy single-machine; no topology noise needed |
| `OK_SANDBOX_FETCHING` | Sandbox working; no user action needed |
| `PAUSED_HOST_DELEGATED` | Transient waiting state; action ("connect sandbox account") only possible on sandbox device |

---

## Dismissal / persistence summary

| Surface | Dismissal type | Storage key |
|---------|---------------|-------------|
| Host migration modal (Trigger A) | One-time per `handshakeId` | `wr.ingestionDelegation.dismissed.<id>` |
| IngestionStatusBanner | Persistent (auto-clears when status code changes) | — |
| Revoke transition banner (Trigger D host) | 24-hour TTL, manually dismissible | `wr.revokeNotice.<id>` (`{ revokedAt, hasAccounts, dismissed }`) |
| Sandbox read-cleanup hint (Trigger D sandbox) | One-time forever | `wr.sandboxReadCleanupHint.dismissed.<id>` |
| Sandbox read-consent wizard (Trigger B) | Closes on action/cancel; re-opens via "Connect now" CTA | — |

---

## IPC events (main → renderer)

| Channel | Payload | Consumer |
|---------|---------|----------|
| `topology:ingestionDelegated` | `{ handshakeId }` | `useTopologyDelegationModal` → `IngestionDelegationModal` |
| `topology:handshakeRevoked` | `{ handshakeId, hasAccounts }` | `useRevocationBanner` → `RevocationNoticeBanner` |
| `topology:sandboxReadCleanupHint` | `{ handshakeId, readAccounts: [{ accountId, email, provider }] }` | `useSandboxReadCleanupHint` → `SandboxReadCleanupHint` |

---

## Known gaps (DEFERRED)

- **Remote-capsule revoke (`enforcement.ts`)** — `removeTopologyForHandshake` is not called when
  the sandbox processes an inbound `handshake-revoke` capsule from the host. Host continues
  delegating ingestion until cold restart or local force-revoke. Trigger D (host banner) also
  does not fire for remote-capsule revokes. See `DEFERRED.md` → "UX-3 / Revocation — gaps".

- **Orphaned read-poll noise** — After the sandbox's read token is deleted (via the cleanup
  hint), the gateway account row remains and the sync loop may generate HELD rows until the
  app is restarted or the row is pruned. Copy correctly advises the user that removing is
  optional; the noise is a P3 backend issue tracked in `DEFERRED.md`.
