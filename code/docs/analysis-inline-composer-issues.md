# Inline Composer Issues — Analysis

**Scope:** Investigation only (no code changes). Covers the inline capsule builder in the Electron dashboard (`BeapInlineComposer.tsx`) and shared BEAP delivery / draft-refine behavior.

---

## Issue 1: Crypto Failure (qBEAP / P2P send from inline builder)

### Send path trace

| Item | Detail |
|------|--------|
| **Entry function** | `handleSend` in `apps/electron-vite-project/src/components/BeapInlineComposer.tsx` (starts ~line 511). |
| **Delivery API** | **`executeDeliveryAction(config)`** imported from `@ext/beap-messages/services/BeapPackageBuilder` (same module as the legacy popup builder). |
| **Not** | Not a direct `new BeapPackageBuilder()` from the component; not `chrome.runtime.sendMessage` for the core build. The builder module runs inside the Electron renderer bundle. |
| **Config** | Builds `BeapPackageConfig` with `getSigningKeyPair()` (Ed25519 fingerprint), optional attachments, then `executeDeliveryAction`. |

**Answer to “A/B/C/D”:** Closest to **(B)** — **`executeDeliveryAction`**. That function (in `BeapPackageBuilder.ts` ~2288+) calls **`buildPackage(config)`** first, then **`executeEmailAction` / `executeDownloadAction` / `executeP2PAction`** as appropriate. P2P uses **`sendBeapViaP2P`** from `handshakeRpc` (in Electron this is the **preload `handshakeView` bridge**, not `chrome.runtime`).

### Crypto failures

| Operation | Works in Electron renderer? | Why |
|-----------|------------------------------|-----|
| **PQ encapsulate (HTTP POST `/api/crypto/pq/mlkem768/encapsulate`)** | **Likely NO (authenticated POST)** | Global HTTP auth in `electron/main.ts` requires **`X-Launch-Secret`** for all routes except a small exempt set. **`/api/crypto/pq/status`** is exempt; **POST encapsulate is NOT.** `beapCrypto.pqEncapsulate` uses `fetch` with headers from **`_getPqHeaders()`** (`beapCrypto.ts` ~1886–1894). In the **extension**, `initBeapPqAuth()` (`initBeapPqAuth.ts`) registers a provider that uses **`chrome.runtime.sendMessage({ type: 'BEAP_GET_PQ_HEADERS' })`**. In the **Electron dashboard renderer**, `chrome.runtime.sendMessage` is absent, so **`setPqAuthHeadersProvider` is never registered** — **`initBeapPqAuth` is a no-op** (see `initBeapPqAuth.ts` lines 8–17: provider only set when `chrome.runtime?.sendMessage` exists). **`BeapInlineComposer`** does call `initBeapPqAuth()` on mount (~lines 199–205), but it does not create headers in pure Electron. Result: POST runs **without** `X-Launch-Secret` → **401** → failure surfaced as **`PQNotAvailableError`** or package build error. |
| **`ensurePqHttpAuthReady()`** | Misleading “ready” in Electron | In `beapCrypto.ts` ~1901–1912, if `chrome` is missing, it **returns `true`** without obtaining a secret. That only means “don’t block on extension message”; it does **not** inject launch-secret headers. |
| **PQ status GET** | **Usually YES** | **`/api/crypto/pq/status`** is in **`AUTH_EXEMPT_PATHS`** (`main.ts` ~5319–5324), so **`pqKemSupportedAsync`** can return `true` even without headers — then **`pqEncapsulate`** still fails on POST. |
| **X25519 device key** | **Likely YES (fallback)** | `x25519KeyAgreement.ts` uses **`chrome.storage.local`** when present; otherwise **`localStorage`** for `beap_x25519_device_keypair` (~117–141). Electron renderer has no extension storage but **does** hit the localStorage path. |
| **Ed25519 signing (`getSigningKeyPair`)** | **Likely YES (fallback)** | `signingKeyVault.ts` reads vault from **`chrome.storage.local`** or **`localStorage`** (~323–341). Same pattern. |
| **AES-GCM / HKDF (WebCrypto)** | **YES** | Standard `crypto.subtle` in Chromium; no evidence of CSP blocking in-app. |
| **Handshake / ML-KEM peer key** | **YES if IPC + mapping OK** | Inline composer loads handshakes via **`listHandshakes`** from **`handshakeRpc` shim** (`apps/electron-vite-project/src/shims/handshakeRpc.ts`) → **`window.handshakeView.listHandshakes`**. `mapLedgerHandshakeToRpc` maps **`peer_mlkem768_public_key_b64`** → **`peerPQPublicKey`**. `hasHandshakeKeyMaterial` gates send. Wrong or missing DB fields would fail later, but the **first** failure for qBEAP is commonly **PQ HTTP 401** as above. |
| **P2P transport** | **Separate step** | After build, **`sendBeapViaP2P`** uses **`window.handshakeView.sendBeapViaP2P`** (shim ~218–232). **`checkHandshakeSendReady`** uses **`window.handshakeView.checkHandshakeSendReady`** (~236–241). If preload exposes these, transport can work once the **package is built**. |

### Exact error

No live console capture in this analysis. Expected first failure modes:

1. **`Post-quantum cryptography not available: pqEncapsulate...`** (`PQNotAvailableError`) when POST returns non-OK / 401.
2. Or **`[BEAP-SEND] Package build failed:`** with a message derived from the same PQ path.

To confirm locally: DevTools → Network on **`POST http://127.0.0.1:51248/api/crypto/pq/mlkem768/encapsulate`** → **401** + `missing or invalid launch secret`.

### Working reference path: “Send BEAP Reply” (`InboxDetailAiPanel` in `EmailInboxView.tsx`)

