# Post-Flight Verification Report

Independent read-only audit of the codebase at `code/apps/electron-vite-project` (and related paths). Evidence is quoted from the repository as it exists now, with file paths relative to `code/`.

---

## Verification 1: Gmail Auto-Sync

### Check 1.1 — `mirrorGlobalAutoSyncToNewAccount` in connect handlers

| Handler | Calls mirror before `{ ok: true }`? | Evidence |
|---------|-------------------------------------|----------|
| `email:connectGmail` | Yes | Lines 789–791 |
| `email:connectOutlook` | Yes | Lines 868–870 |
| `email:connectZoho` | Yes | Lines 914–916 |
| `email:connectImap` | Yes | Lines 958–960 |

Additional handler (not in the “four providers” table but present): `email:connectCustomMailbox` also calls mirror at lines 976–978.

**Gmail (surrounding 5 lines):**

```785:791:apps/electron-vite-project/electron/main/email/ipc.ts
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectGmail error:', error)
```

**Outlook:**

```867:870:apps/electron-vite-project/electron/main/email/ipc.ts
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
```

**Zoho:**

```913:916:apps/electron-vite-project/electron/main/email/ipc.ts
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
```

**IMAP:**

```957:960:apps/electron-vite-project/electron/main/email/ipc.ts
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
      return { ok: true, data: account }
```

| Check | Result | Evidence |
|-------|--------|----------|
| 1.1 mirrorGlobalAutoSyncToNewAccount in all handlers | **PASS** | All four required handlers include the call; `connectCustomMailbox` also mirrors. |

---

### Check 1.2 — `gmailOAuthClientSecret` persisted on connect

The OAuth object includes `gmailOAuthClientSecret` when `gmailOAuthClientSecretToStore` is truthy. Value is **`secretFromTokens ?? secretFromResolved`**: token-exchange payload first, then **`resolved.clientSecret`**.

```1453:1470:apps/electron-vite-project/electron/main/email/gateway.ts
    const secretFromTokens =
      typeof tokens.gmailOAuthClientSecret === 'string' && tokens.gmailOAuthClientSecret.trim()
        ? tokens.gmailOAuthClientSecret.trim()
        : undefined
    const secretFromResolved =
      resolved.clientSecret && String(resolved.clientSecret).trim()
        ? String(resolved.clientSecret).trim()
        : undefined
    const gmailOAuthClientSecretToStore = secretFromTokens ?? secretFromResolved
    const oauth: NonNullable<EmailAccountConfig['oauth']> = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scope: typeof tokens.scope === 'string' ? tokens.scope : '',
      oauthClientId: resolved.clientId,
      gmailRefreshUsesSecret: resolved.authMode === 'legacy_secret',
      ...(gmailOAuthClientSecretToStore ? { gmailOAuthClientSecret: gmailOAuthClientSecretToStore } : {}),
    }
```

| Check | Result | Evidence |
|-------|--------|----------|
| 1.2 gmailOAuthClientSecret persisted | **PASS** | Spread includes `gmailOAuthClientSecret` from tokens or resolved `clientSecret`. |

---

### Check 1.3 — Gmail token refresh and `client_secret`

- **Stored account:** `secretFromAccount = stored?.gmailOAuthClientSecret?.trim() ?? ''`.
- **Fallback:** If `refreshClientSecret` is still empty, loops `resolveBuiltinGoogleOAuthClientWithMeta` (standard + default) and uses `resolveBuiltinGoogleOAuthClientSecret(meta)` when `meta.clientId === clientId`.
- **POST body:** `URLSearchParams` with `client_id`, `refresh_token`, `grant_type`; **`if (refreshClientSecret) { body.set('client_secret', refreshClientSecret) }`**.

```1119:1166:apps/electron-vite-project/electron/main/email/providers/gmail.ts
    const secretFromAccount = stored?.gmailOAuthClientSecret?.trim() ?? ''
    let refreshClientSecret = secretFromVault || secretFromAccount || undefined
    // ... builtin fallback block ...
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token',
      })
      if (refreshClientSecret) {
        body.set('client_secret', refreshClientSecret)
      }
```

If no secret is found anywhere, **`client_secret` is omitted** from the body (Google may reject); this is explicit, not a silent in-app swallow—**WARNING** only if the bar is “must never omit for Desktop PKCE”: omission remains possible when id/secret cannot be resolved.

| Check | Result | Evidence |
|-------|--------|----------|
| 1.3 Refresh has client_secret | **PASS** | Account, vault, builtin fallback; `client_secret` set when `refreshClientSecret` is truthy. |
|  | *(optional)* | **WARNING** if requirement is “always send secret”: path can still omit when all sources empty. |

---

### Check 1.4 — No accidental damage to existing flows

