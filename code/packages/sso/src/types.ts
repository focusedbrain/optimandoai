/**
 * Shared OIDC configuration for WR Desk consumers (orchestrator + edge agent).
 */

export interface OidcConfig {
  readonly issuer: string
  readonly clientId: string
  readonly scopes: string
}

export const DEFAULT_ISSUER = 'https://auth.wrdesk.com/realms/wrdesk'

export const ORCHESTRATOR_OIDC: OidcConfig = {
  issuer: DEFAULT_ISSUER,
  clientId: 'wrdesk-orchestrator',
  scopes: 'openid profile email offline_access',
}

export const EDGE_AGENT_OIDC: OidcConfig = {
  issuer: DEFAULT_ISSUER,
  clientId: 'wrdesk-edge-agent',
  scopes: 'openid profile email offline_access',
}

export interface RefreshTokenStore {
  saveRefreshToken(refreshToken: string): Promise<void>
  loadRefreshToken(): Promise<string | null>
  clearRefreshToken(): Promise<void>
}

export interface OidcTokens {
  access_token: string
  refresh_token?: string
  id_token: string
  expires_in: number
  token_type: string
  scope?: string
}
