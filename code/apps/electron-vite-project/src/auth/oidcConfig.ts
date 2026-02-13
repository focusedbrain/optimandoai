/**
 * OIDC Configuration for Keycloak Authentication
 */
export const oidc = {
  issuer: 'https://auth.wrdesk.com/realms/wrdesk',
  clientId: 'wrdesk-orchestrator',
  // offline_access scope enables Refresh Token issuance
  scopes: 'openid profile email offline_access',
} as const;
