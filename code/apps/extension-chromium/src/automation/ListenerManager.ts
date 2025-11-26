/**
 * Listener Manager
 * 
 * Central router for the automation system.
 * Orchestrates the pipeline: triggers → sensors → conditions → reasoning → actions
 */

import type {
  AutomationConfig,
  NormalizedEvent,
  ProcessingResult,
  ActionResult,
  WorkflowContext,
  Condition,
  TriggerSource,
  TriggerScope,
  Modality
} from './types'
import { ConditionEngine } from './conditions/ConditionEngine'
import { TriggerRegistry } from './triggers/TriggerRegistry'
import { WorkflowRunner } from './workflows/WorkflowRunner'
import { WorkflowRegistry } from './workflows/WorkflowRegistry'

/**
 * Reasoning callback type
 * 
 * Called when an automation passes conditions and needs reasoning.
 */
export type ReasoningCallback = (
  event: NormalizedEvent,
  config: AutomationConfig,
  context: WorkflowContext
) => Promise<any>

/**
 * Listener Manager
 * 
 * Manages the complete automation pipeline from event to action.
 * 
 * @example
 * ```typescript
 * const manager = new ListenerManager()
 * 
 * // Register an automation
 * manager.register({
 *   id: 'invoice-handler',
 *   name: 'Invoice Handler',
 *   enabled: true,
 *   mode: 'active',
 *   trigger: { source: 'chat', scope: 'global', modalities: ['text', 'image'] },
 *   patterns: ['Invoice'],
 *   sensorWorkflows: ['extract-text'],
 *   conditions: { field: 'input.length', op: 'gt', value: 10 },
 *   reasoningProfile: 'agent1',
 *   allowedActions: ['send-email', 'save-document']
 * })
 * 
 * // Set up reasoning callback
 * manager.setReasoningCallback(async (event, config, context) => {
 *   // Call LLM or agent
 *   return { response: 'Processed invoice' }
 * })
 * 
 * // Start processing
 * manager.start()
 * ```
 */
export class ListenerManager {
  /** Registered automations */
  private automations: Map<string, AutomationConfig> = new Map()
  
  /** Condition engine instance */
  private conditionEngine: ConditionEngine = new ConditionEngine()
  
  /** Trigger registry */
  private triggerRegistry: TriggerRegistry
  
  /** Workflow runner */
  private workflowRunner: WorkflowRunner
  
  /** Workflow registry */
  private workflowRegistry: WorkflowRegistry
  
  /** Reasoning callback */
  private reasoningCallback: ReasoningCallback | null = null
  
  /** Whether the manager is running */
  private isRunning: boolean = false
  
  /** Event subscription cleanup */
  private eventUnsubscribe: (() => void) | null = null
  
  constructor(
    triggerRegistry?: TriggerRegistry,
    workflowRegistry?: WorkflowRegistry
  ) {
    this.triggerRegistry = triggerRegistry || new TriggerRegistry()
    this.workflowRegistry = workflowRegistry || new WorkflowRegistry()
    this.workflowRunner = new WorkflowRunner(this.workflowRegistry)
  }
  
  /**
   * Register an automation configuration
   * 
   * @param config - The automation config to register
   */
  register(config: AutomationConfig): void {
    if (!config.id) {
      throw new Error('Automation config must have an id')
    }
    
    this.automations.set(config.id, config)
    console.log(`[ListenerManager] Registered automation: ${config.id} (${config.name})`)
  }
  
  /**
   * Unregister an automation
   * 
   * @param id - The automation ID to remove
   */
  unregister(id: string): void {
    if (this.automations.delete(id)) {
      console.log(`[ListenerManager] Unregistered automation: ${id}`)
    }
  }
  
  /**
   * Get an automation by ID
   * 
   * @param id - The automation ID
   * @returns The automation config or undefined
   */
  get(id: string): AutomationConfig | undefined {
    return this.automations.get(id)
  }
  
  /**
   * Get all registered automations
   * 
   * @returns Array of all automations
   */
  getAll(): AutomationConfig[] {
    return Array.from(this.automations.values())
  }
  
  /**
   * Set the reasoning callback
   * 
   * @param callback - Function to call for LLM/agent reasoning
   */
  setReasoningCallback(callback: ReasoningCallback): void {
    this.reasoningCallback = callback
  }
  
  /**
   * Get the trigger registry
   */
  getTriggerRegistry(): TriggerRegistry {
    return this.triggerRegistry
  }
  
  /**
   * Get the workflow registry
   */
  getWorkflowRegistry(): WorkflowRegistry {
    return this.workflowRegistry
  }
  
