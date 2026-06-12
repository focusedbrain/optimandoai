# Email setup UX — surfaces, triggers, and copy reference

_Last updated: 2026-06-12 (UX-1 D1–D6, UX-3 D1–D3 / copy audit pass; UX-2b D1–D4 / topology explainer, wizard, badges)_

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

---

## UX-2b surfaces (topology-aware setup paths + persistent explainer)

### Topology scenario matrix — `IngestionTopologyExplainer` (Deliverable 1)

The explainer is rendered inside / below every "Connected Email Accounts" section
(`EmailProvidersSection`). It is **non-dismissible** (orientation, not a notice) and is
**always visible** when an ingestion-status code and node role are available.  
Suppressed when `ingestionStatus` is `null` (extension / non-IPC surfaces).

| # | `code` | `thisNodeRole` | `hasAccounts` | Explainer copy | Status chip |
|---|--------|----------------|---------------|----------------|-------------|
| 1 | any except delegated/sandbox | `host` | false | "Connect an email account to send and receive mail on this device." | — |
| 2 | `OK_SINGLE_MACHINE` | `host` | true | _(suppressed — single-machine, no dual-setup wording)_ | — |
| 3 | `PAUSED_HOST_DELEGATED` | `host` | true | "You're using a sandbox device: this machine sends your mail, your sandbox receives it. To receive mail, a read-only email connection must be set up on the sandbox device." | Sandbox inbox: **set up ✓** (when `OK_SANDBOX_FETCHING`) · **not set up yet** (when `PAUSED_HOST_DELEGATED` / `ACTION_NEEDED_READ_CONSENT`) |
| 4 | `PAUSED_HOST_DELEGATED` | `host` | false | "You're using a sandbox device: set up your email here for sending. Receiving is set up separately on the sandbox device (read-only)." | — |
| 5 | `OK_SANDBOX_FETCHING` | `sandbox` | true | "This device receives mail for your workspace (read-only — it cannot send). Sending happens on your host device." | ✓ Inbox: receiving |
| 6 | `ACTION_NEEDED_READ_CONSENT` | `sandbox` | any | "Connect a read-only email account on this device to receive mail. Sending stays on your host device." | [Connect read-only account →] CTA |

**Tier-accuracy:** ✓ No microVM/hardware claims. "sandbox device" / "host device" are always peer-opaque.

**Component:** `IngestionTopologyExplainer` (`apps/extension-chromium/src/wrguard/components/IngestionTopologyExplainer.tsx`)

---

### 14 — Host send-only wizard intro (Trigger C)

| Field | Value |
|-------|-------|
| **Surface** | Full-screen wizard modal (Inbox / Bulk Inbox) |
| **Component** | `EmailConnectWizard` (`apps/extension-chromium/src/shared/components/EmailConnectWizard.tsx`) — `wizardMode='host_send_only'`, `intro` step |
| **Node** | Host |
| **Trigger** | `openConnectEmail()` called when `ingestionStatus.code === 'PAUSED_HOST_DELEGATED'` and `thisNodeRole === 'host'` (wired via `useConnectEmailFlow`) |
| **Dismissal** | Cancelable at any step; does not reopen automatically |

**Copy (intro step):**

> **Set up outbound mail**
>
> Your sandbox fetches inbound mail. Set up outbound mail here (send only).
> To receive mail, use Connect Email on your sandbox device.
>
> [Cancel]  [Continue →]

**Copy (provider step, host_send_only mode):**

> **Choose your mail provider**
>
> This account will be used for **sending only**.
> Inbound mail is handled by your sandbox device.

**Tier-accuracy:** ✓ "sandbox device" — no implementation claim.

---

### 15 — Sandbox connect-email routing (Trigger C, sandbox side)

