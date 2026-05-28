import { refreshWithKeycloak as refreshCore, type RefreshTokenResponse } from '@repo/sso'

import { oidc } from './oidcConfig.js'

export type { RefreshTokenResponse }

export function refreshWithKeycloak(refreshToken: string): Promise<RefreshTokenResponse> {
  return refreshCore(oidc, refreshToken)
}