| Item | Detail |
|------|--------|
| **Function** | **`handleSendCapsuleReply`** (~704–760 in `EmailInboxView.tsx`). |
| **Delivery** | **`await executeDeliveryAction(config)`** — **same** as inline builder. |
| **Handshake source** | **`listHandshakes('active')`** then **`mapLedgerRecordToSelectedRecipient`**, not extension storage. |
| **Signing** | **`getSigningKeyPair()`** — same module. |

**Important:** **`EmailInboxView.tsx` does not call `initBeapPqAuth`**. **`BeapInlineComposer`** is the only Electron surface found that imports and calls **`initBeapPqAuth()`** — and in Electron that call **does not** attach PQ headers. So **inbox capsule reply and inline builder share the same PQ HTTP limitation** in a pure Electron renderer: **neither** gets `X-Launch-Secret` via the extension background. If inbox reply “works” in testing, possible explanations include: testing in a context where **`chrome.runtime` exists**, different delivery mode (e.g. not hitting PQ encapsulate), or the same failure not yet observed for P2P qBEAP.

### Fix recommendation (Step 4)

| Approach | Fit |
|----------|-----|
| **A — Bridge to extension** | Extension background could hold launch secret and PQ headers; **Electron dashboard renderer is not the extension** unless embedded — usually **not** the minimal fix for dashboard-only UX. |
| **B — IPC in main** | Aligns with **`parser:extractPdfText`**: main already serves **`/api/crypto/pq/*`** with auth. New IPC such as **`crypto:pqEncapsulate`** / **`crypto:pqWithHeaders`** (or one **`beap:buildPackage`**) avoids exposing the secret to the renderer. **Strongest match** to existing security model. |
| **C — Hybrid** | Renderer keeps WebCrypto; **PQ (and optionally header injection)** via IPC or a small preload helper that adds **`X-Launch-Secret`** from a **secure** channel — **viable** if product wants minimal main-process logic. |

**Simplest given current infra:** **(B) or (C)** — reuse **main-process** or **preload** to call PQ with auth, analogous to PDF extract IPC; optionally add **`setPqAuthHeadersProvider`** wired to **`ipcRenderer.invoke('security:getLaunchSecret')`** only if that API is intentionally restored (it was avoided for PDF to reduce secret exposure).

---

## Issue 2: Field Not Editable When Selected (draft refine)

### Root cause

**Primary: focus stealing by `HybridSearch` when draft refine connects.**

In `apps/electron-vite-project/src/components/HybridSearch.tsx` (~416–421):

- When **`draftRefineConnected`** becomes **`true`**, a **`useEffect`** runs **`requestAnimationFrame(() => inputRef.current?.focus())`**.
- That moves keyboard focus to the **top chat input**, so the user **cannot** keep typing in the capsule **textarea** after connecting.

**Secondary: `onClick` on the textarea toggles connect/disconnect.**

In `BeapInlineComposer.tsx`, **`handleFieldClick`** (~257–278):

- If already **`connected`** and same **`refineTarget`**, **`onClick`** calls **`disconnect()`**.
- So a click meant to place the caret or continue editing can **disconnect** refine instead of editing.

There is **`no `readOnly`**** on the public/encrypted textareas in `BeapInlineComposer` (textarea blocks ~1091–1198). **`pointer-events: none`** was not found on those fields.

### Evidence

| Location | Behavior |
|----------|----------|
| `BeapInlineComposer.tsx` ~1091–1135 | **`<textarea ... onClick={() => handleFieldClick('public')}>`** — connect/toggle on every click. |
| `HybridSearch.tsx` ~416–418 | **`inputRef.current?.focus()`** when refine connects. |
| `useDraftRefineStore.ts` | **`connect`** sets **`connected: true`**; no `readOnly` flag. |

### Existing inbox behavior

`EmailInboxView.tsx` (**InboxDetailAiPanel**) uses the **same** pattern for native BEAP capsule fields:

- **`onClick={handleCapsulePublicRefineConnect}`** / encrypted analogue (~1141, 1184).
- **`onFocus`** also calls the same handlers (~1142–1145, 1185–1188) — connecting (or toggling) on focus as well.

So **the same HybridSearch focus steal applies** when refine is connected: the inbox capsule fields are subject to the **same** “can’t keep typing in textarea” symptom, not a unique inline-only regression. The inline composer does **not** add `onFocus` connect on the textarea (only **`onClick`**), but **HybridSearch focus** is shared.

### Fix (recommendation)

1. **Do not auto-focus the chat input** when the refine target is **`capsule-public`** / **`capsule-encrypted`** (or make it optional / behind a preference), **or** focus the **textarea** instead when connection is field-driven.
2. **Decouple “connect refine” from textarea `onClick`**: e.g. a small “AI link” control, or **`onMouseDown`** on a badge only, so normal clicks and typing focus the textarea without toggling connection every time.
3. Avoid **`onFocus` → connect** (inbox) firing on every focus if that amplifies the fight between textarea and chat bar.

---

## Quick reference: files

| Topic | File(s) |
|------|---------|
| Inline send | `BeapInlineComposer.tsx` — `handleSend`, `executeDeliveryAction` |
| Inbox capsule send | `EmailInboxView.tsx` — `handleSendCapsuleReply` |
| PQ + HTTP | `beapCrypto.ts` — `pqEncapsulate`, `_getPqHeaders`, `ensurePqHttpAuthReady` |
| PQ auth init | `initBeapPqAuth.ts` — extension-only provider |
| HTTP auth | `electron/main.ts` — `AUTH_EXEMPT_PATHS`, global secret middleware |
| Draft refine focus | `HybridSearch.tsx` — `draftRefineConnected` → `inputRef.focus()` |
| Draft state | `useDraftRefineStore.ts` |
