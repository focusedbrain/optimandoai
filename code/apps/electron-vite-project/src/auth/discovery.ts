import {
  clearDiscoveryCacheForIssuer,
  fetchDiscovery as fetchDiscoveryCore,
  getCachedDiscovery as getCachedDiscoveryCore,
  getOidcDiscovery as getOidcDiscoveryCore,
  type DiscoveryResult,
  type OidcDiscovery,
  type DiscoveryError,
  type DiscoverySuccess,
} from '@repo/sso'

import { oidc } from './oidcConfig.js'

export type { DiscoveryResult, OidcDiscovery, DiscoveryError, DiscoverySuccess }

export function clearDiscoveryCache(): void {
  clearDiscoveryCacheForIssuer(oidc.issuer)
}

export function fetchDiscovery(forceRefresh = false): Promise<DiscoveryResult> {
  return fetchDiscoveryCore(oidc, forceRefresh)
}

export function getOidcDiscovery(): Promise<OidcDiscovery> {
  return getOidcDiscoveryCore(oidc)
}

export function getCachedDiscovery(): OidcDiscovery | null {
  return getCachedDiscoveryCore(oidc)
}
