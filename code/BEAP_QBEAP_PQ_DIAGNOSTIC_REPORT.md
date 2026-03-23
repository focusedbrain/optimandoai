# BEAP™ qBEAP Build Failure — PQ Crypto Availability Diagnostic Report

## 1. ERROR SOURCE

| Field | Value |
|-------|-------|
| **File** | `code/apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts` |
| **Function** | `buildQBeapPackage` |
| **Lines** | 958–961 (pre-check), 1062–1066 (catch of `pqEncapsulate`) |
| **Condition** | `if (!pqAvailable)` after `const pqAvailable = await isPostQuantumAvailableAsync()` |
| **Error message** | `CANON VIOLATION: qBEAP requires post-quantum cryptography (ML-KEM-768 + X25519 hybrid) per canon A.3.054.10 and A.3.13. PQ library is not available. Cannot create qBEAP package without post-quantum protection.` |

**Flow:**
1. Line 955: `const pqAvailable = await isPostQuantumAvailableAsync()` → calls `pqKemSupportedAsync()` in beapCrypto.ts
2. Line 958: `if (!pqAvailable)` → returns the error (pre-flight block)
3. If the pre-check passed but `pqEncapsulate()` throws `PQNotAvailableError`, the catch at 1061–1067 returns the same error

---

## 2. PQ AVAILABILITY CHECK

| Field | Value |
|-------|-------|
| **Check function** | `pqKemSupportedAsync()` in `beapCrypto.ts` (lines 1885–1907) |
| **Called from** | `isPostQuantumAvailableAsync()` in BeapPackageBuilder.ts (line 193) → `buildQBeapPackage` (line 955) |
| **What it checks** | `fetch('http://127.0.0.1:17179/api/crypto/pq/status')` with 5s timeout |
| **Expected response** | `{ success: true, pq: { available: true } }` |
| **Why it fails** | **Port mismatch**: Extension calls port **17179**, but Electron serves PQ endpoints on port **51248** |
| **Dependencies** | Electron HTTP server must be running on 51248; PQ endpoints are part of the main Express app |

**Evidence:**
- `beapCrypto.ts` line 1850: `const ELECTRON_PQ_BASE_URL = 'http://127.0.0.1:17179'`
- `main.ts` lines 452–453: `HTTP_PORT = 51248` — all API routes (including `/api/crypto/pq/*`) are on 51248
- No server listens on port 17179 anywhere in the codebase

**Additional:** PQ endpoints require `X-Launch-Secret`. `beapCrypto.ts` does not send any headers, so even after fixing the port, requests would return 401 without an auth provider.

---

## 3. ROOT CAUSE

**Port mismatch + missing auth**

1. **Port 17179 vs 51248**  
   The extension uses `http://127.0.0.1:17179` for PQ operations. The Electron app serves all HTTP API (including PQ) on port 51248. Nothing listens on 17179, so `fetch` fails (connection refused / timeout), `pqKemSupportedAsync()` returns `false`, and the builder blocks with the CANON VIOLATION error.

2. **Missing auth headers**  
   Even with the correct port, `/api/crypto/pq/*` requires `X-Launch-Secret`. `beapCrypto.ts` does not add headers. The launch secret lives in the background script; the build runs in the sidepanel/popup, which does not have direct access. PQ requests would get 401 without a way to inject the secret.

3. **PQ library location**  
   `@noble/post-quantum` is installed in the Electron app and used in `main.ts` (lines 7953–8029). The extension does not have it; it relies on the Electron HTTP API for PQ. The library and endpoints are fine; the problem is the wrong URL and missing auth.

---

## 4. FIX RECOMMENDATION

**Recommended fix:** Option 2 (port + auth) — correct URL and add auth header injection

| Item | Details |
|------|---------|
| **Files to change** | `beapCrypto.ts`, `background.ts`, `beap-messages/index.ts`, `sidepanel.tsx`, `popup-chat.tsx` |
| **Estimated effort** | Small |
| **Canon compliance** | Yes |

**Steps:**
1. Change `ELECTRON_PQ_BASE_URL` in `beapCrypto.ts` from `http://127.0.0.1:17179` to `http://127.0.0.1:51248`.
2. Add `setPqAuthHeadersProvider()` in `beapCrypto.ts` so callers can inject headers (e.g. `X-Launch-Secret`).
3. Use the provider in all PQ `fetch` calls (status, keypair, encapsulate, decapsulate).
4. Add a `BEAP_GET_PQ_HEADERS` handler in `background.ts` that returns `{ headers: { 'X-Launch-Secret': _launchSecret } }`.
5. Call `initBeapPqAuth()` from sidepanel and popup on mount so the provider uses the background’s launch secret.

---

## 5. qBEAP BUILD CHAIN STATUS

| Step | Status | Notes |
|------|--------|------|
| 1. PQ crypto available | ❌ | Port 17179 wrong; auth missing |
| 2. Recipient handshake has peerX25519PublicKey | ✅ | From handshakeRpc |
| 3. Recipient handshake has peerPQPublicKey | ✅ | From handshakeRpc (peer_mlkem768_public_key_b64) |
| 4. Builder: X25519 ECDH succeeds | ✅ | Uses `@noble/curves` in extension |
| 5. Builder: ML-KEM-768 encapsulate | ❌ | Blocked by PQ availability check; would fail on wrong port/auth |
| 6. Builder: hybridSecret construction | ⏸️ | Depends on step 5 |
| 7. Builder: deriveBeapKeys | ⏸️ | Depends on step 6 |
| 8–12. AEAD encrypt, sign, assemble | ⏸️ | Depends on prior steps |
| 13–14. Receiver depackaging | ⏸️ | Same PQ service dependency |

---

## 6. IMMEDIATE WORKAROUND

**Use pBEAP (PUBLIC mode)** until the fix is applied:

- pBEAP does not use PQ; it is unencrypted + signed.
- Select PUBLIC mode instead of PRIVATE when composing.
- No code changes required.

**Alternative:** Ensure Electron is running and the fix (port + auth) is deployed so qBEAP can use the PQ endpoints on 51248.

---

## 7. FIX APPLIED (Implemented)

The following changes have been implemented:

1. **beapCrypto.ts**: `ELECTRON_PQ_BASE_URL` changed from `17179` → `51248`
2. **beapCrypto.ts**: Added `setPqAuthHeadersProvider()` and `_getPqHeaders()`; all PQ fetch calls now include auth headers
3. **background.ts**: Added `BEAP_GET_PQ_HEADERS` message handler returning `{ headers: { 'X-Launch-Secret': _launchSecret } }`
4. **initBeapPqAuth.ts**: New module that sets the provider to request headers via `chrome.runtime.sendMessage`
5. **sidepanel.tsx** and **popup-chat.tsx**: Call `initBeapPqAuth()` on mount

**To use qBEAP:** Ensure the WR Desk Electron app is running and connected (WebSocket handshake complete). Then select PRIVATE mode, choose a handshake with key material, and Send.
