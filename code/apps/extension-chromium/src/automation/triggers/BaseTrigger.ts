/**
 * Base Trigger
 * 
 * Abstract base class for all trigger implementations.
 * Provides common functionality for trigger lifecycle management.
 */

import type { TriggerSource, NormalizedEvent, Modality, TriggerScope } from '../types'

/**
 * Trigger event callback
 */
export type TriggerCallback = (event: NormalizedEvent) => void

/**
 * Abstract base class for triggers
 * 
 * Extend this class to implement custom trigger sources.
 */
export abstract class BaseTrigger {
  /** Unique identifier for this trigger instance */
  protected readonly id: string
  
  /** The source type of this trigger */
  protected abstract readonly source: TriggerSource
  
  /** Whether the trigger is currently active */
  protected isActive: boolean = false
  
  /** Registered callbacks */
  protected callbacks: Set<TriggerCallback> = new Set()
  
  constructor(id?: string) {
    this.id = id || `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
  
  /**
   * Get the trigger's unique ID
   */
  getId(): string {
    return this.id
  }
  
  /**
   * Get the trigger source type
   */
  getSource(): TriggerSource {
    return this.source
  }
  
  /**
   * Check if trigger is active
   */
  getIsActive(): boolean {
    return this.isActive
  }
  
  /**
   * Start the trigger
   * 
   * Override this in subclasses to set up event listeners,
   * start timers, etc.
   */
  abstract start(): void
  
  /**
   * Stop the trigger
   * 
   * Override this in subclasses to clean up resources.
   */
  abstract stop(): void
  
  /**
   * Subscribe to trigger events
   * 
   * @param callback - Function to call when trigger fires
   * @returns Unsubscribe function
   */
  subscribe(callback: TriggerCallback): () => void {
    this.callbacks.add(callback)
    return () => {
      this.callbacks.delete(callback)
    }
  }
  
  /**
   * Emit an event to all subscribers
   * 
   * @param event - The normalized event to emit
   */
  protected emit(event: NormalizedEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event)
      } catch (error) {
        console.error(`[${this.source}Trigger] Error in callback:`, error)
      }
    }
  }
  
  /**
   * Create a normalized event with defaults
   */
  protected createEvent(params: {
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
    return {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      source: this.source,
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
  }
}


