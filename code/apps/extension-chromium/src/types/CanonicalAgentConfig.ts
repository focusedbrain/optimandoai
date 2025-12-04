/**
 * Canonical Agent Configuration
 * 
 * This is the machine-readable, validated format for agent configurations.
 * Used for export/import and storage. All fields are normalized and typed.
 * 
 * @module CanonicalAgentConfig
 * @version 2.1.0
 * 
 * JSON Schema: /schemas/agent.schema.json
 * The JSON Schema file is the canonical contract for all agent configurations.
 * It is kept in sync with this TypeScript type definition.
 * 
 * Changes from 2.0.0:
 * - Removed passiveEnabled/activeEnabled from listening (unifiedTriggers is source of truth)
 * - Normalized reasoning to use only reasoningSections[] (first element is the main section)
 * - reasoning field is now deprecated, use reasoningSections[0] instead
 */

// =============================================================================
// Enum Definitions
// =============================================================================

/** Valid execution modes */
export const ExecutionModeValues = [
  'agent_workflow',
  'direct_response', 
  'workflow_only',
  'hybrid'
] as const;
export type ExecutionMode = typeof ExecutionModeValues[number];

/** Valid listening sources */
export const ListeningSourceValues = [
  'all',
  'chat',
  'voice',
  'voicememo',
  'video',
  'email',
  'whatsapp',
  'pdf',
  'docs',
  'dom',
  'api',
  'workflow',
  'agent',
  'screenshot',
  'stream'
] as const;
export type ListeningSource = typeof ListeningSourceValues[number];

/** Valid trigger types */
export const TriggerTypeValues = [
  'direct_tag',
  'tag_and_condition',
  'workflow_condition',
  'dom_event',
  'dom_parser',
  'augmented_overlay',
  'agent',
  'miniapp',
  'manual'
] as const;
export type TriggerType = typeof TriggerTypeValues[number];

/** Valid parser trigger modes */
export const ParserTriggerValues = [
  'page_load',
  'dom_change',
  'interval',
  'button_click',
  'manual'
] as const;
export type ParserTriggerMode = typeof ParserTriggerValues[number];

/** Valid response ready modes */
export const ResponseReadyModeValues = [
  'first_change',
  'quiet_period',
  'selector_signal'
] as const;
export type ResponseReadyMode = typeof ResponseReadyModeValues[number];

/** Valid destination kinds */
export const DestinationKindValues = [
  'agentBox',
  'chat',
  'email',
  'webhook',
  'storage',
  'notification'
] as const;
export type DestinationKind = typeof DestinationKindValues[number];

// =============================================================================
// Core Types
// =============================================================================

/** Memory settings configuration */
export interface CanonicalMemorySettings {
  agentEnabled: boolean;
  sessionEnabled: boolean;
  accountEnabled: boolean;
}

/** Context settings configuration */
export interface CanonicalContextSettings {
  agentContext: boolean;
  sessionContext: boolean;
  accountContext: boolean;
}

/** Unified destination structure */
export interface CanonicalDestination {
  kind: DestinationKind;
  agents?: string[];
  email?: string;
  webhook?: string;
  [key: string]: any;
}

// =============================================================================
// Trigger Types
// =============================================================================

/** Workflow condition */
export interface TriggerCondition {
  conditionType: 'boolean' | 'tag' | 'signal';
  field?: string;
  op?: string;
  value?: string;
  tag?: string;
  signal?: string;
}

/** Sensor/Action workflow configuration */
export interface TriggerWorkflow {
  type: 'internal' | 'external';
  workflowId: string;
  conditions?: TriggerCondition[];
}

/** DOM Parser AI Chat Capture configuration */
export interface AIChatCaptureConfig {
  siteFilters: string[];
  buttonSelectors: string[];
  autoDetectSelectors: boolean;
  triggerOnEnterKey: boolean;
  enterKeyIgnoreShift: boolean;
  captureInput: boolean;
  inputSelectors: string[];
  captureOutput: boolean;
  outputSelectors: string[];
  responseReadyMode: ResponseReadyMode;
  quietPeriodMs: number;
  responseSignalSelector: string;
  maxWaitTimeMs: number;
  captureUrl: boolean;
  capturePageTitle: boolean;
  metaSelectors: string[];
  sanitizeTrim: boolean;
  sanitizeStripMarkdown: boolean;
  sanitizeRemoveBoilerplate: boolean;
}

