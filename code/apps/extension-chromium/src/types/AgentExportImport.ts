/**
 * Agent Export/Import Module
 * 
 * This module provides functions to export and import agent configurations
 * as JSON with full type schema information and current state.
 * 
 * Export format includes:
 * - Schema version for compatibility checking
 * - Full type schema for each element (machine-readable)
 * - Current configuration values (state)
 * - Metadata (export date, source, etc.)
 * 
 * @version 1.0.0
 * @module AgentExportImport
 */

import {
  SCHEMA_VERSION,
  CompleteAgentSchema,
  AgentIdentitySchema,
  ListenerSectionSchema,
  ListenerElementsSchema,
  TriggerSchema,
  TriggerElementsSchema,
  ReasoningSectionSchema,
  ReasoningElementsSchema,
  MemoryContextSchema,
  ExecutionSectionSchema,
  ExecutionElementsSchema,
  SchemaNode,
  getSchemaNodeMap,
  computeSchemaHash,
} from './AgentTypeSchema';

// =============================================================================
// Export Types
// =============================================================================

export interface AgentExportMetadata {
  /** Schema version used for this export */
  schemaVersion: string;
  
  /** ISO timestamp of when this export was created */
  exportedAt: string;
  
  /** Source of the export (extension version, etc.) */
  source: string;
  
  /** Hash of the schema structure for integrity */
  schemaHash: string;
  
  /** Format version for the export structure */
  formatVersion: string;
}

export interface SchemaElement {
  /** Unique identifier for this schema element */
  id: string;
  
  /** Human-readable label */
  label: string;
  
  /** Machine-readable key */
  key: string;
  
  /** Description of this element */
  description: string;
  
  /** Data type */
  type: string;
  
  /** Whether this field is required */
  required: boolean;
}

export interface AgentExportSection {
  /** Schema for this section */
  _schema: SchemaElement;
  
  /** Child elements with their schemas and values */
  [key: string]: any;
}

export interface AgentExportFormat {
  /** Export metadata */
  _metadata: AgentExportMetadata;
  
  /** Root agent schema */
  _rootSchema: SchemaElement;
  
  /** Agent identity fields */
  identity: {
    _schema: SchemaElement;
    id: { _schema: SchemaElement; value: string };
    name: { _schema: SchemaElement; value: string };
    description: { _schema: SchemaElement; value: string };
    icon: { _schema: SchemaElement; value: string };
    number: { _schema: SchemaElement; value: number | null };
    enabled: { _schema: SchemaElement; value: boolean };
    capabilities: { _schema: SchemaElement; value: string[] };
  };
  
  /** Listener section */
  listener?: AgentExportSection;
  
  /** Reasoning section */
  reasoning?: AgentExportSection;
  
  /** Reasoning sections (additional) */
  reasoningSections?: AgentExportSection[];
  
  /** Execution section */
  execution?: AgentExportSection;
  
  /** Context settings */
  contextSettings?: any;
  
  /** Memory settings */
  memorySettings?: any;
  
  /** Agent context files */
  agentContextFiles?: any[];
}

