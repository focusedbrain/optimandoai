export * from './types'
export { runHandshakeVerification } from './pipeline'
export { HANDSHAKE_PIPELINE } from './steps'
export { classifyHandshakeTier } from './tierClassification'
export { buildCloudSnippet } from './cloudSnippet'
export {
  processHandshakeCapsule,
  isHandshakeActive,
  diagnoseHandshakeInactive,
  getEffectiveTier,
  authorizeAction,
  resolveEffectivePolicy,
} from './enforcement'
export { persistContextBlocks, queryContextBlocks } from './contextBlocks'
export { revokeHandshake } from './revocation'
export { gateVaultAccess } from './vaultGating'
export { processEmbeddingQueue, semanticSearch } from './embeddings'
export type { LocalEmbeddingService } from './embeddings'
export { migrateHandshakeTables, backfillLocalX25519PublicKey } from './db'
export { handleHandshakeRPC, registerHandshakeRoutes } from './ipc'
export { startRetentionJob, stopRetentionJob } from './retentionJob'
