# IMAP Connection Failure — Post-Analysis Report

**Repository path (monorepo):** `code/apps/electron-vite-project/` (Electron main process email stack)  
**Branch / commit (post-fix bundle):** `build691` @ `656fc64e` (`chore(build115): Windows outDir + extension build115; IMAP debug and TLS normalize`)  
**Report date:** 2026-03-22  

---

## 1. Executive Summary

The reported incident was **IMAP inbound mail stopping or failing authentication after a recent refactor**, with emphasis on **web.de** and similar IMAP hosts. This thread did **not** capture a single failing production trace end-to-end; instead, the codebase was audited for **credential lifecycle**, **TLS mapping**, **connect probe vs cached-provider sync**, and **orchestrator timeout messaging**. Several **defensive fixes and diagnostics** were implemented: **`[IMAP-DEBUG]`** logging on the gateway connect path and inside **`ImapProvider.connect`**, **`securityModeNormalize`** so non-canonical `security` strings (e.g. `TLS`, `ssl/tls`) still enable **implicit TLS** on port 993, **`isDiskEncryptedPasswordFlag`** so JSON **`"true"`** does not skip decryption, clearer **handshake-timeout vs auth** errors in **`ensureConnectedForOrchestratorOperation`**, **`email:diagnoseImap`** for a **raw node-imap** test from DevTools, and wizard **`coerceSecurityModeUi`**. **Whether the original user-visible failure is fully resolved** requires **re-verification on the affected machine** using **`[IMAP-DEBUG]`** lines and/or **`window.emailAccounts.diagnoseImap(...)`** with real credentials; the changes remove several **known silent-failure** modes that match “auth failed” symptoms.

---

## 2. Reproduction Steps

### 2.1 Intended reproduction (from product behavior)

1. Install/run WR Desk Electron build that includes the email gateway (`email-accounts.json` under app userData).
2. **Connect Email** → **Custom (IMAP + SMTP)**.
3. Use a **web.de**-style setup (or any host):
   - **IMAP:** `imap.web.de`, **993**, **SSL/TLS** (canonical `security: 'ssl'` in config).
   - **SMTP:** `smtp.web.de`, **587**, **STARTTLS** (canonical `smtp.security: 'starttls'`).
   - Valid **username** (often full email) and **app password** where required.
4. Complete connect (probe succeeds) → trigger **inbox Pull** (`inbox:syncAccount` → `syncAccountEmails` → `listMessages` → `getConnectedProvider`).

### 2.2 What the user may see

- **Connect wizard:** `IMAP check failed: …` (from `connectCustomImapSmtpAccount`; inner text often includes **`authentication failed`** from **node-imap** / server).
- **Gateway persisted account:** `lastError` / `status: 'auth_error'` when `isLikelyEmailAuthError` matches (`emailAuthErrors.ts`).
- **Pull / sync:** Errors on `listMessages` or empty pulls; orchestrator precheck may show **timeout** strings previously wrapped as **“Account authentication failed”**.

### 2.3 Note on exact account

No single **account id**, **password**, or **captured UI screenshot** was attached in the investigation transcript; reproduction should use the **same host/port/security** as the failing account and compare **`[IMAP-DEBUG]`** before/after fixes.

---

## 3. Debug Logging Output

### 3.1 Important limitation

**No production console capture** of **`[IMAP-DEBUG]`** from the failing session was pasted into the investigation. The lines below are **exact shapes** emitted by the **current code** and **how to judge** them. When you reproduce, paste your **main process** log (Electron) into this section for the canonical incident record.

### 3.2 `[IMAP-DEBUG] connect attempt:` (gateway)

**Source:** `apps/electron-vite-project/electron/main/email/gateway.ts` — **`getConnectedProvider`**, immediately before **`await provider.connect(account)`** (new session and reconnect branches).

```1371:1380:apps/electron-vite-project/electron/main/email/gateway.ts
      console.log('[IMAP-DEBUG] connect attempt:', {
        provider: account.provider,
        host: account.imap?.host,
        port: account.imap?.port,
        security: account.imap?.security,
        username: account.imap?.username,
        hasPassword: !!account.imap?.password,
        passwordLength: account.imap?.password?.length ?? 0,
        encrypted: account.imap?._encrypted,
      })
```

| Field | **Correct** for working IMAP (typical web.de) | **Wrong / suspicious** |
|--------|---------------------------------------------|-------------------------|
| `provider` | `'imap'` | anything else |
| `host` | `'imap.web.de'` (or chosen host) | empty, typo, wrong host |
| `port` | `993` for SSL IMAP | `143` with `tls: true` mismatch, etc. |
| `security` | `'ssl'` (canonical after normalize) | non-canonical before fix: `'TLS'`, `'ssl/tls'` string — **now normalized on save** |
| `username` | non-empty login | empty |
| **`hasPassword`** | **`true`** | **`false`** → password missing in memory (decrypt skipped, wrong disk flag, or empty field) |
| **`passwordLength`** | **`> 0`** | **`0`** → same as above |
| **`encrypted`** | **`false`** or **`undefined`** in memory after `loadAccounts` / decrypt | **`true`** in memory with plaintext expectation = inconsistent; **string `"true"`** was a **bug** for decrypt gate (fixed — see §6) |