export interface AgentImportResult {
  success: boolean;
  agent?: any;
  errors?: string[];
  warnings?: string[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert a SchemaNode to a simplified SchemaElement for export
 */
function schemaNodeToElement(node: SchemaNode): SchemaElement {
  return {
    id: node.id,
    label: node.humanLabel,
    key: node.machineKey,
    description: node.description,
    type: node.type,
    required: node.required,
  };
}

/**
 * Wrap a value with its schema for export
 */
function wrapWithSchema(schema: SchemaNode, value: any): { _schema: SchemaElement; value: any } {
  return {
    _schema: schemaNodeToElement(schema),
    value: value,
  };
}

/**
 * Process array items with schema (for triggers, workflows, etc.)
 */
function processArrayWithSchema(
  items: any[], 
  itemSchemas: Record<string, SchemaNode>,
  getItemValue: (item: any, key: string) => any
): any[] {
  return items.map(item => {
    const result: any = {};
    Object.entries(itemSchemas).forEach(([key, schema]) => {
      const value = getItemValue(item, schema.machineKey);
      if (value !== undefined) {
        result[key] = wrapWithSchema(schema, value);
      }
    });
    return result;
  });
}

// =============================================================================
// Export Functions
// =============================================================================

/**
 * Export an agent configuration to the full JSON format with schema information
 * 
 * @param agentConfig - The raw agent configuration from storage
 * @returns AgentExportFormat - The full export with schema and values
 */
export function exportAgentToJson(agentConfig: any): AgentExportFormat {
  const metadata: AgentExportMetadata = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'Optimando AI Extension',
    schemaHash: computeSchemaHash(CompleteAgentSchema.root),
    formatVersion: '1.0.0',
  };
  
  const exported: AgentExportFormat = {
    _metadata: metadata,
    _rootSchema: schemaNodeToElement(CompleteAgentSchema.root),
    identity: {
      _schema: {
        id: 'agent.identity',
        label: 'Agent Identity',
        key: 'identity',
        description: 'Core identifying information for the agent.',
        type: 'object',
        required: true,
      },
      id: wrapWithSchema(AgentIdentitySchema.id, agentConfig.id || ''),
      name: wrapWithSchema(AgentIdentitySchema.name, agentConfig.name || ''),
      description: wrapWithSchema(AgentIdentitySchema.description, agentConfig.description || ''),
      icon: wrapWithSchema(AgentIdentitySchema.icon, agentConfig.icon || '🤖'),
      number: wrapWithSchema(AgentIdentitySchema.number, agentConfig.number ?? null),
      enabled: wrapWithSchema(AgentIdentitySchema.enabled, agentConfig.enabled ?? true),
      capabilities: wrapWithSchema(AgentIdentitySchema.capabilities, agentConfig.capabilities || []),
    },
  };
  
  // Export Listener section if present
  if (agentConfig.listening) {
    const listening = agentConfig.listening;
    exported.listener = {
      _schema: schemaNodeToElement(ListenerSectionSchema),
      passiveEnabled: wrapWithSchema(ListenerElementsSchema.passiveEnabled, listening.passiveEnabled ?? false),
      activeEnabled: wrapWithSchema(ListenerElementsSchema.activeEnabled, listening.activeEnabled ?? true),
      expectedContext: wrapWithSchema(ListenerElementsSchema.expectedContext, listening.expectedContext || ''),
      tags: wrapWithSchema(ListenerElementsSchema.tags, listening.tags || []),
      source: wrapWithSchema(ListenerElementsSchema.source, listening.source || 'all'),
      website: wrapWithSchema(ListenerElementsSchema.website, listening.website || ''),
      unifiedTriggers: wrapWithSchema(
        ListenerElementsSchema.unifiedTriggers,
        exportTriggers(listening.unifiedTriggers || [])
      ),
    };
    
    // Include legacy trigger formats if present
    if (listening.triggers) {
      (exported.listener as any).triggers = {
        _schema: {
          id: 'agent.listening.triggers',
          label: 'Action Triggers (Legacy)',
          key: 'triggers',
          description: 'Legacy format for action triggers.',
          type: 'array',
          required: false,
        },
        value: listening.triggers,
      };
    }
    
    if (listening.active?.triggers) {
      (exported.listener as any).activeTriggers = {
        _schema: {
          id: 'agent.listening.active.triggers',
          label: 'Active Triggers (Legacy)',
          key: 'activeTriggers',
          description: 'Legacy format for active triggers.',
          type: 'array',
          required: false,
        },
        value: listening.active.triggers,
      };
    }
  }
  
  // Export Reasoning section if present
  if (agentConfig.reasoning) {
    const reasoning = agentConfig.reasoning;
    exported.reasoning = {
      _schema: schemaNodeToElement(ReasoningSectionSchema),
      applyFor: wrapWithSchema(ReasoningElementsSchema.applyFor, reasoning.applyFor || '__any__'),
      applyForList: wrapWithSchema(ReasoningElementsSchema.applyForList, reasoning.applyForList || ['__any__']),
      goals: wrapWithSchema(ReasoningElementsSchema.goals, reasoning.goals || ''),
      role: wrapWithSchema(ReasoningElementsSchema.role, reasoning.role || ''),
      rules: wrapWithSchema(ReasoningElementsSchema.rules, reasoning.rules || ''),
      custom: wrapWithSchema(ReasoningElementsSchema.custom, reasoning.custom || []),
      acceptFrom: wrapWithSchema(ReasoningElementsSchema.acceptFrom, reasoning.acceptFrom || []),
      memoryContext: wrapWithSchema(ReasoningElementsSchema.memoryContext, reasoning.memoryContext || {}),
      reasoningWorkflows: wrapWithSchema(
        ReasoningElementsSchema.reasoningWorkflows, 
        reasoning.reasoningWorkflows || []
      ),
    };
  }
  
  // Export additional Reasoning sections
  if (agentConfig.reasoningSections && agentConfig.reasoningSections.length > 0) {
    exported.reasoningSections = agentConfig.reasoningSections.map((section: any, index: number) => ({
      _schema: {
        id: `agent.reasoningSections.${index}`,
        label: `Reasoning Section ${index + 1}`,
        key: `reasoningSection${index}`,
        description: `Additional reasoning section ${index + 1}.`,
        type: 'object',
        required: false,
      },
      applyFor: wrapWithSchema(ReasoningElementsSchema.applyFor, section.applyFor || '__any__'),
      applyForList: wrapWithSchema(ReasoningElementsSchema.applyForList, section.applyForList || ['__any__']),
      goals: wrapWithSchema(ReasoningElementsSchema.goals, section.goals || ''),
      role: wrapWithSchema(ReasoningElementsSchema.role, section.role || ''),
      rules: wrapWithSchema(ReasoningElementsSchema.rules, section.rules || ''),
      custom: wrapWithSchema(ReasoningElementsSchema.custom, section.custom || []),
      acceptFrom: wrapWithSchema(ReasoningElementsSchema.acceptFrom, section.acceptFrom || []),
      reasoningWorkflows: wrapWithSchema(
        ReasoningElementsSchema.reasoningWorkflows, 
        section.reasoningWorkflows || []
      ),
    }));
  }
  
  // Export Execution section if present
  if (agentConfig.execution) {
    const execution = agentConfig.execution;
    exported.execution = {
      _schema: schemaNodeToElement(ExecutionSectionSchema),
      applyFor: wrapWithSchema(ExecutionElementsSchema.applyFor, execution.applyFor || '__any__'),
      applyForList: wrapWithSchema(ExecutionElementsSchema.applyForList, execution.applyForList || ['__any__']),
      executionMode: wrapWithSchema(ExecutionElementsSchema.executionMode, execution.executionMode || 'agent_workflow'),
      specialDestinations: wrapWithSchema(ExecutionElementsSchema.specialDestinations, execution.specialDestinations || []),
      workflows: wrapWithSchema(ExecutionElementsSchema.workflows, execution.workflows || []),
      executionWorkflows: wrapWithSchema(ExecutionElementsSchema.executionWorkflows, execution.executionWorkflows || []),
      executionSections: wrapWithSchema(ExecutionElementsSchema.executionSections, execution.executionSections || []),
    };
  }
  
  // Export context settings
  if (agentConfig.contextSettings) {
    exported.contextSettings = {
      _schema: {
        id: 'agent.contextSettings',
        label: 'Context Settings',
        key: 'contextSettings',
        description: 'Configuration for context access during agent processing.',
        type: 'object',
        required: false,
      },
      value: agentConfig.contextSettings,
    };
  }
  
  // Export memory settings
  if (agentConfig.memorySettings) {
    exported.memorySettings = {
      _schema: {
        id: 'agent.memorySettings',
        label: 'Memory Settings',
        key: 'memorySettings',
        description: 'Configuration for memory access and persistence.',
        type: 'object',
        required: false,
      },
      value: agentConfig.memorySettings,
    };
  }
  
  // Export agent context files (without data for size)
  if (agentConfig.agentContextFiles && agentConfig.agentContextFiles.length > 0) {
    exported.agentContextFiles = agentConfig.agentContextFiles.map((file: any) => ({
      _schema: {
        id: 'agent.agentContextFile',
        label: 'Agent Context File',
        key: 'agentContextFile',
        description: 'File attached as context for this agent.',
        type: 'file',
        required: false,
      },
      name: file.name,
      type: file.type,
      size: file.size,
      // Note: data is excluded by default to reduce export size
      // Set includeFileData: true in options to include
    }));
  }
  
  return exported;
}

/**
 * Export triggers with full schema information
 */
function exportTriggers(triggers: any[]): any[] {
  return triggers.map(trigger => ({
    _triggerSchema: schemaNodeToElement(TriggerSchema),
    id: wrapWithSchema(TriggerElementsSchema.id, trigger.id || ''),
    type: wrapWithSchema(TriggerElementsSchema.type, trigger.type || 'direct_tag'),
    enabled: wrapWithSchema(TriggerElementsSchema.enabled, trigger.enabled ?? true),
    tag: wrapWithSchema(TriggerElementsSchema.tag, trigger.tag || ''),
    channel: wrapWithSchema(TriggerElementsSchema.channel, trigger.channel || 'chat'),
    eventTagConditions: wrapWithSchema(TriggerElementsSchema.eventTagConditions, trigger.eventTagConditions || []),
    sensorWorkflows: wrapWithSchema(TriggerElementsSchema.sensorWorkflows, trigger.sensorWorkflows || []),
    allowedActions: wrapWithSchema(TriggerElementsSchema.allowedActions, trigger.allowedActions || []),
    // Include all other trigger properties
    ...Object.fromEntries(
      Object.entries(trigger)
        .filter(([key]) => !['id', 'type', 'enabled', 'tag', 'channel', 'eventTagConditions', 'sensorWorkflows', 'allowedActions'].includes(key))
        .map(([key, value]) => [key, { value }])
    ),
  }));
}

/**
 * Export agent to a downloadable JSON string with pretty formatting
 */
export function exportAgentToJsonString(agentConfig: any, prettyPrint: boolean = true): string {
  const exported = exportAgentToJson(agentConfig);
  return prettyPrint 
    ? JSON.stringify(exported, null, 2) 
    : JSON.stringify(exported);
}

/**
 * Export agent to a compact format (values only, no schema)
 * Useful for smaller file sizes when schema information is not needed
 */
export function exportAgentCompact(agentConfig: any): any {
  return {
    _metadata: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      format: 'compact',
    },
    agent: agentConfig,
  };
}

