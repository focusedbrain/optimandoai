/**
 * Trigger Registry
 * 
 * Central registry for all trigger sources.
 * Normalizes events from different sources into a common format.
 */

import type { 
  TriggerSource, 
  NormalizedEvent, 
  EventSubscriber,
  Modality,
  TriggerScope
} from '../types'
import { BaseTrigger } from './BaseTrigger'

/**
 * Trigger Registry
 * 
 * Manages trigger sources and provides a unified event stream.
 * 
 * @example
 * ```typescript
 * const registry = new TriggerRegistry()
 * 
 * // Register a trigger
 * registry.registerTrigger(new ChatTrigger())
 * 
 * // Subscribe to all events
 * const unsubscribe = registry.subscribe((event) => {
 *   console.log('Event received:', event)
 * })
 * 
 * // Start all triggers
 * registry.startAll()
 * ```
 */
export class TriggerRegistry {
  /** Registered triggers by source type */
  private triggers: Map<TriggerSource, BaseTrigger[]> = new Map()
  
  /** Event subscribers */
  private subscribers: Set<EventSubscriber> = new Set()
  
  /** Unsubscribe functions for trigger callbacks */
  private triggerUnsubscribers: Map<string, () => void> = new Map()
  
  /**
   * Register a trigger
   * 
   * @param trigger - The trigger to register
   */
  registerTrigger(trigger: BaseTrigger): void {
    const source = trigger.getSource()
    const triggers = this.triggers.get(source) || []
    triggers.push(trigger)
    this.triggers.set(source, triggers)
    
    // Subscribe to trigger events
    const unsubscribe = trigger.subscribe((event) => {
      this.emitEvent(event)
    })
    this.triggerUnsubscribers.set(trigger.getId(), unsubscribe)
    
    console.log(`[TriggerRegistry] Registered ${source} trigger: ${trigger.getId()}`)
  }
  
  /**
   * Unregister a trigger
   * 
   * @param triggerId - The trigger ID to unregister
   */
  unregisterTrigger(triggerId: string): void {
    // Find and remove the trigger
    for (const [source, triggers] of this.triggers.entries()) {
      const index = triggers.findIndex(t => t.getId() === triggerId)
      if (index !== -1) {
        const trigger = triggers[index]
        trigger.stop()
        triggers.splice(index, 1)
        this.triggers.set(source, triggers)
        
        // Unsubscribe from trigger events
        const unsubscribe = this.triggerUnsubscribers.get(triggerId)
        if (unsubscribe) {
          unsubscribe()
          this.triggerUnsubscribers.delete(triggerId)
        }
        
        console.log(`[TriggerRegistry] Unregistered ${source} trigger: ${triggerId}`)
        return
      }
    }
  }
  
  /**
   * Get all triggers for a source type
   * 
   * @param source - The source type
   * @returns Array of triggers
   */
  getTriggers(source: TriggerSource): BaseTrigger[] {
    return this.triggers.get(source) || []
  }
  
  /**
   * Get all registered triggers
   * 
   * @returns Map of all triggers by source
   */
  getAllTriggers(): Map<TriggerSource, BaseTrigger[]> {
    return new Map(this.triggers)
  }
  
  /**
   * Subscribe to events from all triggers
   * 
   * @param callback - Function to call when any trigger fires
   * @returns Unsubscribe function
   */
  subscribe(callback: EventSubscriber): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }
  
  /**
   * Emit an event to all subscribers
   * 
   * @param event - The normalized event
   */
  private emitEvent(event: NormalizedEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        const result = subscriber(event)
        // Handle async subscribers
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('[TriggerRegistry] Error in async subscriber:', error)
          })
        }
      } catch (error) {
        console.error('[TriggerRegistry] Error in subscriber:', error)
      }
    }
  }
  
  /**
   * Manually emit an event
   * 
   * Useful for testing or programmatic event injection.
   * 
   * @param event - The event to emit
   */
  emit(event: NormalizedEvent): void {
    this.emitEvent(event)
  }
  
  /**
   * Create and emit an event
   * 
   * @param params - Event parameters
   */
  createAndEmit(params: {
    source: TriggerSource
    input: string
    modalities?: Modality[]
    scope?: TriggerScope
    imageUrl?: string
    videoUrl?: string
    metadata?: Record<string, any>
    url?: string
    tabId?: number
    sessionKey?: string
    agentId?: string
  }): NormalizedEvent {
    const event: NormalizedEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      source: params.source,
      scope: params.scope || 'global',
      modalities: params.modalities || ['text'],
      input: params.input,
      imageUrl: params.imageUrl,
      videoUrl: params.videoUrl,
      metadata: params.metadata || {},
      url: params.url,
      tabId: params.tabId,
      sessionKey: params.sessionKey,
      agentId: params.agentId
    }
    
    this.emitEvent(event)
    return event
  }
  
  /**
   * Start all registered triggers
   */
  startAll(): void {
    for (const triggers of this.triggers.values()) {
      for (const trigger of triggers) {
        if (!trigger.getIsActive()) {
          trigger.start()
        }
      }
    }
    console.log('[TriggerRegistry] Started all triggers')
  }
  
  /**
   * Stop all registered triggers
   */
  stopAll(): void {
    for (const triggers of this.triggers.values()) {
      for (const trigger of triggers) {
        if (trigger.getIsActive()) {
          trigger.stop()
        }
      }
    }
    console.log('[TriggerRegistry] Stopped all triggers')
  }
  
  /**
   * Start triggers for a specific source
   * 
   * @param source - The source type to start
   */
  startSource(source: TriggerSource): void {
    const triggers = this.triggers.get(source) || []
    for (const trigger of triggers) {
      if (!trigger.getIsActive()) {
        trigger.start()
      }
    }
  }
  
  /**
   * Stop triggers for a specific source
   * 
   * @param source - The source type to stop
   */
  stopSource(source: TriggerSource): void {
    const triggers = this.triggers.get(source) || []
    for (const trigger of triggers) {
      if (trigger.getIsActive()) {
        trigger.stop()
      }
    }
  }
  
  /**
   * Clear all triggers and subscribers
   */
  clear(): void {
    this.stopAll()
    this.triggers.clear()
    this.subscribers.clear()
    this.triggerUnsubscribers.clear()
    console.log('[TriggerRegistry] Cleared all triggers and subscribers')
  }
}

/**
 * Default singleton instance
 */
export const triggerRegistry = new TriggerRegistry()



