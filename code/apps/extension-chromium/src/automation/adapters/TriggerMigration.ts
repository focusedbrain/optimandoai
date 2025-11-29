/**
 * Trigger Migration Helper
 * 
 * Handles backward compatibility and migration of legacy trigger configurations
 * to the new structured Event Tag format.
 * 
 * Migration Rules:
 * - Legacy `tagName` → `tag` (with # prefix)
 * - Legacy `expectedContext` → `eventTagConditions` with `body_keywords`
 * - Legacy `websiteFilter` → `eventTagConditions` with `website_filter`
 * - Legacy passive/active triggers → unified triggers
 * 
 * @example
 * ```typescript
 * const migrator = new TriggerMigration()
 * const modernTrigger = migrator.migrateTrigger(legacyTrigger)
 * ```
 */

import type {
  UnifiedTriggerConfig,
  EventTagCondition,
  EventChannel,
  LegacyTrigger,
  LegacyListeningConfig
} from '../types'

/**
 * Migration result for a single trigger
 */
export interface MigrationResult {
  /** The migrated trigger configuration */
  trigger: UnifiedTriggerConfig
  
  /** Whether migration was needed */
  migrated: boolean
  
  /** Description of changes made */
  changes: string[]
  
  /** Any warnings during migration */
  warnings: string[]
}

/**
 * Migration result for a complete listening config
 */
export interface ListeningMigrationResult {
  /** Migrated unified triggers */
  triggers: UnifiedTriggerConfig[]
  
  /** Whether any migration was performed */
  migrated: boolean
  
  /** Summary of all changes */
  changes: string[]
  
  /** Any warnings */
  warnings: string[]
}

/**
 * Trigger Migration Helper
 * 
 * Converts legacy trigger formats to the new structured format.
 */
export class TriggerMigration {
  /**
   * Migrate a single trigger configuration
   * 
   * @param trigger - Legacy or mixed-format trigger
   * @returns Migration result with modernized trigger
   */
  migrateTrigger(trigger: Partial<UnifiedTriggerConfig>): MigrationResult {
    const changes: string[] = []
    const warnings: string[] = []
    
    // Start with a copy
    const result: UnifiedTriggerConfig = {
      id: trigger.id || this.generateId(),
      type: trigger.type || 'direct_tag',
      enabled: trigger.enabled ?? true,
      ...trigger
    }
    
    // Only migrate direct_tag triggers
    if (result.type !== 'direct_tag') {
      return { trigger: result, migrated: false, changes: [], warnings: [] }
    }
    
    let needsMigration = false
    
    // Migrate tagName to tag
    if (trigger.tagName && !trigger.tag) {
      const tagValue = trigger.tagName.trim()
      result.tag = tagValue.startsWith('#') ? tagValue : `#${tagValue}`
      changes.push(`Migrated tagName "${trigger.tagName}" to tag "${result.tag}"`)
      needsMigration = true
    }
    
    // Ensure tag has # prefix
    if (result.tag && !result.tag.startsWith('#')) {
      result.tag = `#${result.tag}`
      changes.push(`Added # prefix to tag`)
      needsMigration = true
    }
    
    // Default channel if not set
    if (!result.channel) {
      result.channel = 'chat'
    }
    
    // Migrate legacy fields to eventTagConditions
    const existingConditions = result.eventTagConditions || []
    const newConditions: EventTagCondition[] = [...existingConditions]
    
    // Migrate expectedContext to body_keywords
    if (trigger.expectedContext && !existingConditions.some(c => c.type === 'body_keywords')) {
      const keywords = trigger.expectedContext
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
      
      if (keywords.length > 0) {
        newConditions.push({
          type: 'body_keywords',
          keywords,
          caseInsensitive: true
        })
        changes.push(`Migrated expectedContext to body_keywords: ${keywords.join(', ')}`)
        needsMigration = true
      }
    }
    
    // Migrate websiteFilter to website_filter condition
    if (trigger.websiteFilter && !existingConditions.some(c => c.type === 'website_filter')) {
      const patterns = trigger.websiteFilter
        .split(',')
        .map(p => p.trim())
        .filter(Boolean)
      
      if (patterns.length > 0) {
        newConditions.push({
          type: 'website_filter',
          patterns
        })
        changes.push(`Migrated websiteFilter to website_filter condition: ${patterns.join(', ')}`)
        needsMigration = true
      }
    }
    
    if (newConditions.length > 0) {
      result.eventTagConditions = newConditions
    }
    
    // Add deprecation warnings
    if (trigger.tagName) {
      warnings.push('tagName is deprecated, use tag instead')
    }
    if (trigger.expectedContext) {
      warnings.push('expectedContext is deprecated, use eventTagConditions with body_keywords')
    }
    if (trigger.websiteFilter) {
      warnings.push('websiteFilter is deprecated, use eventTagConditions with website_filter')
    }
    
    return {
      trigger: result,
      migrated: needsMigration,
      changes,
      warnings
    }
  }
  