// =============================================================================
// Import Functions
// =============================================================================

/**
 * Import an agent from the full JSON format with schema validation
 * 
 * @param jsonData - The exported JSON data (object or string)
 * @returns AgentImportResult - The result with agent config or errors
 */
export function importAgentFromJson(jsonData: string | AgentExportFormat | any): AgentImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  try {
    // Parse JSON if string
    let data: any;
    if (typeof jsonData === 'string') {
      try {
        data = JSON.parse(jsonData);
      } catch (e) {
        return { success: false, errors: ['Invalid JSON format'] };
      }
    } else {
      data = jsonData;
    }
    
    // Check for compact format
    if (data._metadata?.format === 'compact' && data.agent) {
      return {
        success: true,
        agent: data.agent,
        warnings: ['Imported from compact format (no schema validation)'],
      };
    }
    
    // Validate metadata
    if (!data._metadata) {
      warnings.push('Missing metadata - import may be from an older format');
    } else {
      if (data._metadata.schemaVersion !== SCHEMA_VERSION) {
        warnings.push(`Schema version mismatch: file=${data._metadata.schemaVersion}, current=${SCHEMA_VERSION}`);
      }
    }
    
    // Extract values from schema-wrapped format
    const agent: any = {};
    
    // Extract identity fields
    if (data.identity) {
      agent.id = extractValue(data.identity.id);
      agent.name = extractValue(data.identity.name);
      agent.description = extractValue(data.identity.description);
      agent.icon = extractValue(data.identity.icon) || '🤖';
      agent.number = extractValue(data.identity.number);
      agent.enabled = extractValue(data.identity.enabled) ?? true;
      agent.capabilities = extractValue(data.identity.capabilities) || [];
    }
    
    // Validate required fields
    if (!agent.name) {
      errors.push('Agent name is required');
    }
    
    // Generate ID if missing
    if (!agent.id) {
      agent.id = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      warnings.push('Generated new agent ID');
    }
    
    // Extract Listener section
    if (data.listener) {
      agent.listening = {
        passiveEnabled: extractValue(data.listener.passiveEnabled) ?? false,
        activeEnabled: extractValue(data.listener.activeEnabled) ?? true,
        expectedContext: extractValue(data.listener.expectedContext) || '',
        tags: extractValue(data.listener.tags) || [],
        source: extractValue(data.listener.source) || 'all',
        website: extractValue(data.listener.website) || '',
        unifiedTriggers: importTriggers(extractValue(data.listener.unifiedTriggers) || []),
      };
      
      // Handle legacy formats
      if (data.listener.triggers) {
        agent.listening.triggers = extractValue(data.listener.triggers) || [];
      }
      if (data.listener.activeTriggers) {
        agent.listening.active = {
          triggers: extractValue(data.listener.activeTriggers) || [],
        };
      }
    }
    
    // Extract Reasoning section
    if (data.reasoning) {
      agent.reasoning = {
        applyFor: extractValue(data.reasoning.applyFor) || '__any__',
        applyForList: extractValue(data.reasoning.applyForList) || ['__any__'],
        goals: extractValue(data.reasoning.goals) || '',
        role: extractValue(data.reasoning.role) || '',
        rules: extractValue(data.reasoning.rules) || '',
        custom: extractValue(data.reasoning.custom) || [],
        acceptFrom: extractValue(data.reasoning.acceptFrom) || [],
        memoryContext: extractValue(data.reasoning.memoryContext) || {},
        reasoningWorkflows: extractValue(data.reasoning.reasoningWorkflows) || [],
      };
    }
    
    // Extract additional Reasoning sections
    if (data.reasoningSections && Array.isArray(data.reasoningSections)) {
      agent.reasoningSections = data.reasoningSections.map((section: any) => ({
        applyFor: extractValue(section.applyFor) || '__any__',
        applyForList: extractValue(section.applyForList) || ['__any__'],
        goals: extractValue(section.goals) || '',
        role: extractValue(section.role) || '',
        rules: extractValue(section.rules) || '',
        custom: extractValue(section.custom) || [],
        acceptFrom: extractValue(section.acceptFrom) || [],
        reasoningWorkflows: extractValue(section.reasoningWorkflows) || [],
      }));
    }
    
    // Extract Execution section
    if (data.execution) {
      agent.execution = {
        applyFor: extractValue(data.execution.applyFor) || '__any__',
        applyForList: extractValue(data.execution.applyForList) || ['__any__'],
        executionMode: extractValue(data.execution.executionMode) || 'agent_workflow',
        specialDestinations: extractValue(data.execution.specialDestinations) || [],
        workflows: extractValue(data.execution.workflows) || [],
        executionWorkflows: extractValue(data.execution.executionWorkflows) || [],
        executionSections: extractValue(data.execution.executionSections) || [],
      };
    }
    
    // Extract context settings
    if (data.contextSettings) {
      agent.contextSettings = extractValue(data.contextSettings);
    }
    
    // Extract memory settings
    if (data.memorySettings) {
      agent.memorySettings = extractValue(data.memorySettings);
    }
    
    // Note: Agent context files are not imported by default (would need file data)
    if (data.agentContextFiles && data.agentContextFiles.length > 0) {
      warnings.push(`${data.agentContextFiles.length} context file(s) were not imported (file data not included)`);
    }
    
    if (errors.length > 0) {
      return { success: false, errors, warnings };
    }
    
    return {
      success: true,
      agent,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
    
  } catch (error: any) {
    return {
      success: false,
      errors: [`Import error: ${error.message || 'Unknown error'}`],
    };
  }
}

