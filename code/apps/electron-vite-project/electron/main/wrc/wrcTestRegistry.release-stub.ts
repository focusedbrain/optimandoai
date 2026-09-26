/**
 * What release builds get instead of `wrcTestRegistry.ts` (`vite.config.ts`
 * aliases the module here unless the flavor is `wrc-test`). It exports the
 * same runtime names, so the alias can never break a build, and none of the
 * test registry: no keys, no publishers, no seed marker.
 */

import type { WrcTestRegistry, WrcTestRegistryOptions } from './wrcTestRegistry'

export const WRC_TEST_REGISTRY_MARKER = null
export const WRC_TEST_REGISTRY_BASE_URL = null
export const WRC_TEST_OWN_PUBLISHER = null
export const WRC_TEST_PARTY_ID = null
export const WRC_TEST_ROLLED_PUBLISHER = null

export function createWrcTestRegistry(_options?: WrcTestRegistryOptions): WrcTestRegistry {
  throw new Error('The WR Code test registry is not part of this build')
}
