/**
 * BEAP Package Registry Module
 * 
 * Canonical package registry with:
 * - Unique package_id enforcement
 * - Append-only ingress event log
 * - Auto-registration with handshake/consent gating
 * 
 * INVARIANTS:
 * - No duplicate packages
 * - Channel imports reference canonical package_id
 * - Ingress events accumulate without changing package_id
 * - Auto-register only with trusted handshake + Full-Auto policy
 * 
 * @version 1.0.0
 */

// Types
export * from './types'

// Store
export {
  usePackageStore,
  useInboxPackages,
  useDraftPackages,
  useOutboxPackages,
  useArchivePackages,
  useRejectedPackages,
  usePendingConsent,
  usePackageCounts
} from './usePackageStore'

// Registration Service
export {
  generatePackageId,
  generatePackageIdSync,
  checkAutoRegister,
  registerPackageFromChannel,
  acceptPendingPackage,
  rejectPendingPackage,
  importFromGmail,
  importFromOutlook,
  importFromDownload,
  importFromWebMessenger,
  type HandshakeRegistry
} from './registrationService'

// Components
export { PackageList, PackageListItem } from './components'