/** Canonical trigger structure */
export interface CanonicalTrigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  
  // Tag-based triggers
  tag?: string;
  channel?: ListeningSource;
  eventTagConditions?: any[];
  
  // Workflow triggers
  workflowId?: string;
  conditions?: TriggerCondition[];
  
  // DOM Event triggers
  domSelector?: string;
  domEvent?: string;
  domUrlFilter?: string;
  domPayloadSelection?: boolean;
  domPayloadSnippet?: boolean;
  domPayloadUrl?: boolean;
  
  // DOM Parser triggers
  parserTrigger?: ParserTriggerMode;
  parserInterval?: number; // Normalized to number
  domParseTarget?: string;
  domParseSelector?: string;
  domParserRules?: any[];
  
  // AI Chat Capture (when parserTrigger === 'button_click')
  siteFilters?: string[];
  buttonSelectors?: string[];
  autoDetectSelectors?: boolean;
  triggerOnEnterKey?: boolean;
  enterKeyIgnoreShift?: boolean;
  captureInput?: boolean;
  inputSelectors?: string[];
  captureOutput?: boolean;
  outputSelectors?: string[];
  responseReadyMode?: ResponseReadyMode;
  quietPeriodMs?: number;
  responseSignalSelector?: string;
  maxWaitTimeMs?: number;
  captureUrl?: boolean;
  capturePageTitle?: boolean;
  metaSelectors?: string[];
  sanitizeTrim?: boolean;
  sanitizeStripMarkdown?: boolean;
  sanitizeRemoveBoilerplate?: boolean;
  
  // Augmented Overlay triggers
  overlayTriggerName?: string;
  overlayModeButton?: boolean;
  overlayButtonLabel?: string;
  overlayModeEmpty?: boolean;
  overlayModeElement?: boolean;
  overlayModeSelection?: boolean;
  overlayPhrases?: string;
  overlayUrlPattern?: string;
  overlayWrcodeOnly?: boolean;
  overlayPayloadSelection?: boolean;
  overlayPayloadContext?: boolean;
  overlayPayloadUrl?: boolean;
  overlayPayloadCoords?: boolean;
  
  // Workflow attachments
  sensorWorkflows?: TriggerWorkflow[];
  allowedActions?: TriggerWorkflow[];
}

// =============================================================================
// Section Types
// =============================================================================

/** Canonical listener configuration */
export interface CanonicalListener {
  /** Keywords/phrases for semantic matching */
  expectedContext: string;
  
  /** Input data types/tags to process */
  tags: string[];
  
  /** Input sources to listen on */
  sources: ListeningSource[];
  
  /** Website filter pattern (glob or regex) */
  website: string;
  
  /** 
   * Primary trigger list - the single source of truth for listener wiring.
   * Each trigger defines when and how the agent should activate.
   */
  unifiedTriggers: CanonicalTrigger[];
  
  /** Example files for context */
  exampleFiles?: any[];
  
  // @deprecated v2.1.0 - removed, triggers define activation
  // passiveEnabled?: boolean;
  // activeEnabled?: boolean;
  // triggers?: any[];
  // active?: any;
  // passive?: any;
}

/** Canonical reasoning workflow */
export interface CanonicalReasoningWorkflow {
  type: 'internal' | 'external';
  workflowId: string;
  conditions?: any[];
}

/** Canonical reasoning configuration */
export interface CanonicalReasoning {
  /** Triggers this section applies to - normalized array */
  applyForList: string[];
  
