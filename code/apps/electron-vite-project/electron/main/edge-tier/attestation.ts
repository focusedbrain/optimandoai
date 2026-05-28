/**
 * SSO attestation for edge pods — Phase 3 (P3.8); core in @repo/sso (Stream C — C1).
 */

import { requestEdgeAttestation } from '@repo/sso'

import { oidc } from '../../../src/auth/oidcConfig.js'

export interface SsoAttestationResult {
  jwt: string
}

export async function requestSsoAttestation(
  publicKeyHex: string,
  podId: string,
  ssoToken: string,
): Promise<SsoAttestationResult> {
  return requestEdgeAttestation(oidc, publicKeyHex, podId, ssoToken)
}
