export const APP_NAME = "WR Desk™ Orchestrator";

// Security utilities
export {
  sanitizeReturnTo,
  sanitizeReturnToSimple,
  isReturnToSafe,
  type SanitizeReturnToConfig,
  type SanitizeResult,
} from './security/sanitizeReturnTo';

// Vault capabilities (record types, tier gating, display metadata)
export * from './vault/vaultCapabilities';

// Handshake context governance (fine-grained policy model)
export * from './handshake/contextGovernance';
export * from './handshake/types';
