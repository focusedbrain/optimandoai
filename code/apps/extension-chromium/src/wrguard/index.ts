/**
 * WRGuard Module
 * 
 * Local enforcement and configuration context.
 * 
 * WRGuard is:
 * - A local enforcement context
 * - Where providers, sites, and local policy posture are defined
 * 
 * WRGuard is NOT:
 * - A capsule builder
 * - An envelope editor
 * - A runtime execution engine (yet)
 * 
 * @version 1.0.0
 */

// Types
export * from './types'

// Store
export {
  useWRGuardStore,
  useActiveSection,
  useEmailProviders,
  useConnectedProviders,
  useProtectedSites,
  usePolicyOverview,
  useIsWRGuardInitialized
} from './useWRGuardStore'

// Components
export {
  WRGuardWorkspace,
  EmailProvidersSection,
  ProtectedSitesSection,
  PoliciesOverviewSection,
  RuntimeControlsSection,
  ProtectedSitesList,
  RuntimeConfigLightbox,
  FullAutoStatusBanner
} from './components'