  /**
   * Migrate a complete listening configuration
   * 
   * Handles both old passive/active format and new unified format.
   * 
   * @param config - Legacy listening configuration
   * @returns Migration result with all unified triggers
   */
  migrateListeningConfig(config: LegacyListeningConfig & { unifiedTriggers?: UnifiedTriggerConfig[] }): ListeningMigrationResult {
    const allTriggers: UnifiedTriggerConfig[] = []
    const allChanges: string[] = []
    const allWarnings: string[] = []
    let anyMigrated = false
    
    // First, handle existing unified triggers
    if (config.unifiedTriggers && config.unifiedTriggers.length > 0) {
      for (const trigger of config.unifiedTriggers) {
        const result = this.migrateTrigger(trigger)
        allTriggers.push(result.trigger)
        allChanges.push(...result.changes)
        allWarnings.push(...result.warnings)
        if (result.migrated) anyMigrated = true
      }
    }
    
    // Then, migrate legacy passive triggers if no unified triggers exist
    if (allTriggers.length === 0 && config.passive?.triggers) {
      for (const legacyTrigger of config.passive.triggers) {
        const migrated = this.migrateLegacyTrigger(legacyTrigger, 'passive', config)
        allTriggers.push(migrated.trigger)
        allChanges.push(...migrated.changes)
        allWarnings.push(...migrated.warnings)
        anyMigrated = true
      }
    }
    
    // Migrate legacy active triggers if no unified triggers exist
    if (allTriggers.length === 0 && config.active?.triggers) {
      for (const legacyTrigger of config.active.triggers) {
        const migrated = this.migrateLegacyTrigger(legacyTrigger, 'active', config)
        allTriggers.push(migrated.trigger)
        allChanges.push(...migrated.changes)
        allWarnings.push(...migrated.warnings)
        anyMigrated = true
      }
    }
    
    return {
      triggers: allTriggers,
      migrated: anyMigrated,
      changes: allChanges,
      warnings: allWarnings
    }
  }
  
  /**
   * Migrate a single legacy trigger
   */
  private migrateLegacyTrigger(
    legacyTrigger: LegacyTrigger,
    mode: 'passive' | 'active',
    parentConfig: LegacyListeningConfig
  ): MigrationResult {
    const changes: string[] = []
    const warnings: string[] = []
    
    const tagName = legacyTrigger.tag?.name || ''
    const tag = tagName.startsWith('#') ? tagName : `#${tagName}`
    
    const trigger: UnifiedTriggerConfig = {
      id: this.generateId(),
      type: 'direct_tag',
      name: tagName,
      enabled: true,
      tag,
      channel: this.inferChannel(parentConfig.source),
      tagName // Keep for backward compatibility
    }
    
    changes.push(`Migrated ${mode} trigger "${tagName}" to unified format`)
    
    // Inherit expectedContext from parent
    if (parentConfig.expectedContext) {
      const keywords = parentConfig.expectedContext
        .split(',')
        .map(k => k.trim())
        .filter(Boolean)
      
      if (keywords.length > 0) {
        trigger.eventTagConditions = [{
          type: 'body_keywords',
          keywords,
          caseInsensitive: true
        }]
        changes.push(`Inherited expectedContext as keywords: ${keywords.join(', ')}`)
      }
    }
    
    // Inherit website filter from parent
    if (parentConfig.website) {
      const existingConditions = trigger.eventTagConditions || []
      trigger.eventTagConditions = [
        ...existingConditions,
        {
          type: 'website_filter',
          patterns: [parentConfig.website]
        }
      ]
      changes.push(`Inherited website filter: ${parentConfig.website}`)
    }
    
    warnings.push(`Migrated from deprecated ${mode} trigger format`)
    
    return {
      trigger,
      migrated: true,
      changes,
      warnings
    }
  }
  
  /**
   * Infer event channel from legacy source field
   */
  private inferChannel(source?: string): EventChannel {
    if (!source) return 'chat'
    
    switch (source.toLowerCase()) {
      case 'email':
        return 'email'
      case 'web':
      case 'dom':
      case 'overlay':
        return 'web'
      case 'api':
      case 'webhook':
        return 'api'
      case 'workflow':
        return 'workflow'
      default:
        return 'chat'
    }
  }
  
  /**
   * Generate a unique trigger ID
   */
  private generateId(): string {
    return `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
  
  /**
   * Check if a trigger needs migration
   * 
   * @param trigger - Trigger to check
   * @returns True if migration is needed
   */
  needsMigration(trigger: Partial<UnifiedTriggerConfig>): boolean {
    if (trigger.type !== 'direct_tag') return false
    
    // Check for legacy fields
    if (trigger.tagName && !trigger.tag) return true
    if (trigger.tag && !trigger.tag.startsWith('#')) return true
    if (trigger.expectedContext && !trigger.eventTagConditions?.some(c => c.type === 'body_keywords')) return true
    if (trigger.websiteFilter && !trigger.eventTagConditions?.some(c => c.type === 'website_filter')) return true
    
    return false
  }
}

/**
 * Singleton instance for convenience
 */
export const triggerMigration = new TriggerMigration()