**Non-IMAP providers:** `imap` fields are `undefined`; this log is still emitted — ignore IMAP-specific fields when `provider !== 'imap'`.

### 3.3 `[IMAP-DEBUG] ImapCtor config:` (provider)

**Source:** `apps/electron-vite-project/electron/main/email/providers/imap.ts` — **`connect`**, before **`new ImapCtor({...})`**.

```237:246:apps/electron-vite-project/electron/main/email/providers/imap.ts
      const useImplicitTls = imapUsesImplicitTls(config.imap!.security)
      console.log('[IMAP-DEBUG] ImapCtor config:', {
        user: config.imap!.username,
        host: config.imap!.host,
        port: config.imap!.port,
        securityRaw: config.imap!.security,
        tls: useImplicitTls,
        hasPassword: !!config.imap!.password,
        passwordLength: config.imap!.password?.length ?? 0,
      })
```

| Field | **Correct** (web.de SSL) | **Wrong** |
|--------|---------------------------|-----------|
| **`securityRaw`** | `'ssl'` or alias that **normalizes** to implicit TLS | value that does **not** map to implicit TLS while using **993** — historically **`tls: config.imap!.security === 'ssl'`** was **too strict** |
| **`tls` (`useImplicitTls`)** | **`true`** for implicit TLS on 993 | **`false`** on 993 → **broken TLS** (silent wrong wire behavior) — **mitigated** by **`imapUsesImplicitTls`** |
| `host` / `port` | `imap.web.de` / `993` | mismatch with server |
| **`hasPassword` / `passwordLength`** | **`true` / > 0** | **`false` / 0** |

### 3.4 `[IMAP-DEBUG] connection error raw:`

**Source:** `apps/electron-vite-project/electron/main/email/providers/imap.ts` — first handler for pre-**`ready`** **`error`** event.

```266:268:apps/electron-vite-project/electron/main/email/providers/imap.ts
      const onConnectError = (err: Error) => {
        console.log('[IMAP-DEBUG] connection error raw:', err)
        console.error('[IMAP] Connection error:', err)
```

**Annotation:** Log the **full `Error`** (message + stack). Server strings like **`authentication failed`**, **TLS errors**, or **timeouts** appear here — use this to separate **auth** vs **network/TLS**.

### 3.5 Related gateway logs (not `[IMAP-DEBUG]`)

**Decrypt / encrypt** (since **`ed64e83a`** / **`d7881796`**):

```102:107:apps/electron-vite-project/electron/main/email/gateway.ts
      console.log(
        '[Gateway] IMAP decrypt: _encrypted=',
        next.imap._encrypted,
        'decrypted length=',
        plain.length,
      )
```

```169:175:apps/electron-vite-project/electron/main/email/gateway.ts
  console.log(
    '[Gateway] IMAP encrypt: encAvail=',
    encAvail,
    'password length=',
    imapPlain.length,
    'encrypted length=',
    imapEncrypted.length,
  )
```

---

## 4. Root Cause

There was **no single stack trace** proving one line as “the” bug in production. Below are **documented failure mechanisms** in this codebase that **explain IMAP auth / pull symptoms**, with **file:line** references and **git history** where known.

### 4.1 Strict IMAP TLS flag (`tls: security === 'ssl'`)

- **Files / functions:** `ImapProvider.connect` (historically **`tls: config.imap!.security === 'ssl'`** only).
- **Why it breaks:** Any **`security`** value not **strictly** equal to **`'ssl'`** (e.g. different casing, UI string, or hand-edited JSON) set **`tls: false`** while still using **993**, producing **wrong wire behavior** and often **auth or TLS errors**.
- **Commits / context:** Pre-fix behavior is visible in the **diff** of **`imap.ts`** in the investigation; mitigation added via **`domain/securityModeNormalize.ts`** + **`imapUsesImplicitTls`** (`656fc64e` area).
- **Regression vs latent:** **Latent** strictness; **exposed** if any path wrote non-canonical **`security`**.

### 4.2 Strict `_encrypted === true` (decrypt skipped)

