import {
  clearJwksCache,
  verifyIdToken as verifyIdTokenCore,
  type IdTokenClaims,
} from '@repo/sso'

import { oidc } from './oidcConfig.js'

export type { IdTokenClaims }

export { clearJwksCache }

export function verifyIdToken(idToken: string, expectedNonce: string): Promise<IdTokenClaims> {
  return verifyIdTokenCore(oidc, idToken, expectedNonce)
}
