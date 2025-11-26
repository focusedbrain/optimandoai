/**
 * Legacy Config Adapter
 * 
 * Converts old AgentConfig format to new AutomationConfig format.
 * Ensures backward compatibility with existing agent configurations.
 */

import type {
  AutomationConfig,
  TriggerConfig,
  TriggerSource,
  TriggerScope,
  Modality,
  ListenerMode,
  LegacyAgentConfig,
  LegacyListeningConfig,
  LegacyTrigger
} from '../types'

/**
 * Map legacy source strings to new TriggerSource
 * 
 * Legacy "Listen on (type)" values were mixed between source and modality.
 * This function attempts to extract the source.
 */
export function adaptLegacySource(legacySource: string | undefined): TriggerSource {
  if (!legacySource) return 'chat'
  
  const source = legacySource.toLowerCase()
  
  // Direct mappings
  if (source === 'chat' || source === 'message') return 'chat'
  if (source === 'dom' || source === 'page' || source === 'webpage') return 'dom'
  if (source === 'api' || source === 'webhook') return 'api'
  if (source === 'backend' || source === 'service') return 'backend'
  if (source === 'workflow') return 'workflow'
  if (source === 'cron' || source === 'schedule' || source === 'scheduled') return 'cron'
  
  // Content-type based defaults (legacy mixed source/modality)
  if (source === 'text' || source === 'image' || source === 'all') return 'chat'
  if (source === 'screenshot' || source === 'screen') return 'dom'
  
  // Default to chat
  return 'chat'
}

/**
 * Infer modalities from legacy agent config
 */
function inferModalities(agent: LegacyAgentConfig): Modality[] {
  const modalities: Modality[] = ['text']
  
  // Check legacy source for modality hints
  const source = agent.listening?.source?.toLowerCase()
  if (source === 'image' || source === 'screenshot') {
    modalities.push('image')
  }
  if (source === 'all') {
    modalities.push('image', 'video', 'code')
  }
  
  // Check tags for modality hints
  const tags = agent.listening?.tags || []
  if (tags.includes('image') || tags.includes('screenshot')) {
    if (!modalities.includes('image')) modalities.push('image')
  }
  if (tags.includes('video')) {
    if (!modalities.includes('video')) modalities.push('video')
  }
  if (tags.includes('code')) {
    if (!modalities.includes('code')) modalities.push('code')
  }
  
  // Check applyFor for modality hints
  const applyFor = agent.reasoning?.applyFor?.toLowerCase()
  if (applyFor === 'image') {
    if (!modalities.includes('image')) modalities.push('image')
  }
  if (applyFor === 'mixed') {
    if (!modalities.includes('image')) modalities.push('image')
  }
  
  return modalities
}

/**
 * Extract @mention patterns from legacy triggers
 */
function extractPatterns(triggers: LegacyTrigger[] | undefined): string[] {
  if (!triggers) return []
  
  return triggers
    .map(t => t.tag?.name)
    .filter((name): name is string => !!name)
}

/**
 * Convert legacy agent config to new automation config
 * 
 * @param agent - Legacy AgentConfig
 * @returns New AutomationConfig
 */
export function adaptLegacyConfig(agent: LegacyAgentConfig): AutomationConfig {
  const listening = agent.listening || {}
  
  // Determine mode
  const mode: ListenerMode = listening.passiveEnabled ? 'passive' : 'active'
  
  // Build trigger config
  const trigger: TriggerConfig = {
    source: adaptLegacySource(listening.source),
    scope: 'agent' as TriggerScope,
    modalities: inferModalities(agent)
  }
  
  // Extract patterns from both passive and active triggers
  const passivePatterns = extractPatterns(listening.passive?.triggers)
  const activePatterns = extractPatterns(listening.active?.triggers)
  const patterns = [...new Set([...passivePatterns, ...activePatterns])]
  
  // Build automation config
  const config: AutomationConfig = {
    id: `auto_${agent.id}`,
    name: agent.name || `Agent ${agent.key || agent.id}`,
    enabled: agent.enabled,
    mode,
    trigger,
    
    // Legacy pattern matching
    tags: listening.tags,
    patterns: patterns.length > 0 ? patterns : undefined,
    expectedContext: listening.expectedContext,
    website: listening.website,
    
    // Pipeline (empty for legacy - will use default reasoning)
    sensorWorkflows: [],
    conditions: null, // Legacy used simple matching, no conditions
    reasoningProfile: agent.id,
    allowedActions: agent.execution?.workflows || [],
    
    // Reporting
    reportTo: listening.reportTo
  }
  
  return config
}