| Item | Status | Evidence |
|------|--------|----------|
| `email:connectImap` still calls mirror | **PASS** | Lines 958–960 (quoted under 1.1). |
| `broadcastInboxSnapshotAfterSync` in auto-sync callback | **PASS** | `startStoredAutoSyncLoopIfMissing` passes `(r, e) => broadcastInboxSnapshotAfterSync(r, e)` at lines 430–435. |
| Brute-force IMAP interval still broadcasts after sync | **PASS** | Lines 400–401, 404–405 call `broadcastInboxSnapshotAfterSync(result)` / `(null, err)`. |
| Microsoft 365 / `outlook.ts` | **PASS (scope)** | This audit did not modify `outlook.ts`. `gateway.listMessages` for non-IMAP still uses `getConnectedProvider` + `fetchMessages` immediately after the IMAP branch (lines 913–916)—unchanged structure in the reviewed section. |

| Check | Result | Evidence |
|-------|--------|----------|
| 1.4 No accidental damage | **PASS** | IMAP connect + auto-sync broadcast wiring intact; OAuth list path unchanged adjacent to IMAP branch. |

---

## Verification 2: IMAP Diagnostics

### Check 2.1 — Diagnostics in `listMessages` IMAP branch

| Log point | Present? | Location |
|-----------|----------|----------|
| Entry (`listMessages start`, host, port, password flags) | Yes | Lines 855–865 |
| After credentials assert | Yes | Line 867 |
| After `connect` (elapsed) | Yes | Line 873 |
| After `fetchMessages` (count + elapsed) | Yes | Lines 877–884 |
| Error (`FAILED after`, message/code/source) | Yes | Lines 897–903 |

```855:904:apps/electron-vite-project/electron/main/email/gateway.ts
      console.log('[IMAP-DIAG] listMessages start:', {
        accountId: account.id,
        email: account.email,
        host: account.imap?.host,
        port: account.imap?.port,
        security: account.imap?.security,
        hasPassword: !!(account.imap?.password && String(account.imap.password).trim().length > 0),
        passwordLength: String(account.imap?.password ?? '').length,
        encrypted: account.imap?._encrypted,
        folder,
      })
      assertImapCredentialsUsableForConnect(account)
      console.log('[IMAP-DIAG] Credentials check passed for:', account.id)
      // ...
        console.log('[IMAP-DIAG] Connected in', Date.now() - connectStart, 'ms for:', account.id)
        // ...
        console.log(
          '[IMAP-DIAG] Fetched',
          rawMessages.length,
          'messages in',
          Date.now() - fetchStart,
          'ms for:',
          account.id,
        )
      } catch (err: any) {
        console.error('[IMAP-DIAG] FAILED after', Date.now() - connectStart, 'ms for:', account.id, {
          error: err?.message,
          code: err?.code,
          source: err?.source,
        })
```

| Check | Result | Evidence |
|-------|--------|----------|
| 2.1 Diagnostic logs in listMessages | **PASS** | Entry, connect, fetch, and error paths exceed “entry + error” minimum. |

---

### Check 2.2 — Brute-force polling

```381:398:apps/electron-vite-project/electron/main/email/ipc.ts
const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000
// ...
        for (const acc of accounts) {
          if (acc.provider !== 'imap' || acc.status !== 'active') continue
          if (acc.processingPaused === true) continue
          console.log('[IMAP-AUTO-SYNC] Triggering pull for IMAP account:', acc.id, acc.email)
          console.log('[IMAP-AUTO-SYNC] Account status:', acc.status, 'processingPaused:', acc.processingPaused)
```

| Check | Result | Evidence |
|-------|--------|----------|
| 2.2 Brute-force polling diagnostic | **PASS** | Interval `2 * 60 * 1000`; filters `imap` + `active` + not `processingPaused`; extra status log at 398. |

---

### Check 2.3 — No changes to IMAP core logic / timeouts / provider

| Item | Result | Notes |
|------|--------|-------|
| `SYNC_ACCOUNT_EMAILS_MAX_MS = 300_000` | **PASS** | `syncOrchestrator.ts` line 302. |
| `IMAP_SYNC_LIST_MESSAGES_MS = 45_000` (etc.) | **PASS** | `imapSyncTelemetry.ts` lines 7–21. |
| `imap.ts` | **PASS** | `git diff d8819047..HEAD` on `providers/imap.ts` is empty (no changes in that range). |
| `decryptImapSmtpPasswords` / map callback | **PASS** | `git diff` on `gateway.ts` shows `loadAccounts` wrapper + `listMessages` + `connectGmailAccount` only; **`decryptImapSmtpPasswords` function body not in the diff**. |

| Check | Result | Evidence |
|-------|--------|----------|
| 2.3 No core logic changes | **PASS** | Timeouts and `imap.ts` unchanged in sampled git range; decrypt helper not altered by shown diff. |

---

## Verification 3: Inbox Bulk View Scroll

### Check 3.1 — Root scroll

```1801:1812:apps/electron-vite-project/src/App.css
.bulk-view-root {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f1f3f5;
  color: #1e293b;
}
```