| Field | Value |
|-------|-------|
| **Component** | `useConnectEmailFlow` (`apps/extension-chromium/src/shared/email/connectEmailFlow.tsx`) |
| **Node** | Sandbox |
| **Trigger** | `openConnectEmail()` called when `thisNodeRole === 'sandbox'` (any code); `onOpenSandboxReadConsent` provided |
| **Behaviour** | Calls `onOpenSandboxReadConsent()` directly — opens `SandboxReadConsentWizard` (entry #5–8 above) instead of `EmailConnectWizard`. No intermediate modal. |

---

### Account-row sync-mode badges (Deliverable 4)

Rendered inside each OAuth account row in `EmailProvidersSection` via `RemoteSyncBadge`.
`ingestionStatus` is threaded from the section-level prop.

| Condition | Badge text | Tooltip |
|-----------|-----------|---------|
| `processingPaused === true` (any topology) | `⏸ Sync paused` | "Mail sync is paused — click Resume to fetch mail again." |
| `code === 'PAUSED_HOST_DELEGATED'` + `thisNodeRole === 'host'` | **Outbound only** | "Inbound mail is fetched on your sandbox device" |
| `thisNodeRole === 'sandbox'` | **Inbound (read-only)** | "This device only receives mail (read-only). Sending is done on the host device." |
| Single-machine / `ingestionStatus` null | `🟢 Smart Sync` | — |
| IMAP accounts (any topology) | `🟢 Pull & Classify` | "IMAP: fetch mail and classify locally." |

**Suppression:** IMAP accounts never receive topology badges (they are not A2 split participants). Single-machine rows are unchanged.

---

### UX-2b suppression rules

| Surface | Condition for suppression |
|---------|--------------------------|
| `IngestionTopologyExplainer` | `ingestionStatus` prop is `null` / not passed (extension / non-IPC mount sites) |
| `IngestionTopologyExplainer` scenarios 1 & 2 | Single-machine or no accounts: no dual-setup wording shown |
| Topology account badges | `ingestionStatus` null → falls back to `🟢 Smart Sync` / `🟢 Pull & Classify` |
| Host send-only wizard intro | `ingestionStatus.code !== 'PAUSED_HOST_DELEGATED'` on host → default wizard (no intro step) |
| Sandbox routing shortcut | `onOpenSandboxReadConsent` not provided → default `EmailConnectWizard` (extension contexts without IPC) |

---

### UX-2b IPC additions

| Channel | Direction | Payload | Consumer |
|---------|-----------|---------|----------|
| `email:connectSendAccount` | renderer → main | `{ provider: 'gmail' \| 'outlook'; displayName?: string }` | `EmailConnectWizard` (`host_send_only` mode connecting step) |

**`email:connectSendAccount` invariants:**
- Calls `connectSendClient` (host-only — throws if called from a sandbox node).
- Scope invariant guard: planned send scopes must not include any read scope (`scopeSetCanRead` on `plannedScopesForRole`).
- Registered account has no `oauth` field (gateway row); token lives in `roleScopedTokenStore` role=`'send'`.
- Outbound send path (`gateway.sendEmail`) bridges send-role token as synthetic `oauth` config before `provider.connect()`, mirroring the `sandboxEmailFetch.ts` read bridge (see Deliverable 3).
- Token refresh writes back to `roleScopedTokenStore` role=`'send'`, not to `persistEmailAccounts`.

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
| **IngestionTopologyExplainer (UX-2b D1)** | **Non-dismissible** — persistent orientation copy | — |
| **Host send-only wizard (UX-2b D2, Trigger C)** | Cancelable; re-opens each time `openConnectEmail()` is called | — |
| **Account-row badges (UX-2b D4)** | Live (no dismissal; driven by `ingestionStatus` poll) | — |

---

## IPC events (main → renderer)

| Channel | Payload | Consumer |
|---------|---------|----------|
| `topology:ingestionDelegated` | `{ handshakeId }` | `useTopologyDelegationModal` → `IngestionDelegationModal` |
| `topology:handshakeRevoked` | `{ handshakeId, hasAccounts }` | `useRevocationBanner` → `RevocationNoticeBanner` |
| `topology:sandboxReadCleanupHint` | `{ handshakeId, readAccounts: [{ accountId, email, provider }] }` | `useSandboxReadCleanupHint` → `SandboxReadCleanupHint` |

## IPC calls (renderer → main)

| Channel | Payload | Consumer |
|---------|---------|----------|
| `email:getIngestionStatus` | `{ accountIds?: string[] }` | `useIngestionStatus` hook → `IngestionTopologyExplainer`, `IngestionStatusBanner`, badges |
| `email:connectReadAccount` | `{ provider, displayName? }` | `SandboxReadConsentWizard` (UX-1 Trigger B) |
| `email:connectSendAccount` | `{ provider, displayName? }` | `EmailConnectWizard` in `host_send_only` mode (UX-2b Trigger C) |
| `email:deleteReadToken` | `accountId` | `SandboxReadCleanupHint` (UX-3) |

---

---

## Sandbox viewport rules (Build B — CloneInboxView)

_Added: 2026-06-12 (Build B — Sandbox Viewport UI)_

### What the sandbox shows — and never shows

A node in `sandbox` mode is **not a mail client**. Its inbox role is limited to:

1. **Receiving BEAP clones** sent by the host (rows where `depackaged_metadata.inbox_response_path.sandbox_clone === true`).
2. **Responding to those clones** via the existing `original_response_path` / `reply_transport` reply path.
3. **Configuring the read-only email account** that lets it fetch mail for delivery to the host.

The sandbox **never shows**:

| Surface | Why suppressed |
|---------|----------------|
| `EmailInboxBulkView` / ⚡ bulk-mode toggle | Bulk triage is a host-side action; sandbox has no canonical inbox |
| `EmailInboxSyncControls` | Sandbox does not manage its own sync window |
| `EmailProvidersSection` | Full provider management is host-side |
| `SyncFailureBanner` | Sync is not the sandbox's concern |
| `IngestionDelegationModal` | Delegation flow is host→sandbox, not relevant on sandbox |
| ✉ compose / BEAP compose nav shortcuts | Sandbox cannot originate mail or BEAP messages |
| Connect-email first-run CTA | Replaced by "Awaiting pairing" on orphaned sandbox; `SandboxReadConsentWizard` is the correct entry point |

**Non-feature (by design):** There is no "use sandbox as full inbox" option. A sandbox-role node is a mail processor, not a viewer. If you need to read your mail, use the host.

---

### Clone Inbox — component and filter

**Component:** `CloneInboxView` (`src/components/CloneInboxView.tsx`)

Rendered in `App.tsx` when `isSandbox === true` for the `beap-inbox` view, replacing both `EmailInboxView` and `EmailInboxBulkView`.

**Clone filter:** Client-side, applied to `allMessages` from `useEmailInboxStore`:

```typescript
depackaged_metadata?.inbox_response_path?.sandbox_clone === true
```

Quarantine-clone rows (`sandbox_clone_quarantine`) live in `quarantine_messages` (separate table) and do not produce displayable inbox rows — no filter adjustment needed.

**Header subtext (exact copy):**

> Cloned messages from your host for safe viewing and testing. Your mail lives on the host device.

---

### Processing console (D3)

Shown at the top of the Clone Inbox **only when paired** (`!orphanedSandbox`). Driven entirely by the existing `useIngestionStatus` hook — no new IPC.

| Field | Source | Notes |
|-------|--------|-------|
| Status | `status.code` mapped to plain words (see below) | Tier-accurate — no microVM/hardware claims |
| Delivered to host | `Σ accounts[i].lastPollDelivered` | Cumulative across all accounts |
| Held | `Σ accounts[i].lastPollHeld` | Only shown when `> 0` |
| Last check | `max(accounts[i].lastPollAt)` formatted as relative time | "just now" / "Xm ago" / etc. |

**Status code → plain words mapping:**

| `IngestionStatusCode` | Displayed as |
|-----------------------|--------------|
| `OK_SANDBOX_FETCHING` | Processing normally |
| `OK_SINGLE_MACHINE` | Processing normally |
| `DEGRADED_HELD_MESSAGES` | Processing normally _(held count shown separately)_ |
| `ACTION_NEEDED_READ_CONSENT` | Read consent needed |
| `PAUSED_SANDBOX_UNREACHABLE` | Provider unreachable |
| `PAUSED_HOST_DELEGATED` | Provider unreachable |
| _(null / loading)_ | Checking… |

**Tier-accuracy:** ✓ No microVM/hardware claims. "Processing normally" / "provider unreachable" describe observable behaviour, not implementation.

---

### Orphaned sandbox empty state (D4)

**Condition:** `isSandbox && !ledgerProvesInternalSandboxToHost && ready` (`orphanedSandbox`).

**Where applied:**
- `CloneInboxView` — replaces the entire view content
- `BeapInboxDashboard` first-run block — replaces `BeapInboxFirstRun` (connect-email CTA)

**Exact copy:**

> Awaiting pairing — complete the internal handshake with your host device to start processing mail.

**Invariant:** A sandbox-role node **never** shows the connect-email CTA (`BeapInboxFirstRun`) or reverts to a full mail-client experience, regardless of pairing state.

---

### Host chip rename (D5)

`EmailInboxToolbar.tsx` — host-side action chip shown when a paired sandbox is detected:

| Before | After | Rationale |
|--------|-------|-----------|
| `Sandbox` | `Send to Sandbox` | Clarifies this is an action (clone to sandbox), not the sandbox node's own identity |
| `Sandbox (setup)` | `Sandbox setup` | Removes parentheses; consistent with renamed active chip |

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

- **Bundled-'all' scope purity (UX-2b D3)** — Accounts connected before the A2 split (bundled
  OAuth `all`-scope client) hold a read+send scope. They are excluded from the D3 send bridge
  (they retain the `account.oauth` path), so they continue to work unchanged. The semantic
  contradiction (host account holds read scope after delegation) is documented in `DEFERRED.md`
  and is not surfaced to the user.

- **Send consent symmetric guard** — `runRoleScopedConsent` warns (does not throw) if the OAuth
  server returns a read scope for a send consent. The IPC handler's planned-scope guard
  (`scopeSetCanRead` on `plannedScopesForRole`) prevents this in production; the server-side
  case is documented in the `roleAwareConsent.test.ts` "Trigger-C bad grant" test.

- **IMAP send-role bridge** — `gateway.sendEmail` only bridges `roleScopedTokenStore` for
  `gmail` and `microsoft365` providers. IMAP accounts always use full `account.smtp` credentials
  and are not A2 split participants; no IMAP send bridge is needed.

- **`IngestionTopologyExplainer` on extension surfaces** — `popup-chat.tsx` and
  `WRGuardWorkspace.tsx` mount `EmailProvidersSection` without `ingestionStatus` (IPC not
  available in those extension contexts). The explainer is suppressed (`null` prop); no
  topology messaging appears in the extension popup. Considered acceptable for current tier.
