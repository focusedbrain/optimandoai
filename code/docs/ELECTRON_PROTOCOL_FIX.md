# Windows "Open Electron" Prompt Fix

## Problem Summary

Users on Windows were experiencing recurring "Open Electron" prompts and "Unable to find Electron app / Cannot find module 'C:\Windows\System32\wrcode\start'" errors during or after SSO authentication.

## Root Cause

The Chrome extension was attempting to launch the desktop Electron app using custom URL protocol schemes:

- `wrcode://start`
- `opengiraffe://start`

When Windows did not have a correctly registered protocol handler for these schemes (or the handler pointed to a non-existent path like `C:\Windows\System32\wrcode\start`), the browser would:

1. Show a confusing "Open Electron?" prompt
2. Fail with "Unable to find Electron app" error
3. Leave users stuck in a broken state

**This was NOT an OIDC/auth failure** - it was an invalid post-login redirect using a custom protocol scheme.

## Solution

### 1. Removed Custom Protocol Launch from Web/Extension

The following files were modified to **remove all attempts to launch the desktop app via custom protocol**:

| File | Change |
|------|--------|
| `apps/extension-chromium/src/background.ts` | Removed `wrcode://start` protocol launch in `launchElectronAppDirect()` |
| `apps/extension-chromium/src/content-script.tsx` | Disabled `TRIGGER_PROTOCOL_LAUNCH` message handler |
| `apps/extension-chromium/src/components/BackendConfigLightbox.tsx` | Removed `opengiraffe://start` iframe launch |

**New behavior**: The extension only communicates with an **already-running** Electron app via HTTP/WebSocket. If the app is not running, users are shown a notification to start it manually from the Start Menu or desktop shortcut.

### 2. Added `sanitizeReturnTo()` Security Utility

A new security utility was added to prevent any future accidental custom scheme redirects:

```typescript
// packages/shared/src/security/sanitizeReturnTo.ts

import { sanitizeReturnTo } from '@shared/security/sanitizeReturnTo';

// Safe relative paths are allowed
sanitizeReturnTo('/app')           // => { sanitized: '/app', wasRejected: false }
sanitizeReturnTo('/dashboard?tab=1') // => { sanitized: '/dashboard?tab=1', wasRejected: false }

// Dangerous schemes are blocked
sanitizeReturnTo('wrcode://start')    // => { sanitized: '/', wasRejected: true }
sanitizeReturnTo('electron://start')  // => { sanitized: '/', wasRejected: true }
sanitizeReturnTo('javascript:alert(1)') // => { sanitized: '/', wasRejected: true }

// Protocol-relative URLs are blocked
sanitizeReturnTo('//evil.com')        // => { sanitized: '/', wasRejected: true }
```

**Fail-closed behavior**: If any input is uncertain or suspicious, the function returns the default path (`/`) instead of allowing potentially dangerous redirects.

### 3. Desktop/Electron App (Unchanged)

The Electron app (`apps/electron-vite-project/electron/main.ts`) still **handles** `wrcode://` and `opengiraffe://` deep links for backward compatibility. This is safe because:

1. The Electron app is the **receiver** of these protocols, not the **sender**
2. If a user manually invokes `wrcode://start` (e.g., from a shortcut), the app will handle it correctly
3. The web/extension code no longer **triggers** these protocols automatically

## How SSO Now Works

### Desktop (Electron) SSO Flow
```
1. User clicks "Login" in Electron app
2. Electron starts loopback server on http://127.0.0.1:<random-port>/callback/<random-path>
3. System browser opens Keycloak auth URL with redirect_uri=loopback
4. User authenticates in browser
5. Browser redirects to loopback URL
6. Electron receives auth code, exchanges for tokens
7. Loopback server closes
```

**Key**: Uses loopback redirect (RFC 8252 compliant), NOT custom protocol.

### Extension SSO Flow
```
1. Extension checks if Electron app is running via HTTP
2. If running: Sends POST to /api/auth/login, Electron handles SSO via browser
3. If not running: Shows notification asking user to start app from Start Menu
```

**Key**: Extension NEVER tries to launch Electron via custom protocol.

## Testing

Unit tests were added for the `sanitizeReturnTo()` function:

```bash
cd packages/shared
pnpm test
```

Test cases cover:
- Valid relative paths (`/app`, `/dashboard?tab=1`)
- Dangerous schemes (`wrcode://`, `electron://`, `javascript:`, `data:`, `file:`)
- Protocol-relative URLs (`//evil.com`)
- Edge cases (backslashes, control characters, empty input)

## Files Changed

| File | Summary |
|------|---------|
| `packages/shared/src/security/sanitizeReturnTo.ts` | NEW: URL sanitizer utility |
| `packages/shared/src/security/sanitizeReturnTo.test.ts` | NEW: Unit tests |
| `packages/shared/src/index.ts` | Export new utility |
| `apps/extension-chromium/src/background.ts` | Removed protocol launch |
| `apps/extension-chromium/src/content-script.tsx` | Disabled protocol handler |
| `apps/extension-chromium/src/components/BackendConfigLightbox.tsx` | Removed protocol iframe |
| `docs/ELECTRON_PROTOCOL_FIX.md` | This documentation |

## Verification

After applying this fix:

1. **No more "Open Electron?" prompts** - The extension never triggers custom protocol navigation
2. **No more "Unable to find Electron app" errors** - No custom protocol = no handler lookup failure
3. **SSO still works** - Desktop uses loopback redirect; extension uses HTTP communication
4. **Backward compatible** - Electron app still handles protocols if manually invoked
