# Authentication Module

Purpose: Keycloak OIDC login for Electron via system browser + PKCE + loopback.

## Planned Modules

| Module | Description |
|--------|-------------|
| `oidcConfig` | Keycloak server configuration (issuer, clientId, scopes) |
| `pkce` | PKCE code_verifier/code_challenge generation (S256) |
| `loopback` | Local HTTP server for OAuth redirect (127.0.0.1) |
| `login` | Browser-based login flow orchestration |
| `tokenStore` | Secure storage of refresh token (via keytar) |
| `refresh` | Token refresh via Keycloak token endpoint |
| `session` | Session state management (RAM) and ensureSession() |
