/**
 * Types Module Index
 * 
 * Central export point for all type definitions and utilities.
 * 
 * JSON Schema: /schemas/agent.schema.json
 * 
 * @module types
 */

// Schema definitions
export * from './AgentTypeSchema';

// Canonical agent configuration (v2.1.0)
export * from './CanonicalAgentConfig';

// Canonical agent box configuration (v1.0.0)
export * from './CanonicalAgentBoxConfig';

// Agent validation
export * from './AgentValidator';

// Export/Import utilities — re-export everything except validateAgentConfig
// which is already exported from AgentValidator
export {
  type AgentExportMetadata,
  type SchemaElement,
  type AgentExportSection,
  type AgentExportFormat,
  type AgentImportResult,
  exportAgentToJson,
  exportAgentToJsonString,
  exportAgentCompact,
  importAgentFromJson,
  downloadAgentAsJson,
  readAgentFromFile,
} from './AgentExportImport';

// AI Chat Capture configuration — re-export everything except
// AIChatCaptureConfig and ResponseReadyMode which are already
// exported from CanonicalAgentConfig
export {
  type SiteFiltersConfig,
  type AutoDetectedSelectors,
  type TriggerConfig,
  type InputCaptureConfig,
  type OutputCaptureConfig,
  type ContextCaptureConfig,
  type SanitizationConfig,
  type DebugCaptureResult,
  getDefaultAIChatCaptureConfig,
  fromLegacyTriggerData,
  toLegacyTriggerData,
} from './AIChatCaptureConfig';