/**
 * Legacy Config Adapter class
 * 
 * Provides methods to convert and manage legacy configurations.
 * 
 * @example
 * ```typescript
 * const adapter = new LegacyConfigAdapter()
 * 
 * // Convert a single agent
 * const automation = adapter.adapt(legacyAgent)
 * 
 * // Convert multiple agents
 * const automations = adapter.adaptMany(legacyAgents)
 * ```
 */
export class LegacyConfigAdapter {
  /**
   * Adapt a single legacy agent config
   * 
   * @param agent - Legacy agent configuration
   * @returns New automation configuration
   */
  adapt(agent: LegacyAgentConfig): AutomationConfig {
    return adaptLegacyConfig(agent)
  }
  
  /**
   * Adapt multiple legacy agent configs
   * 
   * @param agents - Array of legacy agent configurations
   * @returns Array of new automation configurations
   */
  adaptMany(agents: LegacyAgentConfig[]): AutomationConfig[] {
    return agents.map(agent => this.adapt(agent))
  }
  
  /**
   * Check if an object looks like a legacy agent config
   * 
   * @param obj - Object to check
   * @returns Whether it appears to be a legacy config
   */
  isLegacyConfig(obj: any): obj is LegacyAgentConfig {
    if (!obj || typeof obj !== 'object') return false
    
    // Legacy configs have these characteristics:
    // - Have listening.passiveEnabled or listening.activeEnabled
    // - Have listening.passive.triggers or listening.active.triggers
    // - Don't have trigger.source (new format)
    
    if (obj.trigger?.source) return false // New format
    if (obj.listening?.passiveEnabled !== undefined) return true
    if (obj.listening?.activeEnabled !== undefined) return true
    if (obj.listening?.passive?.triggers) return true
    if (obj.listening?.active?.triggers) return true
    
    // Check for reasoning.applyFor which is legacy format
    if (obj.reasoning?.applyFor !== undefined) return true
    
    return false
  }
  
  /**
   * Check if an object is a new automation config
   * 
   * @param obj - Object to check
   * @returns Whether it appears to be a new config
   */
  isNewConfig(obj: any): obj is AutomationConfig {
    if (!obj || typeof obj !== 'object') return false
    
    // New configs have these characteristics:
    // - Have trigger.source
    // - Have mode
    // - Have sensorWorkflows array
    
    if (obj.trigger?.source && obj.mode && Array.isArray(obj.sensorWorkflows)) {
      return true
    }
    
    return false
  }
  
  /**
   * Convert any config to new format
   * 
   * If already new format, returns as-is.
   * If legacy format, converts it.
   * 
   * @param obj - Config object (legacy or new)
   * @returns New automation config
   */
  ensureNewFormat(obj: any): AutomationConfig {
    if (this.isNewConfig(obj)) {
      return obj
    }
    
    if (this.isLegacyConfig(obj)) {
      return this.adapt(obj)
    }
    
    // Unknown format - try to construct a minimal config
    console.warn('[LegacyConfigAdapter] Unknown config format, creating minimal config')
    return {
      id: obj.id || `auto_${Date.now()}`,
      name: obj.name || 'Unknown Automation',
      enabled: obj.enabled !== false,
      mode: 'active',
      trigger: {
        source: 'chat',
        scope: 'global',
        modalities: ['text']
      },
      sensorWorkflows: [],
      conditions: null,
      reasoningProfile: obj.id || '',
      allowedActions: []
    }
  }
  
  /**
   * Migrate legacy source field to new source
   * 
   * @param legacySource - Legacy source string
   * @returns New TriggerSource
   */
  migrateSource(legacySource: string | undefined): TriggerSource {
    return adaptLegacySource(legacySource)
  }
}

/**
 * Default singleton instance
 */
export const legacyAdapter = new LegacyConfigAdapter()



