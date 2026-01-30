export const APP_NAME = "OpenGiraffe Orchestrator";

// Security utilities
export {
  sanitizeReturnTo,
  sanitizeReturnToSimple,
  isReturnToSafe,
  type SanitizeReturnToConfig,
  type SanitizeResult,
} from './security/sanitizeReturnTo';
