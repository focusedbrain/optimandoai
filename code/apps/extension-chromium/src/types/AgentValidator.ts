/**
 * Agent Configuration Validator
 * 
 * Provides runtime validation for agent configurations against the canonical schema.
 * Uses lightweight validation for browser extension context.
 * 
 * @module AgentValidator
 * @see /schemas/agent.schema.json for the full JSON Schema
 */

import {
  TriggerTypeValues,
  ParserTriggerValues,
  ResponseReadyModeValues,
  ExecutionModeValues,
  DestinationKindValues,
  ListeningSourceValues,
  type CanonicalAgentConfig,
  type CanonicalTrigger,
  type CanonicalReasoning,
  type CanonicalExecution,
} from './CanonicalAgentConfig';

export interface ValidationError {
  path: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/**
 * Validates an agent configuration against the canonical schema.
 * 
 * @param agent - The agent configuration to validate
 * @param agentId - Optional identifier for error messages
 * @returns Validation result with errors and warnings
 */
export function validateAgentConfig(agent: any, agentId?: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const prefix = agentId ? `[${agentId}] ` : '';

  // Helper to add error
  const addError = (path: string, message: string, value?: any) => {
    errors.push({ path, message: `${prefix}${message}`, value });
  };

  // Helper to check required string field
  const requireString = (obj: any, field: string, path: string) => {
    if (typeof obj[field] !== 'string') {
      addError(path, `Required field '${field}' must be a string`, obj[field]);
      return false;
    }
    return true;
  };

  // Helper to check required boolean field
  const requireBoolean = (obj: any, field: string, path: string) => {
    if (typeof obj[field] !== 'boolean') {
      addError(path, `Required field '${field}' must be a boolean`, obj[field]);
      return false;
    }
    return true;
  };

  // Helper to check enum value
  const checkEnum = (value: any, allowed: readonly string[], path: string, fieldName: string) => {
    if (value !== undefined && !allowed.includes(value)) {
      addError(path, `Invalid ${fieldName}: '${value}'. Allowed: ${allowed.join(', ')}`, value);
      return false;
    }
    return true;
  };

  // Check if agent is an object
  if (!agent || typeof agent !== 'object') {
    addError('', 'Agent configuration must be an object', agent);
    return { valid: false, errors, warnings };
  }

  // 1. Validate schema version
  if (agent._schemaVersion && agent._schemaVersion !== '2.1.0') {
    warnings.push(`${prefix}Schema version '${agent._schemaVersion}' differs from current '2.1.0'`);
  }

  // 2. Validate required identity fields
  requireString(agent, 'id', 'id');
  requireString(agent, 'name', 'name');
  requireBoolean(agent, 'enabled', 'enabled');

  // 3. Validate capabilities
  if (!Array.isArray(agent.capabilities)) {
    addError('capabilities', 'capabilities must be an array', agent.capabilities);
  } else {
    const validCaps = ['listening', 'reasoning', 'execution'];
    agent.capabilities.forEach((cap: any, i: number) => {
      if (!validCaps.includes(cap)) {
        addError(`capabilities[${i}]`, `Invalid capability: '${cap}'`, cap);
      }
    });
  }

  // 4. Validate contextSettings
  if (agent.contextSettings) {
    const cs = agent.contextSettings;
    if (typeof cs !== 'object') {
      addError('contextSettings', 'contextSettings must be an object', cs);
    } else {
      if (cs.agentContext !== undefined && typeof cs.agentContext !== 'boolean') {
        addError('contextSettings.agentContext', 'must be boolean', cs.agentContext);
      }
      if (cs.sessionContext !== undefined && typeof cs.sessionContext !== 'boolean') {
        addError('contextSettings.sessionContext', 'must be boolean', cs.sessionContext);
      }
      if (cs.accountContext !== undefined && typeof cs.accountContext !== 'boolean') {
        addError('contextSettings.accountContext', 'must be boolean', cs.accountContext);
      }
    }
  } else {
    addError('contextSettings', 'Required field contextSettings is missing');
  }

  // 5. Validate memorySettings
  if (agent.memorySettings) {
    const ms = agent.memorySettings;
    if (typeof ms !== 'object') {
      addError('memorySettings', 'memorySettings must be an object', ms);
    } else {
      if (ms.agentEnabled !== undefined && typeof ms.agentEnabled !== 'boolean') {
        addError('memorySettings.agentEnabled', 'must be boolean', ms.agentEnabled);
      }
      if (ms.sessionEnabled !== undefined && typeof ms.sessionEnabled !== 'boolean') {
        addError('memorySettings.sessionEnabled', 'must be boolean', ms.sessionEnabled);
      }
      if (ms.accountEnabled !== undefined && typeof ms.accountEnabled !== 'boolean') {
        addError('memorySettings.accountEnabled', 'must be boolean', ms.accountEnabled);
      }
    }
  } else {
    addError('memorySettings', 'Required field memorySettings is missing');
  }

  // 6. Validate listening section
  if (agent.listening) {
    const l = agent.listening;
    
    // Validate sources
    if (l.sources && Array.isArray(l.sources)) {
      l.sources.forEach((src: any, i: number) => {
        checkEnum(src, ListeningSourceValues, `listening.sources[${i}]`, 'source');
      });
    }

    // Validate unifiedTriggers
    if (l.unifiedTriggers && Array.isArray(l.unifiedTriggers)) {
      l.unifiedTriggers.forEach((trigger: any, i: number) => {
        validateTrigger(trigger, `listening.unifiedTriggers[${i}]`, errors, warnings, prefix);
      });
    }
  }

  // 7. Validate reasoningSections
  if (agent.reasoningSections && Array.isArray(agent.reasoningSections)) {
    agent.reasoningSections.forEach((sec: any, i: number) => {
      validateReasoningSection(sec, `reasoningSections[${i}]`, errors, warnings, prefix);
    });
  }

  // 8. Validate executionSections
  if (agent.executionSections && Array.isArray(agent.executionSections)) {
    agent.executionSections.forEach((sec: any, i: number) => {
      validateExecutionSection(sec, `executionSections[${i}]`, errors, warnings, prefix);
    });
  }

  // 9. Check for deprecated fields
  const deprecatedFields = [
    'passiveEnabled', 'activeEnabled', 'reasoning', 'execution',
    'triggers', 'workflows', 'specialDestinations', 'applyFor'
  ];
  
  deprecatedFields.forEach(field => {
    if (agent[field] !== undefined) {
      warnings.push(`${prefix}Deprecated field '${field}' found at root level`);
    }
    if (agent.listening && (agent.listening as any)[field] !== undefined) {
      warnings.push(`${prefix}Deprecated field 'listening.${field}' found`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates a trigger configuration
 */
function validateTrigger(
  trigger: any,
  path: string,
  errors: ValidationError[],
  warnings: string[],
  prefix: string
) {
  if (!trigger || typeof trigger !== 'object') {
    errors.push({ path, message: `${prefix}Trigger must be an object`, value: trigger });
    return;
  }

  // Required fields
  if (typeof trigger.id !== 'string') {
    errors.push({ path: `${path}.id`, message: `${prefix}Trigger id must be a string`, value: trigger.id });
  }

  if (typeof trigger.enabled !== 'boolean') {
    errors.push({ path: `${path}.enabled`, message: `${prefix}Trigger enabled must be boolean`, value: trigger.enabled });
  }

  // Validate type enum
  if (!TriggerTypeValues.includes(trigger.type)) {
    errors.push({ 
      path: `${path}.type`, 
      message: `${prefix}Invalid trigger type: '${trigger.type}'. Allowed: ${TriggerTypeValues.join(', ')}`,
      value: trigger.type 
    });
  }

  // Validate parserTrigger enum if present
  if (trigger.parserTrigger !== undefined) {
    if (!ParserTriggerValues.includes(trigger.parserTrigger)) {
      errors.push({
        path: `${path}.parserTrigger`,
        message: `${prefix}Invalid parserTrigger: '${trigger.parserTrigger}'. Allowed: ${ParserTriggerValues.join(', ')}`,
        value: trigger.parserTrigger
      });
    }
  }

  // Validate responseReadyMode enum if present
  if (trigger.responseReadyMode !== undefined) {
    if (!ResponseReadyModeValues.includes(trigger.responseReadyMode)) {
      errors.push({
        path: `${path}.responseReadyMode`,
        message: `${prefix}Invalid responseReadyMode: '${trigger.responseReadyMode}'. Allowed: ${ResponseReadyModeValues.join(', ')}`,
        value: trigger.responseReadyMode
      });
    }
  }

  // Validate numeric fields are numbers
  const numericFields = ['parserInterval', 'quietPeriodMs', 'maxWaitTimeMs'];
  numericFields.forEach(field => {
    if (trigger[field] !== undefined && typeof trigger[field] !== 'number') {
      warnings.push(`${prefix}${path}.${field} should be a number, got ${typeof trigger[field]}`);
    }
  });

  // Validate array fields
  const arrayFields = ['siteFilters', 'buttonSelectors', 'inputSelectors', 'outputSelectors', 'metaSelectors'];
  arrayFields.forEach(field => {
    if (trigger[field] !== undefined && !Array.isArray(trigger[field])) {
      errors.push({
        path: `${path}.${field}`,
        message: `${prefix}${field} must be an array`,
        value: trigger[field]
      });
    }
  });
}

/**
 * Validates a reasoning section
 */
function validateReasoningSection(
  sec: any,
  path: string,
  errors: ValidationError[],
  warnings: string[],
  prefix: string
) {
  if (!sec || typeof sec !== 'object') {
    errors.push({ path, message: `${prefix}Reasoning section must be an object`, value: sec });
    return;
  }

  // Required: applyForList
  if (!Array.isArray(sec.applyForList) || sec.applyForList.length === 0) {
    errors.push({
      path: `${path}.applyForList`,
      message: `${prefix}applyForList must be a non-empty array`,
      value: sec.applyForList
    });
  }

  // Check for deprecated applyFor
  if (sec.applyFor !== undefined) {
    warnings.push(`${prefix}${path}.applyFor is deprecated, use applyForList`);
  }
}

/**
 * Validates an execution section
 */
function validateExecutionSection(
  sec: any,
  path: string,
  errors: ValidationError[],
  warnings: string[],
  prefix: string
) {
  if (!sec || typeof sec !== 'object') {
    errors.push({ path, message: `${prefix}Execution section must be an object`, value: sec });
    return;
  }

  // Required: applyForList
  if (!Array.isArray(sec.applyForList) || sec.applyForList.length === 0) {
    errors.push({
      path: `${path}.applyForList`,
      message: `${prefix}applyForList must be a non-empty array`,
      value: sec.applyForList
    });
  }

  // Required: executionMode
  if (!ExecutionModeValues.includes(sec.executionMode)) {
    errors.push({
      path: `${path}.executionMode`,
      message: `${prefix}Invalid executionMode: '${sec.executionMode}'. Allowed: ${ExecutionModeValues.join(', ')}`,
      value: sec.executionMode
    });
  }

  // Validate destinations
  if (sec.destinations && Array.isArray(sec.destinations)) {
    sec.destinations.forEach((dest: any, i: number) => {
      if (dest && dest.kind && !DestinationKindValues.includes(dest.kind)) {
        errors.push({
          path: `${path}.destinations[${i}].kind`,
          message: `${prefix}Invalid destination kind: '${dest.kind}'. Allowed: ${DestinationKindValues.join(', ')}`,
          value: dest.kind
        });
      }
    });
  }

  // Check for deprecated fields
  if (sec.applyFor !== undefined) {
    warnings.push(`${prefix}${path}.applyFor is deprecated, use applyForList`);
  }
  if (sec.specialDestinations !== undefined) {
    warnings.push(`${prefix}${path}.specialDestinations is deprecated, use destinations`);
  }
  if (sec.workflows !== undefined) {
    warnings.push(`${prefix}${path}.workflows is deprecated, use executionWorkflows`);
  }
}

/**
 * Logs validation results to console with clear formatting
 */
export function logValidationResult(result: ValidationResult, agentName?: string) {
  const label = agentName ? `Agent "${agentName}"` : 'Agent';
  
  if (result.valid && result.warnings.length === 0) {
    console.log(`✅ ${label} validation passed`);
    return;
  }

  if (result.valid) {
    console.log(`⚠️ ${label} validation passed with warnings:`);
    result.warnings.forEach(w => console.warn(`  - ${w}`));
  } else {
    console.error(`❌ ${label} validation failed:`);
    result.errors.forEach(e => console.error(`  ❌ ${e.path}: ${e.message}`));
    if (result.warnings.length > 0) {
      console.warn(`  Warnings:`);
      result.warnings.forEach(w => console.warn(`    - ${w}`));
    }
  }
}

