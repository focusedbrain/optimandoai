/**
 * Event Bus System
 * 
 * Simple event system for orchestrator components.
 * Uses a basic EventEmitter with string events and any[] args for simplicity.
 */

import { EventEmitter } from 'eventemitter3';

export type EventCallback = (...args: any[]) => void;

export interface EventListenerInfo {
  [eventName: string]: number;
}

export type EventMap = {
  // Template events
  'template:loaded': [template: string, source: string];
  'template:parsed': [ast: any, templateSource: string];
  'template:built': [component: any, metadata: any];
  'template:error': [error: string, source: string];
  
  // File watching events
  'file:changed': [filePath: string, content?: string];
  'file:added': [filePath: string, content?: string];
  'file:removed': [filePath: string];
  
  // IPC events
  'ipc:message': [channel: string, data: any];
  'ipc:request': [id: string, method: string, params: any];
  'ipc:response': [id: string, result: any, error?: any];
  
  // App lifecycle events
  'app:ready': [];
  'app:shutdown': [];
  'component:mounted': [componentId: string];
  'component:unmounted': [componentId: string];
  
  // Error events
  'error': [error: Error, context?: any];
  'warning': [message: string, context?: any];
};

export class EventBus {
  private emitter: EventEmitter;
  private debugMode: boolean = false;
  
  constructor(debugMode: boolean = false) {
    this.emitter = new EventEmitter();
    this.debugMode = debugMode;
  }
  
  /**
   * Enable or disable debug logging
   */
  setDebugMode(enabled: boolean) {
    this.debugMode = enabled;
  }
  
  /**
   * Emit an event
   */
  emit(event: string, ...args: any[]): boolean {
    if (this.debugMode) {
      console.log(`[EventBus] ${event}:`, ...args);
    }
    return this.emitter.emit(event, ...args);
  }
  
  /**
   * Listen to an event
   */
  on(event: string, listener: (...args: any[]) => void): this {
    this.emitter.on(event, listener);
    return this;
  }
  
  /**
   * Listen to an event once
   */
  once(event: string, listener: (...args: any[]) => void): this {
    this.emitter.once(event, listener);
    return this;
  }
  
  /**
   * Remove listener
   */
  off(event: string, listener: (...args: any[]) => void): this {
    this.emitter.off(event, listener);
    return this;
  }
  
  /**
   * Emit an event with optional error handling
   */
  safeEmit(event: string, ...args: any[]): boolean {
    try {
      return this.emit(event, ...args);
    } catch (error) {
      console.error(`[EventBus] Error emitting ${event}:`, error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)), { event, args });
      return false;
    }
  }
  
  /**
   * Add a one-time listener with automatic cleanup
   */
  onceWithTimeout(
    event: string,
    timeoutMs: number = 5000
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeoutMs);
      
      this.once(event, (...args: any[]) => {
        clearTimeout(timeout);
        resolve(args);
      });
    });
  }
  
  /**
   * Create a promise that resolves when event is emitted
   */
  waitFor(event: string, timeoutMs: number = 5000): Promise<any[]> {
    return this.onceWithTimeout(event, timeoutMs);
  }
  
  /**
   * Get current listener count for debugging
   */
  getListenerInfo(): Record<string, number> {
    const info: Record<string, number> = {};
    for (const event of this.emitter.eventNames()) {
      info[String(event)] = this.emitter.listenerCount(event);
    }
    return info;
  }
  
  /**
   * Clear all listeners (cleanup)
   */
  destroy(): void {
    this.emitter.removeAllListeners();
    if (this.debugMode) {
      console.log('[EventBus] Destroyed - all listeners removed');
    }
  }
}

// Export singleton instance for global use
export const eventBus = new EventBus();