/**
 * Edge tier module — Phase 3 (P3.8).
 */

export {
  type EdgeTierSettings,
  type EdgeReplica,
  type EdgeFallbackPolicy,
  DEFAULT_EDGE_TIER_SETTINGS,
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  getEdgeTierEnabled,
  setEdgeTierEnabled,
  upsertEdgeReplica,
  formatTrustedEdgePodIds,
  edgeTierRequiresPodRestart,
  getEdgeTierSettingsPath,
  _setSettingsPathForTest,
} from './settings.js'

export { generateEdgeKeypair, verifyEdgeKeypairRoundTrip, type EdgeKeypair } from './keygen.js'

export {
  EDGE_PRIVATE_KEY_INFO,
  encryptEdgePrivateKeyHex,
  decryptEdgePrivateKeyHex,
  storeEncryptedEdgePrivateKey,
  loadEncryptedEdgePrivateKeyHex,
  _setKeyStorePathForTest,
} from './keyStorage.js'

export {
  fetchJwks,
  parseJwksResponse,
  getCachedJwksJson,
  refreshJwksCache,
  refreshJwksOnStartup,
  refreshJwksOnVerificationFailure,
  type JwksJson,
} from './jwks.js'

export { requestSsoAttestation, type SsoAttestationResult } from './attestation.js'

export { getLocalSsoSub } from './sessionBridge.js'

export {
  applyEdgeTierSettingsAndRestartPod,
  onVerificationFailureRefreshJwks,
} from './podLifecycle.js'
