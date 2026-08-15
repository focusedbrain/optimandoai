/**
 * WRC resolution client (Phase 3) — public surface.
 *
 * Contract: `docs/spec/WRC-Registry-API-Contract_v1.0.md` @20794bff, an
 * INTERFACE REFERENCE. There is no WRC service code in this repo and none of
 * these modules construct or sign publisher material.
 *
 * Placement note (deviation from the order's suggestion, deliberate): 3A was
 * suggested for `packages/ingestion-core` or `packages/shared`. Both are
 * imported by the MV3 extension, and the hardened client needs `node:dns`,
 * `node:net`, and `node:https` for its SSRF guard and TLS floor. Putting it
 * there would either break the extension build or invite a browser-safe
 * fallback that silently drops the guards. Since the order also states 3B is
 * "all in Electron main" and 3A is "used by 3B exclusively", the client lives
 * beside its only consumer.
 */

export {
  wrcHttpsGet,
  isPublicUnicastAddress,
  parseOutboundUrl,
  WRC_HTTP_DEFAULT_MAX_BYTES,
  WRC_HTTP_DEFAULT_TIMEOUT_MS,
} from './httpsClient'
export type { WrcHttpResult, WrcHttpErrorCode, WrcHttpOptions } from './httpsClient'

export * from './wrcContract'
export {
  wrcHashBytes,
  wrcHashObject,
  wrcCanonicalBytes,
  wrcVerifyEd25519,
  wrcVerifyObjectSignature,
  wrcCountersignatureMessage,
  wrcFoldInclusionProof,
} from './wrcCrypto'

export {
  verifyCatalogHead,
  verifyEnvelope,
  verifyEvp,
  resolveSigningKey,
} from './wrcVerify'
export type {
  WrcVerdict,
  WrcVerifyReason,
  WrcPublisherKeys,
  WrcFreshness,
} from './wrcVerify'

export {
  validateDomainDualChannel,
  parseWrTxtRecords,
  rootKeyFingerprint,
} from './dualChannel'
export type { DualChannelResult, DualChannelReason } from './dualChannel'

export {
  createWrcHttpTransport,
  createUnconfiguredWrcTransport,
} from './wrcTransport'
export type { WrcTransport, WrcTransportResult, WrcTxtResult } from './wrcTransport'

export {
  WrcResolvedRecordStore,
  createMemoryPersistence,
  createFilePersistence,
  defaultResolvedRecordPath,
} from './resolvedRecordStore'
export type {
  WrcResolvedRecord,
  WrcCacheState,
  WrcUnresolvedCaptureState,
  WrcStorePersistence,
} from './resolvedRecordStore'

export { WrcResolutionClient, isTransportOutage } from './resolutionClient'
export type {
  WrcResolutionResult,
  WrcResolutionSuccess,
  WrcResolutionFailure,
  WrcResolutionReason,
  ResolvePublisherOptions,
} from './resolutionClient'