  goals: string;
  role: string;
  rules: string;
  custom: Array<{ key: string; value: string }>;
  acceptFrom: string[];
  memoryContext: {
    agentEnabled?: boolean;
    sessionEnabled?: boolean;
    accountEnabled?: boolean;
  };
  reasoningWorkflows: CanonicalReasoningWorkflow[];
  
  // @deprecated - derived from applyForList[0]
  // applyFor?: string;
}

/** Canonical execution workflow */
export interface CanonicalExecutionWorkflow {
  type: 'internal' | 'external';
  workflowId: string;
  runWhenType?: 'all' | 'conditional';
  conditions?: any[];
}

/** Canonical execution configuration */
export interface CanonicalExecution {
  /** Triggers this section applies to - normalized array */
  applyForList: string[];
  
  executionMode: ExecutionMode;
  
  /** Unified destinations - canonical */
  destinations: CanonicalDestination[];
  
  /** Execution workflows - canonical */
  executionWorkflows: CanonicalExecutionWorkflow[];
  
  // @deprecated - use destinations
  // specialDestinations?: any[];
  
  // @deprecated - use executionWorkflows
  // workflows?: string[];
}

// =============================================================================
// Root Agent Configuration
// =============================================================================

/** Canonical agent configuration - the primary export format */
export interface CanonicalAgentConfig {
  /** Schema version for compatibility */
  _schemaVersion: '2.1.0';
  
  /** Export metadata */
  _exportedAt: string;
  
  // Identity
  id: string;
  name: string;
  description: string;
  icon: string;
  number?: number;
  enabled: boolean;
  capabilities: Array<'listening' | 'reasoning' | 'execution'>;
  
  // Settings
  contextSettings: CanonicalContextSettings;
  memorySettings: CanonicalMemorySettings;
  
  // Sections
  listening?: CanonicalListener;
  
  /**
   * Reasoning sections - normalized array structure.
   * The first element (index 0) is the main/default reasoning section.
   * Additional sections can target specific triggers via applyForList.
   */
  reasoningSections?: CanonicalReasoning[];
  
  /**
   * Execution sections - normalized array structure.
   * The first element (index 0) is the main/default execution section.
   * Additional sections can target specific triggers via applyForList.
   */
  executionSections?: CanonicalExecution[];
  
  // Files
  agentContextFiles?: any[];
  
  // @deprecated v2.1.0 - use reasoningSections[0] instead
  // reasoning?: CanonicalReasoning;
  // @deprecated v2.1.0 - use executionSections[0] instead
  // execution?: CanonicalExecution;
}

// =============================================================================
// Schema Metadata (for UI display only)
// =============================================================================

/** Schema metadata for UI display */
export interface SchemaField {
  id: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'enum';
  required?: boolean;
  enumValues?: string[];
}

/** Schema-wrapped value (UI metadata only, not for canonical export) */
export interface SchemaWrappedValue<T> {
  _schema: SchemaField;
  value: T;
}

// =============================================================================
// Normalization Utilities
// =============================================================================

/**
 * Normalize a value that could be string or number to number
 */