| Check | Result | Evidence |
|-------|--------|----------|
| 3.1 Root overflow-y: auto | **PASS** | `overflow-y: auto`; not `hidden`. |

---

### Check 3.2 — Inner content scroll

```2796:2802:apps/electron-vite-project/src/App.css
.bulk-view-content {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  overflow: visible;
  padding: 24px 28px;
}
```

| Check | Result | Evidence |
|-------|--------|----------|
| 3.2 Content overflow removed | **PASS** | `overflow: visible`, `flex: 0 0 auto`, no `overflow-y: auto` on `.bulk-view-content`. |

**Note:** `.bulk-view-content-message` still has `overflow-y: auto` (lines 2805–2808) for empty/loading/error panes—a secondary scroll region inside the main page scroll, not the old “whole list” scrollport.

---

### Check 3.3 — IntersectionObserver ref

Ref is on **`.bulk-view-root`**, not on `.bulk-view-content`:

```4205:4207:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
  return (
    <div className={`bulk-view-root ${bulkCompactMode ? 'bulk-view--compact' : ''}`} ref={bulkScrollContainerRef}>
      {/* Toolbar — row 1: status tabs; row 2: Type filter; row 3: selection + AI / sync */}
```

```5124:5126:apps/electron-vite-project/src/components/EmailInboxBulkView.tsx
      {/* Content — list + chrome (scrolls with `.bulk-view-root`) */}
      <div className="bulk-view-content">
        {error ? (
```

| Check | Result | Evidence |
|-------|--------|----------|
| 3.3 IntersectionObserver ref on root | **PASS** | `ref={bulkScrollContainerRef}` on line 4206; content div has no ref. |

---

### Check 3.4 — No sticky/fixed on toolbar / provider / root

- **`.bulk-view-toolbar`** (lines 2301–2310): `display`, `padding`, `border-bottom`, **`flex-shrink: 0`background** — **no `position`**.
- **`.bulk-view-provider-section`** (lines 2764–2768): **`flex-shrink: 0`**, borders/background — **no `position`**.
- **`.bulk-view-root`** (lines 1801–1812): **no `position`**.
- **`EmailInboxBulkView.tsx`**: no inline `position: sticky|fixed` on those class roots (grep shows `bulk-view-root` / toolbar only as class names; other `fixed` usages in the file are for modals/overlays such as `WrExpertModal`, not the bulk toolbar).

`App.css` still contains other `position: sticky` / `fixed` rules elsewhere in the file (e.g. lines 737, 1450, 5242) — **not** scoped to `.bulk-view-toolbar`, `.bulk-view-provider-section`, or `.bulk-view-root`.

| Check | Result | Evidence |
|-------|--------|----------|
| 3.4 No sticky/fixed on header blocks | **PASS** | Toolbar, provider, root rules omit `position`. |

---

### Check 3.5 — Toolbar and provider CSS

```2301:2310:apps/electron-vite-project/src/App.css
.bulk-view-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  gap: 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  flex-shrink: 0;
  background: #ffffff;
}
```

```2764:2768:apps/electron-vite-project/src/App.css
.bulk-view-provider-section {
  flex-shrink: 0;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}
```

`git diff d8819047..HEAD -- .../App.css` filtered for `bulk-view-toolbar` / `bulk-view-provider` produced **no lines** (those blocks were not part of the recent bulk-scroll delta for toolbar/provider).

| Check | Result | Evidence |
|-------|--------|----------|
| 3.5 Toolbar CSS untouched | **PASS** | `flex-shrink: 0` retained; no diff hits on those selectors in the sampled range. |

---

## Summary

| Area | PASS | FAIL | WARNING |
|------|------|------|---------|
| Verification 1 | 4 | 0 | 0–1 (optional 1.3 omission edge case) |
| Verification 2 | 3 | 0 | 0 |
| Verification 3 | 5 | 0 | 0 |
| **Total (row checks)** | **12** | **0** | **0–1** |

- **Total checks:** 12 table rows (1.3 counted once as PASS; optional WARNING called out in text).
- **PASS:** 12  
- **FAIL:** 0  
- **WARNING:** 0 (1 optional note under 1.3 if “never omit `client_secret`” is a hard requirement).

---

## Items requiring attention

- **None required for FAIL.**
- **Optional (1.3):** If Desktop OAuth **must** always POST `client_secret`, confirm production accounts always have `gmailOAuthClientSecret`, vault secret, or a matching builtin meta; otherwise refresh requests may omit the field by design.

- **Layout nuance (3.2):** `.bulk-view-content-message` retains `overflow-y: auto` for empty/error/loading states—acceptable for small panes but worth UX validation if a second scrollbar appears.

---

*Report generated by static read of `ipc.ts`, `gateway.ts`, `gmail.ts`, `syncOrchestrator.ts`, `imapSyncTelemetry.ts`, `App.css`, `EmailInboxBulkView.tsx`, and targeted `git diff` for `imap.ts` / `gateway.ts` / `App.css`.*
