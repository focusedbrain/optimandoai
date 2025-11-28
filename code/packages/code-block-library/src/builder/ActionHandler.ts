/**
 * Action Handler System
 * 
 * Manages action dispatch and execution for GlassView applications.
 * Handles communication between UI components, orchestrator, and AI.
 */

import { ActionNode } from '../types';

export interface ActionContext {
  state: Record<string, any>;
  setState: (updates: Partial<Record<string, any>>) => void;
  eventBus: {
    emit: (event: string, data?: any) => void;
    on: (event: string, handler: Function) => () => void;
  };
}

export type ActionPayload = any;

export class ActionHandler {
  private context: ActionContext;
  private pendingActions: Map<string, Promise<any>> = new Map();

  constructor(context: ActionContext) {
    this.context = context;
  }

  /**
   * Execute an action by name
   */
  async execute(actionName: string, action: ActionNode, payload?: ActionPayload): Promise<any> {
    console.log(`[ActionHandler] Executing action: ${actionName}`, { action, payload });

    try {
      switch (action.type) {
        case 'IPC_MESSAGE':
          return await this.handleIpcMessage(action, payload);
        
        case 'STATE_UPDATE':
          return this.handleStateUpdate(action, payload);
        
        case 'CONDITIONAL':
          return await this.handleConditional(action, payload);
        
        case 'AI_REQUEST':
          return await this.handleAiRequest(action, payload);
        
        default:
          console.warn(`Unknown action type: ${action.type}`);
          return null;
      }
    } catch (error) {
      console.error(`Action execution failed: ${actionName}`, error);
      throw error;
    }
  }

  /**
   * Handle IPC_MESSAGE action - Send message to orchestrator via Chrome extension
   */
  private async handleIpcMessage(action: ActionNode, payload?: ActionPayload): Promise<any> {
    const messagePayload = this.resolvePayload(action.payload, payload);

    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        console.warn('Chrome runtime not available, simulating IPC message');
        resolve({ success: true, simulated: true });
        return;
      }

      chrome.runtime.sendMessage(messagePayload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Handle success callback
        if (action.onSuccess && response?.success) {
          this.executeCallbacks(action.onSuccess, response);
        }

        resolve(response);
      });
    });
  }

  /**
   * Handle STATE_UPDATE action - Update application state
   */
  private handleStateUpdate(action: ActionNode, payload?: ActionPayload): void {
    if (!action.updates) {
      console.warn('STATE_UPDATE action missing updates field');
      return;
    }

    const updates = this.resolvePayload(action.updates, payload);
    this.context.setState(updates);

    console.log('[ActionHandler] State updated:', updates);

    // Handle 'then' callbacks
    if (action.then) {
      this.executeCallbacks(action.then, payload);
    }
  }

  /**
   * Handle CONDITIONAL action - Route based on conditions
   */
  private async handleConditional(action: ActionNode, payload?: ActionPayload): Promise<any> {
    if (!action.conditions) {
      console.warn('CONDITIONAL action missing conditions');
      return null;
    }

    for (const condition of action.conditions) {
      if (this.evaluateCondition(condition.when, payload)) {
        console.log(`[ActionHandler] Condition matched: ${condition.when}`);
        
        // Execute the matched action
        // Note: This would need access to the full action registry
        this.context.eventBus.emit('action:trigger', {
          actionName: condition.action,
          payload
        });
        
        return { matched: condition.action };
      }
    }

    console.log('[ActionHandler] No condition matched');
    return null;
  }

  /**
   * Handle AI_REQUEST action - Send prompt to AI via orchestrator
   */
  private async handleAiRequest(action: ActionNode, payload?: ActionPayload): Promise<any> {
    if (!action.prompt) {
      console.warn('AI_REQUEST action missing prompt');
      return null;
    }

    const resolvedPrompt = this.resolvePayload(action.prompt, payload);

    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        console.warn('Chrome runtime not available for AI request');
        resolve({ success: false, error: 'Chrome runtime unavailable' });
        return;
      }

      chrome.runtime.sendMessage({
        type: 'AI_REQUEST',
        prompt: resolvedPrompt,
        context: payload
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(response);
      });
    });
  }

  /**
   * Resolve payload by substituting template variables
   * Handles expressions like "{payload.hunk}" or "{state.selectedFile}"
   */
  private resolvePayload(template: any, payload?: ActionPayload): any {
    if (typeof template === 'string') {
      // Replace {payload.xxx} with actual payload values
      let resolved = template.replace(/\{payload\.(\w+)\}/g, (_, key) => {
        return payload?.[key] ?? '';
      });

      // Replace {state.xxx} with actual state values
      resolved = resolved.replace(/\{state\.(\w+)\}/g, (_, key) => {
        return this.context.state[key] ?? '';
      });

      return resolved;
    }

    if (typeof template === 'object' && template !== null) {
      if (Array.isArray(template)) {
        return template.map(item => this.resolvePayload(item, payload));
      }

      const resolved: Record<string, any> = {};
      for (const [key, value] of Object.entries(template)) {
        resolved[key] = this.resolvePayload(value, payload);
      }
      return resolved;
    }

    return template;
  }

  /**
   * Evaluate a condition expression
   * Supports simple comparisons like "payload.color === 'blue'"
   */
  private evaluateCondition(condition: string, payload?: ActionPayload): boolean {
    // Handle equality checks: payload.property === "value"
    const equalityMatch = condition.match(/^payload\.(\w+)\s*===\s*['"](.+)['"]$/);
    if (equalityMatch) {
      const [, property, value] = equalityMatch;
      return payload?.[property] === value;
    }

    // Handle inequality checks: payload.property !== "value"
    const inequalityMatch = condition.match(/^payload\.(\w+)\s*!==\s*['"](.+)['"]$/);
    if (inequalityMatch) {
      const [, property, value] = inequalityMatch;
      return payload?.[property] !== value;
    }

    // Handle state checks: state.property
    const stateMatch = condition.match(/^state\.(\w+)$/);
    if (stateMatch) {
      const [, property] = stateMatch;
      return Boolean(this.context.state[property]);
    }

    // Handle negation: !state.property
    const negationMatch = condition.match(/^!state\.(\w+)$/);
    if (negationMatch) {
      const [, property] = negationMatch;
      return !this.context.state[property];
    }

    console.warn(`Unsupported condition expression: ${condition}`);
    return false;
  }

  /**
   * Execute callback actions (onSuccess, then, etc.)
   */
  private executeCallbacks(callbacks: any[], data?: any): void {
    for (const callback of callbacks) {
      if (typeof callback === 'object' && callback.updateState) {
        const updates = this.resolvePayload(callback.updateState, data);
        this.context.setState(updates);
      } else if (typeof callback === 'object' && callback.action) {
        this.context.eventBus.emit('action:trigger', {
          actionName: callback.action,
          payload: data
        });
      }
    }
  }

  /**
   * Update action context (when state changes)
   */
  updateContext(context: Partial<ActionContext>): void {
    this.context = { ...this.context, ...context };
  }
}

// Chrome runtime type declaration
declare const chrome: {
  runtime: {
    sendMessage: (message: any, callback?: (response: any) => void) => void;
    lastError?: { message: string };
  };
};

/**
 * Create action handler with context
 */
export function createActionHandler(context: ActionContext): ActionHandler {
  return new ActionHandler(context);
}