export function normalizeToNumber(value: any, defaultValue: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Normalize applyFor/applyForList to canonical array
 */
export function normalizeApplyForList(applyFor?: string, applyForList?: string[]): string[] {
  if (applyForList && applyForList.length > 0) {
    return applyForList;
  }
  if (applyFor && applyFor !== '__any__') {
    return [applyFor];
  }
  return ['__any__'];
}

/**
 * Derive applyFor from applyForList (for UI display)
 */
export function deriveApplyFor(applyForList: string[]): string {
  return applyForList[0] || '__any__';
}

/**
 * Normalize destinations from legacy specialDestinations
 */
export function normalizeDestinations(
  destinations?: CanonicalDestination[],
  specialDestinations?: any[]
): CanonicalDestination[] {
  const result: CanonicalDestination[] = [];
  
  // Add existing destinations
  if (destinations && destinations.length > 0) {
    result.push(...destinations);
  }
  
  // Convert specialDestinations
  if (specialDestinations && specialDestinations.length > 0) {
    specialDestinations.forEach(sd => {
      if (sd.kind && !result.some(d => d.kind === sd.kind && JSON.stringify(d.agents) === JSON.stringify(sd.agents))) {
        result.push({
          kind: sd.kind as DestinationKind,
          agents: sd.agents || [],
          ...sd
        });
      }
    });
  }
  
  return result;
}

/**
 * Normalize a trigger to canonical format
 */
export function normalizeTrigger(trigger: any): CanonicalTrigger {
  const canonical: CanonicalTrigger = {
    id: trigger.id || '',
    type: trigger.type || 'direct_tag',
    enabled: trigger.enabled !== false,
  };
  
  // Copy all fields, normalizing numbers
  Object.keys(trigger).forEach(key => {
    if (key === 'parserInterval') {
      canonical.parserInterval = normalizeToNumber(trigger.parserInterval, 5);
    } else if (key === 'quietPeriodMs') {
      canonical.quietPeriodMs = normalizeToNumber(trigger.quietPeriodMs, 1500);
    } else if (key === 'maxWaitTimeMs') {
      canonical.maxWaitTimeMs = normalizeToNumber(trigger.maxWaitTimeMs, 60000);
    } else if (key !== 'id' && key !== 'type' && key !== 'enabled') {
      (canonical as any)[key] = trigger[key];
    }
  });
  
  // Remove legacy fields
  delete (canonical as any).buttonSelector;
  delete (canonical as any).inputSelector;
  delete (canonical as any).outputSelector;
  delete (canonical as any).outputWaitMethod;
  delete (canonical as any).outputWaitDelay;
  delete (canonical as any).tagName;
  
  return canonical;
}

/**
 * Helper to create a canonical reasoning section
 */
function toCanonicalReasoningSection(sec: any): CanonicalReasoning {
  return {
    applyForList: normalizeApplyForList(sec.applyFor, sec.applyForList),
    goals: sec.goals || '',
    role: sec.role || '',
    rules: sec.rules || '',
    custom: sec.custom || [],
    acceptFrom: sec.acceptFrom || [],
    memoryContext: {
      agentEnabled: sec.memoryContext?.agentEnabled ?? false,
      sessionEnabled: sec.memoryContext?.sessionEnabled ?? false,
      accountEnabled: sec.memoryContext?.accountEnabled ?? false,
    },
    reasoningWorkflows: sec.reasoningWorkflows || [],
  };
}

/**
 * Helper to create a canonical execution section
 */
function toCanonicalExecutionSection(sec: any): CanonicalExecution {
  return {
    applyForList: normalizeApplyForList(sec.applyFor, sec.applyForList),
    executionMode: sec.executionMode || 'agent_workflow',
    destinations: normalizeDestinations(sec.destinations, sec.specialDestinations),
    executionWorkflows: sec.executionWorkflows || [],
  };
}

/**
 * Convert raw agent data to canonical format (v2.1.0)
 * 
 * Key normalizations:
 * - passiveEnabled/activeEnabled removed from listening
 * - reasoning + reasoningSections merged into reasoningSections[]
 * - execution + executionSections merged into executionSections[]
 */
export function toCanonicalAgent(data: any): CanonicalAgentConfig {
  const canonical: CanonicalAgentConfig = {
    _schemaVersion: '2.1.0',
    _exportedAt: new Date().toISOString(),
    
    // Identity
    id: data.id || '',
    name: data.name || '',
    description: data.description || '',
    icon: data.icon || '🤖',
    number: typeof data.number === 'number' ? data.number : undefined,
    enabled: data.enabled !== false,
    capabilities: data.capabilities || [],
    
    // Settings - normalized
    contextSettings: {
      agentContext: data.contextSettings?.agentContext ?? false,
      sessionContext: data.contextSettings?.sessionContext ?? true,
      accountContext: data.contextSettings?.accountContext ?? true,
    },
    memorySettings: {
      agentEnabled: data.memorySettings?.agentEnabled ?? true,
      sessionEnabled: data.memorySettings?.sessionEnabled ?? false,
      accountEnabled: data.memorySettings?.accountEnabled ?? false,
    },
  };
  
  // Listener section - passiveEnabled/activeEnabled removed
  if (data.listening) {
    canonical.listening = {
      expectedContext: data.listening.expectedContext || '',
      tags: data.listening.tags || [],
      sources: data.listening.sources || ['all'],
      website: data.listening.website || '',
      unifiedTriggers: (data.listening.unifiedTriggers || []).map(normalizeTrigger),
      exampleFiles: data.listening.exampleFiles,
    };
  }
  
  // Reasoning sections - merge reasoning + reasoningSections into single array
  const allReasoningSections: CanonicalReasoning[] = [];
  
  // Add main reasoning section as first element
  if (data.reasoning) {
    allReasoningSections.push(toCanonicalReasoningSection(data.reasoning));
  }
  
  // Add additional reasoning sections
  if (data.reasoningSections && data.reasoningSections.length > 0) {
    data.reasoningSections.forEach((sec: any) => {
      allReasoningSections.push(toCanonicalReasoningSection(sec));
    });
  }
  
  if (allReasoningSections.length > 0) {
    canonical.reasoningSections = allReasoningSections;
  }
  
  // Execution sections - merge execution + executionSections into single array
  const allExecutionSections: CanonicalExecution[] = [];
  
  // Add main execution section as first element
  if (data.execution) {
    allExecutionSections.push(toCanonicalExecutionSection(data.execution));
  }
  
  // Add additional execution sections
  if (data.executionSections && data.executionSections.length > 0) {
    data.executionSections.forEach((sec: any) => {
      allExecutionSections.push(toCanonicalExecutionSection(sec));
    });
  }
  
  if (allExecutionSections.length > 0) {
    canonical.executionSections = allExecutionSections;
  }
  
  // Agent context files
  if (data.agentContextFiles && data.agentContextFiles.length > 0) {
    canonical.agentContextFiles = data.agentContextFiles;
  }
  
  return canonical;
}

/**
 * Generate schema metadata for UI display (separate from canonical export)
 */
export function generateSchemaMetadata(): Record<string, SchemaField> {
  return {
    'agent.id': { id: 'agent.id', description: 'Unique identifier for this agent.', type: 'string', required: true },
    'agent.name': { id: 'agent.name', description: 'Command identifier to reference this agent.', type: 'string', required: true },
    'agent.description': { id: 'agent.description', description: 'Human-readable description of what this agent does.', type: 'string' },
    'agent.icon': { id: 'agent.icon', description: 'Emoji or icon to visually identify this agent.', type: 'string' },
    'agent.enabled': { id: 'agent.enabled', description: 'Whether this agent is active.', type: 'boolean' },
    'agent.capabilities': { id: 'agent.capabilities', description: 'Enabled sections.', type: 'array' },
    
    'agent.listening.sources': { 
      id: 'agent.listening.sources', 
      description: 'Input sources to listen on.', 
      type: 'enum',
      enumValues: [...ListeningSourceValues]
    },
    
    'agent.execution.executionMode': {
      id: 'agent.execution.executionMode',
      description: 'How the agent generates and delivers output.',
      type: 'enum',
      enumValues: [...ExecutionModeValues]
    },
    
    'trigger.type': {
      id: 'trigger.type',
      description: 'The type of event that activates this trigger.',
      type: 'enum',
      enumValues: [...TriggerTypeValues]
    },
    
    'trigger.parserTrigger': {
      id: 'trigger.parserTrigger',
      description: 'When to trigger DOM parsing.',
      type: 'enum',
      enumValues: [...ParserTriggerValues]
    },
    
    'trigger.responseReadyMode': {
      id: 'trigger.responseReadyMode',
      description: 'How to detect when AI response is complete.',
      type: 'enum',
      enumValues: [...ResponseReadyModeValues]
    },
    
    'destination.kind': {
      id: 'destination.kind',
      description: 'Type of output destination.',
      type: 'enum',
      enumValues: [...DestinationKindValues]
    },
  };
}

