# SSO Authentication Guide

## Overview

This document describes the enterprise-grade SSO (Single Sign-On) authentication system integrated into WR Desk. The implementation follows security best practices and integrates with Keycloak OIDC.

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Chrome Extension  │────▶│  Electron Backend │────▶│    Keycloak     │
│  (BackendSwitcher)  │◀────│   (HTTP + WS)     │◀────│  auth.wrdesk.com│
└─────────────────────┘     └──────────────────┘     └─────────────────┘
```

### Security Model

- **OIDC Flow**: Authorization Code Flow with PKCE (S256)
- **Token Storage**: Refresh token in OS credential store (keytar), access token in RAM only
- **Session State**: Server-side validation, fail-closed on errors
- **Token Validation**: ID token signature verified (issuer, audience, nonce, expiry)

## Configuration

### Environment Variables

The following environment variables can be configured in the Electron app:

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ISSUER` | `https://auth.wrdesk.com/realms/wrdesk` | Keycloak realm URL |
| `OIDC_CLIENT_ID` | `wrdesk-orchestrator` | OIDC client identifier |
| `OIDC_SCOPES` | `openid profile email offline_access` | Requested OIDC scopes |
| `WRDESK_REGISTER_URL` | `https://wrdesk.com/register` | Account registration URL |

### OIDC Configuration

Edit `apps/electron-vite-project/src/auth/oidcConfig.ts`:

```typescript
export const oidc = {
  issuer: 'https://auth.wrdesk.com/realms/wrdesk',
  clientId: 'wrdesk-orchestrator',
  scopes: 'openid profile email offline_access',
} as const;
```

## UI Components

### Logged-Out State

When not authenticated, users see:
- **Primary Button**: "Sign in" - Initiates OIDC login flow
- **Secondary Link**: "Create account" - Opens registration page

### Logged-In State

When authenticated, users see:
- **Account Button**: Avatar with initials + display name
- **Dropdown Menu**: 
  - Profile (opens Keycloak account management)
  - Sign out (clears session)

## API Endpoints

### HTTP Endpoints (Electron Backend)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Initiates OIDC login flow |
| `/api/auth/status` | GET | Returns auth status + user info |
| `/api/auth/logout` | POST | Clears session |

### Auth Status Response

```typescript
interface AuthStatusResponse {
  ok: boolean;
  loggedIn: boolean;
  displayName?: string;  // e.g., "John Doe"
  email?: string;        // e.g., "john@example.com"
  initials?: string;     // e.g., "JD"
}
```

### Chrome Extension Messages

| Message Type | Direction | Description |
|--------------|-----------|-------------|
| `AUTH_LOGIN` | → Backend | Request login flow |
| `AUTH_STATUS` | → Backend | Request auth status |
| `AUTH_LOGOUT` | → Backend | Request logout |

## Testing

### Test Logged-Out State

1. Ensure no active session exists
2. Open the extension sidepanel
3. Verify "Sign in" button (primary, purple/indigo gradient) is displayed
4. Verify "Create account" link (secondary, text-only) is displayed

### Test Login Flow

1. Click "Sign in"
2. System browser should open Keycloak login page
3. Complete authentication
4. Verify sidepanel updates to show account button with user initials

### Test Logged-In State

1. After successful login, verify:
   - Account button shows user avatar (initials)
   - Account button shows display name (or email)
2. Click account button
3. Verify dropdown appears with:
   - User info header (name + email)
   - "Profile" option
   - "Sign out" option

### Test Logout

1. Click account button
2. Click "Sign out"
3. Verify UI returns to logged-out state

### Verify Token Validation

Check console logs for:
```
[AUTH] Login OK - tokens received (access_token, id_token, expires_in: 300)
[MAIN] AUTH_STATUS: logged in
```

Errors should result in fail-closed behavior (treated as logged out).

## Security Checklist

- [x] Authorization Code Flow with PKCE (S256) - never implicit flow
- [x] State parameter validated to prevent CSRF
- [x] Nonce validated to prevent replay attacks
- [x] ID token signature verified using JWKS
- [x] Issuer (iss) matches expected realm URL
- [x] Audience (aud) includes expected client_id
- [x] Token expiry validated with clock skew tolerance
- [x] Refresh token stored in OS credential store (not localStorage)
- [x] Access token kept in RAM only (not persisted)
- [x] Fail-closed: validation errors result in logged-out state
- [x] No raw tokens exposed to UI layer
- [x] Session state from server, not client guess

## Troubleshooting

### "Electron may not be running" Error

The extension requires the Electron backend to be running. Start it with:
```bash
cd apps/electron-vite-project
npm run dev
```

### Login Times Out

Default timeout is 120 seconds. If the browser window doesn't appear:
1. Check if a browser is already open with the login page
2. Check firewall/proxy settings

### Token Refresh Fails

If session expires unexpectedly:
1. Check Keycloak realm settings for token lifetimes
2. Verify refresh token hasn't been revoked
3. Check network connectivity to auth.wrdesk.com

## Files Changed

| File | Description |
|------|-------------|
| `apps/extension-chromium/src/components/BackendSwitcherInline.tsx` | SSO entry component UI |
| `apps/extension-chromium/src/background.ts` | Auth message handlers |
| `apps/electron-vite-project/src/auth/session.ts` | Session management + user info extraction |
| `apps/electron-vite-project/electron/main.ts` | HTTP/WS auth endpoints |
