/**
 * Automation System Public API
 * 
 * This module exports the public interface for the automation system.
 * Import from here rather than individual files.
 */

// Core types
export * from './types'

// Condition engine
export { ConditionEngine } from './conditions/ConditionEngine'
export { EventTagMatcher, eventTagMatcher } from './conditions/EventTagMatcher'

// Trigger system
export { TriggerRegistry } from './triggers/TriggerRegistry'
export { BaseTrigger } from './triggers/BaseTrigger'
export { ChatTrigger } from './triggers/ChatTrigger'
export { CronTrigger } from './triggers/CronTrigger'

// Workflow system
export { WorkflowRunner } from './workflows/WorkflowRunner'
export { WorkflowRegistry } from './workflows/WorkflowRegistry'

// Main manager
export { ListenerManager } from './ListenerManager'

// Adapters
export { LegacyConfigAdapter } from './adapters/LegacyConfigAdapter'
export { TriggerMigration, triggerMigration } from './adapters/TriggerMigration'