- **Files / functions:** `decryptImapSmtpPasswords` in `gateway.ts` — previously **`next.imap._encrypted === true`** only.
- **Why it breaks:** If **`email-accounts.json`** had **`"_encrypted": "true"`** (string), decryption was **skipped**; **`password`** stayed **ciphertext** → IMAP **LOGIN** sends garbage → **authentication failed**.
- **Commits:** Not introduced in the last 3 `gateway.ts` commits analyzed for IMAP connect; **hardened** with **`isDiskEncryptedPasswordFlag`** (`656fc64e`).
- **Regression vs latent:** **Latent** / tooling edge case.

### 4.3 Orchestrator precheck labeled as “authentication failed” on timeout

- **Files / functions:** `ensureConnectedForOrchestratorOperation` in `gateway.ts`.
- **Why it misleads:** Outer message always prefixed **Account authentication failed** even when inner error was **handshake timeout** (15s race, now 25s) — **not** necessarily wrong password. **`inboxOrchestratorRemoteQueue`** already treats many timeouts as **transient**, but logs/UI text were misleading.
- **Fix:** Distinct message for handshake timeout vs auth (`656fc64e`).

### 4.4 Connect probe vs cached provider (architecture)

- **Files:** `connectCustomImapSmtpAccount` uses **`new ImapProvider().testConnection(draft)`**; sync uses **`getConnectedProvider`** → **new cached** `ImapProvider` + **`connect(account)`** with **in-memory** `this.accounts` row.
- **Why it can confuse debugging:** Probe can succeed while **second** session fails if **in-memory** credentials differ (e.g. decrypt path, stale row) — **not** proven as the incident cause without logs.
- **Commit context:** **`d7881796`** — *“fix IMAP credential persist & reconnect”* — explicit IMAP/SMTP objects on decrypt/encrypt/update credentials to avoid **stale `_encrypted`** with spread.

### 4.5 IMAP SEARCH / Pull More (sync path, not connect)

- **File:** `imap.ts` — commit **`2fe42baf`** (`build74172: Smart Sync…`) changed **UID/search** behavior for date windows and **Pull More**.
- **Symptom overlap:** User may describe “pull stopped” when **connect works** but **list/fetch** returns empty or errors — **different layer** than TCP login.

---

## 5. Impact Assessment

| Question | Answer |
|----------|--------|
| **OAuth providers (Microsoft 365 / Gmail / Zoho)?** | **No** direct impact from IMAP **`tls`** / **`ImapProvider.connect`** / **`decryptImapSmtpPasswords`** (IMAP-only branches). **Orchestrator timeout** messaging change applies to **any** provider using **`ensureConnectedForOrchestratorOperation`**. |
| **web.de only vs all IMAP?** | **TLS strictness** and **credential decrypt** affect **all** IMAP accounts; **web.de** was called out as a **slow / quirky** server in comments and orchestrator docs, not as the sole buggy host. |
| **Connect vs sync path?** | **TLS / password** affect **both** (same `ImapProvider.connect`). **Probe-only** uses a **separate** instance (see §4.4). **SEARCH** changes affect **sync/pull** only. |
| **Corrupted credentials on disk?** | Normal path: **DPAPI/safeStorage** ciphertext in JSON, **plaintext in memory** after load. **Recovery:** reconnect / **updateImapCredentials**; if **decrypt** fails, gateway sets **error** status and clears password — user must **re-enter**. **`_encrypted: true` with plaintext** (encrypt throw) is a **known edge case** (see architecture notes in investigation). |

---

## 6. Fix Applied

Below is a **concise** list of **meaningful** code changes (not every line of the full `656fc64e` bundle). Paths relative to **`code/apps/electron-vite-project/`**.

### 6.1 `electron/main/email/domain/securityModeNormalize.ts` (new)

- **`imapUsesImplicitTls(security)`** — `ssl` / `tls` / `ssl/tls` / `imaps` → implicit TLS.
- **`smtpTransportTlsFlags(security)`** — SMTP **secure** / **requireTLS**.
- **`normalizeSecurityMode(value, fallback)`** — canonical **`SecurityMode`** before persist/probe.

### 6.2 `electron/main/email/providers/imap.ts`

- **Before (broken pattern):** `tls: config.imap!.security === 'ssl'`
- **After:** `const useImplicitTls = imapUsesImplicitTls(config.imap!.security)` → **`tls: useImplicitTls`**
- **`createSmtpTransport`:** uses **`smtpTransportTlsFlags`** instead of **`=== 'ssl'`** / **`=== 'starttls'`** only.
- **`[IMAP-DEBUG]`** logs: **`ImapCtor config`** (+ **`securityRaw`**), **`connection error raw`**.

### 6.3 `electron/main/email/gateway.ts`