  /**
   * Start the listener manager
   * 
   * Subscribes to trigger events and begins processing.
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[ListenerManager] Already running')
      return
    }
    
    this.eventUnsubscribe = this.triggerRegistry.subscribe(async (event) => {
      await this.processEvent(event)
    })
    
    this.triggerRegistry.startAll()
    this.isRunning = true
    
    console.log(`[ListenerManager] Started with ${this.automations.size} automations`)
  }
  
  /**
   * Stop the listener manager
   */
  stop(): void {
    if (!this.isRunning) {
      console.warn('[ListenerManager] Not running')
      return
    }
    
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe()
      this.eventUnsubscribe = null
    }
    
    this.triggerRegistry.stopAll()
    this.isRunning = false
    
    console.log('[ListenerManager] Stopped')
  }
  
  /**
   * Check if the manager is running
   */
  getIsRunning(): boolean {
    return this.isRunning
  }
  
  /**
   * Process an event through the automation pipeline
   * 
   * @param event - The normalized event to process
   * @returns Array of processing results
   */
  async processEvent(event: NormalizedEvent): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = []
    
    // Find matching automations
    const matchingAutomations = this.getMatchingAutomations(event)
    
    if (matchingAutomations.length === 0) {
      console.log('[ListenerManager] No matching automations for event')
      return results
    }
    
    console.log(`[ListenerManager] Processing event with ${matchingAutomations.length} matching automation(s)`)
    
    // Process each matching automation
    for (const { config, matchReason } of matchingAutomations) {
      const result = await this.processAutomation(event, config, matchReason)
      results.push(result)
    }
    
    return results
  }
  
  /**
   * Find automations that match an event
   * 
   * @param event - The event to match
   * @returns Array of matching automations with match reasons
   */
  getMatchingAutomations(event: NormalizedEvent): Array<{
    config: AutomationConfig
    matchReason: string
  }> {
    const matches: Array<{ config: AutomationConfig; matchReason: string }> = []
    
    for (const config of this.automations.values()) {
      // Skip disabled automations
      if (!config.enabled) continue
      
      const matchResult = this.matchAutomation(event, config)
      if (matchResult.matched) {
        matches.push({
          config,
          matchReason: matchResult.reason
        })
      }
    }
    
    return matches
  }
  
  /**
   * Check if an automation matches an event
   */
  private matchAutomation(
    event: NormalizedEvent,
    config: AutomationConfig
  ): { matched: boolean; reason: string } {
    // 1. Check source match
    if (!this.matchSource(event.source, config.trigger.source)) {
      return { matched: false, reason: 'source mismatch' }
    }
    
    // 2. Check scope match
    if (!this.matchScope(event, config)) {
      return { matched: false, reason: 'scope mismatch' }
    }
    
    // 3. Check modality match
    if (!this.matchModalities(event.modalities, config.trigger.modalities)) {
      return { matched: false, reason: 'modality mismatch' }
    }
    
    // 4. Check website filter
    if (config.website && event.url) {
      if (!event.url.toLowerCase().includes(config.website.toLowerCase())) {
        return { matched: false, reason: 'website filter' }
      }
    }
    
    // 5. Check @mention patterns
    if (config.patterns && config.patterns.length > 0) {
      const mentions = this.extractMentions(event.input)
      const hasMatch = config.patterns.some(p => 
        mentions.some(m => m.toLowerCase() === p.toLowerCase())
      )
      if (hasMatch) {
        return { matched: true, reason: `@${config.patterns.find(p => mentions.some(m => m.toLowerCase() === p.toLowerCase()))} pattern` }
      }
    }
    
    // 6. Check tags
    if (config.tags && config.tags.length > 0) {
      const eventTags = (event.metadata.tags as string[]) || []
      const hasTagMatch = config.tags.some(t => eventTags.includes(t))
      if (hasTagMatch) {
        return { matched: true, reason: `tag match` }
      }
    }
    
    // 7. Check expected context (keyword matching)
    if (config.expectedContext) {
      if (this.matchExpectedContext(event.input, config.expectedContext)) {
        return { matched: true, reason: `context: ${config.expectedContext}` }
      }
    }
    
    // If no specific matching criteria, match based on source/scope/modality only
    if (!config.patterns?.length && !config.tags?.length && !config.expectedContext) {
      return { matched: true, reason: 'source/scope/modality match' }
    }
    
    return { matched: false, reason: 'no pattern/tag/context match' }
  }
  
  /**
   * Match event source to config source
   */
  private matchSource(eventSource: TriggerSource, configSource: TriggerSource): boolean {
    return eventSource === configSource
  }
  
  /**
   * Match event scope to config scope
   */
  private matchScope(event: NormalizedEvent, config: AutomationConfig): boolean {
    const configScope = config.trigger.scope
    
    // Global scope matches everything
    if (configScope === 'global') return true
    
    // Agent scope must match agent ID
    if (configScope === 'agent') {
      return event.agentId === config.reasoningProfile
    }
    
    // Workflow scope would match workflow ID (not implemented yet)
    return true
  }
  
  /**
   * Match event modalities to config modalities
   */
  private matchModalities(eventMods: Modality[], configMods: Modality[]): boolean {
    // Empty config modalities matches any
    if (configMods.length === 0) return true
    
    // Check if any event modality is in config modalities
    return eventMods.some(m => configMods.includes(m))
  }
  
  /**
   * Extract @mentions from text
   */
  private extractMentions(text: string): string[] {
    const matches = text.match(/@[\w-]+/g)
    if (!matches) return []
    return matches.map(m => m.substring(1))
  }
  
  /**
   * Match expected context (keyword matching)
   */
  private matchExpectedContext(input: string, expectedContext: string): boolean {
    const inputLower = input.toLowerCase()
    const contextLower = expectedContext.toLowerCase()
    
    // Split context into keywords and check if any are present
    const keywords = contextLower.split(/[\s,;]+/).filter(w => w.length > 3)
    return keywords.some(keyword => inputLower.includes(keyword))
  }
  
  /**
   * Process a single automation for an event
   */
  private async processAutomation(
    event: NormalizedEvent,
    config: AutomationConfig,
    matchReason: string
  ): Promise<ProcessingResult> {
    const startTime = Date.now()
    const errors: Error[] = []
    let sensorData: Record<string, any> = {}
    let conditionsPassed = false
    let reasoningResult: any = undefined
    const actionResults: ActionResult[] = []
    
    try {
      // Create workflow context
      const context: WorkflowContext = {
        event,
        collectedData: {},
        errors: [],
        startTime
      }
      
      // 1. Run sensor workflows
      for (const sensorId of config.sensorWorkflows) {
        try {
          const result = await this.workflowRunner.runSensor(sensorId, context)
          Object.assign(context.collectedData, result)
        } catch (error) {
          console.error(`[ListenerManager] Sensor workflow '${sensorId}' failed:`, error)
          errors.push(error as Error)
        }
      }
      sensorData = { ...context.collectedData }
      
      // 2. Evaluate conditions
      const conditionContext = {
        ...event,
        ...event.metadata,
        ...context.collectedData
      }
      
      conditionsPassed = this.conditionEngine.evaluate(config.conditions, conditionContext)
      
      if (!conditionsPassed) {
        console.log(`[ListenerManager] Conditions not met for ${config.id}`)
        return {
          success: false,
          automationId: config.id,
          matchReason,
          sensorData,
          conditionsPassed: false,
          actionResults: [],
          errors,
          duration: Date.now() - startTime
        }
      }
      
      // 3. Invoke reasoning
      if (this.reasoningCallback) {
        try {
          reasoningResult = await this.reasoningCallback(event, config, context)
          context.reasoningResult = reasoningResult
        } catch (error) {
          console.error(`[ListenerManager] Reasoning failed for ${config.id}:`, error)
          errors.push(error as Error)
        }
      }
      
      // 4. Run action workflows
      for (const actionId of config.allowedActions) {
        try {
          const result = await this.workflowRunner.runAction(actionId, context)
          actionResults.push({
            workflowId: actionId,
            success: true,
            output: result
          })
        } catch (error) {
          console.error(`[ListenerManager] Action workflow '${actionId}' failed:`, error)
          actionResults.push({
            workflowId: actionId,
            success: false,
            error: error as Error
          })
          errors.push(error as Error)
        }
      }
      
      return {
        success: errors.length === 0,
        automationId: config.id,
        matchReason,
        sensorData,
        conditionsPassed: true,
        reasoningResult,
        actionResults,
        errors,
        duration: Date.now() - startTime
      }
      
    } catch (error) {
      console.error(`[ListenerManager] Processing failed for ${config.id}:`, error)
      errors.push(error as Error)
      
      return {
        success: false,
        automationId: config.id,
        matchReason,
        sensorData,
        conditionsPassed,
        reasoningResult,
        actionResults,
        errors,
        duration: Date.now() - startTime
      }
    }
  }
  
  /**
   * Clear all registered automations
   */
  clear(): void {
    this.automations.clear()
    console.log('[ListenerManager] Cleared all automations')
  }
}

/**
 * Default singleton instance
 */
export const listenerManager = new ListenerManager()