/**
 * Extract value from a schema-wrapped field or direct value
 */
function extractValue(field: any): any {
  if (field === undefined || field === null) {
    return undefined;
  }
  
  // If it's a schema-wrapped value
  if (typeof field === 'object' && 'value' in field) {
    return field.value;
  }
  
  // If it's a direct value
  return field;
}

/**
 * Import triggers from exported format
 */
function importTriggers(triggers: any[]): any[] {
  return triggers.map(trigger => {
    const result: any = {};
    
    // Extract standard trigger fields
    result.id = extractValue(trigger.id) || `trigger-${Date.now()}`;
    result.type = extractValue(trigger.type) || 'direct_tag';
    result.enabled = extractValue(trigger.enabled) ?? true;
    result.tag = extractValue(trigger.tag) || '';
    result.channel = extractValue(trigger.channel) || 'chat';
    result.eventTagConditions = extractValue(trigger.eventTagConditions) || [];
    result.sensorWorkflows = extractValue(trigger.sensorWorkflows) || [];
    result.allowedActions = extractValue(trigger.allowedActions) || [];
    
    // Extract any additional properties
    Object.entries(trigger).forEach(([key, value]) => {
      if (!['_triggerSchema', 'id', 'type', 'enabled', 'tag', 'channel', 'eventTagConditions', 'sensorWorkflows', 'allowedActions'].includes(key)) {
        result[key] = extractValue(value);
      }
    });
    
    return result;
  });
}