- **`isDiskEncryptedPasswordFlag`:** `v === true || v === 'true'` for IMAP/SMTP decrypt gates.
- **`connectCustomImapSmtpAccount` / `connectImapAccount`:** **`normalizeSecurityMode`** on IMAP/SMTP security before save/probe.
- **`ensureConnectedForOrchestratorOperation`:** **25s** timeout; **non-auth** message for handshake timeout / **ETIMEDOUT**.
- **`getConnectedProvider` / `forceReconnect`:** JSDoc on **in-memory** credentials; **`[IMAP-DEBUG] connect attempt`** object.
- **Comment** on **ephemeral** IMAP probe vs **`this.providers`** in **`connectCustomImapSmtpAccount`**.

### 6.4 `electron/main/email/ipc.ts` + `electron/preload.ts`

- **`email:diagnoseImap`** — raw **node-imap** connect with **explicit** `{ host, port, security, username, password }`; returns **`{ success, events, error?, tlsInfo? }`**.
- **`window.emailAccounts.diagnoseImap`** with **`assertDiagnoseImapParams`**.

### 6.5 `extension-chromium/src/shared/components/EmailConnectWizard.tsx`

- **`coerceSecurityModeUi`** for reconnect hints and **`<select>`** `onChange`**.

### 6.6 `electron/main/email/diagnoseImapStandalone.ts` (new)

- Implements **diagnostic** session (events: **ready, error, alert, mail, close, end**).

**Full tree diff:** `git show 656fc64e --stat` and `git show 656fc64e` in repo root **`code_clean`**.

---

## 7. Verification

### 7.1 Done in this session

- **`pnpm --filter @optimandoai/extension-chromium run build`** and **`pnpm --filter electron-vite-project run build`** succeeded (Windows **`C:\build-output\build115`**).  
- **No** live **web.de** login test was executed in the agent environment (no real credentials).

### 7.2 Required verification on affected hardware

1. Launch built app; open **DevTools** in the window that has **`window.emailAccounts`**.
2. Run **`window.emailAccounts.diagnoseImap({ host: 'imap.web.de', port: 993, security: 'ssl', username: '…', password: '…' })`** — expect **`data.success: true`** and **`events`** containing **`event:ready`** then **`event:end`**.
3. Connect account via wizard; confirm **`[IMAP-DEBUG]`** shows **`hasPassword: true`**, **`passwordLength > 0`**, **`tls: true`**, **`encrypted`** not blocking decrypt.
4. Run **Pull**; confirm messages ingest and **`[SyncOrchestrator]`** logs show folder lists without **auth** errors.
5. (Optional) Trigger **remote orchestrator** drain; confirm **timeout** messages are **not** mislabeled as **wrong password** when network is throttled.

---

## 8. Recommendations

| Priority | Item |
|----------|------|
| **P0 — now** | **Remove or gate `[IMAP-DEBUG]`** before a production release (password length / host leak in logs). Prefer **feature flag** or **build-time `import.meta.env.DEV`**. |
| **P0 — now** | **`diagnoseImap`** is **powerful and dangerous** (plaintext password over IPC) — **document** internal-only; consider **stripping from production builds** or **guarding** with a secret dev toggle. |
| **P1** | **Integration test:** encrypt IMAP password → **`saveAccounts` round-trip** (mock fs) → **`loadAccounts` / decryptImapSmtpPasswords`** → assert **plaintext** equals input and **`_encrypted`** flag behavior. |
| **P1** | **Assertion** before **`ImapCtor`**: if **`port === 993`** and **`!imapUsesImplicitTls(security)`**, **`console.warn`** (or throw in dev) — catches misconfiguration early. |
| **P2** | **Architectural:** optional **`reloadAccountFromDisk(accountId)`** after external JSON edit; document **probe vs cache** in onboarding for support. |
| **P2** | **Track** IMAP **SEARCH** / **Pull More** server quirks (**`2fe42baf`**) separately from **auth** if users report “empty pull” with **green** connect. |

---

## Appendix A — Reference commits (git)

From **`git log`** on email paths (examples cited in analysis):

- **`d7881796`** — `chore(build712): … fix IMAP credential persist & reconnect`
- **`ed64e83a`** — `feat(email): IMAP pipeline, attachment AES-GCM storage, inbox UI`
- **`2fe42baf`** — `build74172: Smart Sync email UX, Zoho provider, sync window on connect`
- **`656fc64e`** — `chore(build115): … IMAP debug and TLS normalize` (bundles fixes above)

---

## Appendix B — Error string: `IMAP check failed: authentication failed`

**Composed prefix** in **`connectCustomImapSmtpAccount`**:

```1176:1179:apps/electron-vite-project/electron/main/email/gateway.ts
    if (!imapTest.success) {
      throw new Error(
        `IMAP check failed: ${imapTest.error || 'Could not connect or log in.'} Check IMAP host, port, security (SSL/TLS on 993 vs STARTTLS on 143), username, and password or app password.`
      )
```

**Inner `imapTest.error`** comes from **`ImapProvider.testConnection`** → **`err.message`** from **node-imap** / Node, not a fixed app string.

---

*End of report.*
