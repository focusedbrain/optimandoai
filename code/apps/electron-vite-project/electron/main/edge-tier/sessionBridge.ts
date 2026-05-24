/**
 * Bridge SSO session claims into the edge-tier / local-pod layer.
 */

import { getCachedUserInfo } from '../../../src/auth/session.js'

/** Current user's Keycloak `sub` for LOCAL_SSO_SUB injection. */
export function getLocalSsoSub(): string | null {
  const info = getCachedUserInfo()
  return typeof info?.sub === 'string' && info.sub.length > 0 ? info.sub : null
}