/**
 * Validate an imported agent configuration
 */
export function validateAgentConfig(agent: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required fields
  if (!agent.name || typeof agent.name !== 'string') {
    errors.push('Agent must have a valid name');
  }
  
  if (agent.name && !/^[a-z0-9-]+$/.test(agent.name)) {
    errors.push('Agent name must be lowercase with hyphens only');
  }
  
  // Validate capabilities array
  if (agent.capabilities && !Array.isArray(agent.capabilities)) {
    errors.push('Capabilities must be an array');
  }
  
  // Validate listener section
  if (agent.listening) {
    if (agent.listening.unifiedTriggers && !Array.isArray(agent.listening.unifiedTriggers)) {
      errors.push('Unified triggers must be an array');
    }
  }
  
  // Validate reasoning section
  if (agent.reasoning) {
    if (agent.reasoning.custom && !Array.isArray(agent.reasoning.custom)) {
      errors.push('Custom fields must be an array');
    }
  }
  
  // Validate execution section
  if (agent.execution) {
    if (agent.execution.specialDestinations && !Array.isArray(agent.execution.specialDestinations)) {
      errors.push('Special destinations must be an array');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// =============================================================================
// Browser Download/Upload Utilities
// =============================================================================

/**
 * Trigger a download of the agent configuration as a JSON file
 */
export function downloadAgentAsJson(agentConfig: any, filename?: string): void {
  const json = exportAgentToJsonString(agentConfig, true);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `agent-${agentConfig.name || 'export'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read an agent configuration from a file input
 */
export function readAgentFromFile(file: File): Promise<AgentImportResult> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const result = importAgentFromJson(content);
        resolve(result);
      } catch (error: any) {
        resolve({
          success: false,
          errors: [`Failed to read file: ${error.message || 'Unknown error'}`],
        });
      }
    };
    
    reader.onerror = () => {
      resolve({
        success: false,
        errors: ['Failed to read file'],
      });
    };
    
    reader.readAsText(file);
  });
}




