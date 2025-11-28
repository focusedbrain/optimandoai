/**
 * Component Builder
 * 
 * Builds React components from parsed template AST.
 * Assembles pre-built blocks into working applications.
 * 
 * CRITICAL: Must maintain CSP compliance - no eval(), no new Function()
 */

import React from 'react';
import { TemplateAST, ComponentNode, ActionNode, BuildContext, BuildResult } from '../types';
import { getBlock, registry } from '../registry/BlockRegistry';
import { Container, InputGroup, Button, StatusIndicator } from '../blocks/basic-ui/BasicComponents';
import { useApp } from '../blocks/bootstrap/react-app.component';

/**
 * ActionListener Component
 * 
 * Listens for action events and executes corresponding action handlers.
 * This component doesn't render anything - it just sets up event listeners.
 */
interface ActionListenerProps {
  actions: Record<string, Function>;
}

const ActionListener: React.FC<ActionListenerProps> = ({ actions }) => {
  const { eventBus, state, updateState } = useApp();

  React.useEffect(() => {
    console.log('[ActionListener] Setting up action listeners for:', Object.keys(actions));
    
    const unsubscribe = eventBus.on('action', (eventData: any) => {
      const actionType = eventData?.type;
      console.log('[ActionListener] Action event received:', actionType, eventData);
      
      if (actionType && actions[actionType]) {
        console.log('[ActionListener] Executing action:', actionType);
        try {
          actions[actionType](eventData, state, updateState);
        } catch (error) {
          console.error(`[ActionListener] Error executing action ${actionType}:`, error);
        }
      } else {
        console.warn('[ActionListener] No handler found for action:', actionType);
      }
    });

    return () => {
      console.log('[ActionListener] Cleaning up action listeners');
      unsubscribe();
    };
  }, [actions, eventBus, state, updateState]);

  return null; // This component doesn't render anything
};

/**
 * IpcEventListener Component
 * 
 * Listens for IPC events from Electron (via chrome.runtime.onMessage)
 * and updates state accordingly.
 */
const IpcEventListener: React.FC = () => {
  const { updateState } = useApp();

  React.useEffect(() => {
    console.log('[IpcEventListener] Setting up IPC event listeners');
    
    const handleMessage = (message: any) => {
      console.log('[IpcEventListener] Message received:', message);
      
      // Handle WATCHING_STARTED event
      if (message.type === 'WATCHING_STARTED') {
        console.log('[IpcEventListener] Watching started, updating state');
        updateState('isWatching', true);
      }
      
      // Handle WATCHING_STOPPED event
      if (message.type === 'WATCHING_STOPPED') {
        console.log('[IpcEventListener] Watching stopped, updating state');
        updateState('isWatching', false);
        updateState('changedFiles', []);
      }
      
      // Handle FILE_CHANGED event
      if (message.type === 'FILE_CHANGED' && message.filePath) {
        console.log('[IpcEventListener] File changed:', message.filePath);
        // Add file to changedFiles array if not already there
        // Note: This is simplified - proper implementation would use updateState with callback
      }
    };

    // Use type assertion to access onMessage
    const runtime = (chrome as any).runtime;
    if (runtime && runtime.onMessage) {
      runtime.onMessage.addListener(handleMessage);
      
      return () => {
        runtime.onMessage.removeListener(handleMessage);
      };
    }
  }, [updateState]);

  return null;
};

/**
 * ConditionalWrapper Component
 * 
 * Wraps a component and only renders it if the condition evaluates to true.
 * Conditions are evaluated dynamically against current state.
 */
interface ConditionalWrapperProps {
  condition: string;
  children: React.ReactNode;
}

const ConditionalWrapper: React.FC<ConditionalWrapperProps> = ({ condition, children }) => {
  const { state } = useApp();
  
  console.log('[ConditionalWrapper] Evaluating condition:', condition, 'with state:', state);
  
  // Evaluate condition expression
  const shouldRender = evaluateCondition(condition, state);
  
  console.log('[ConditionalWrapper] Condition result:', shouldRender);
  
  return shouldRender ? (children as React.ReactElement) : null;
};

/**
 * Evaluate a condition expression against state
 * Supports: state.key, !state.key, state.array.length > 0, etc.
 */
function evaluateCondition(condition: string, state: Record<string, any>): boolean {
  try {
    // Replace state references with actual values
    let expression = condition;
    
    // Handle negation: !state.isWatching
    const isNegated = expression.startsWith('!');
    if (isNegated) {
      expression = expression.slice(1).trim();
    }
    
    // Handle simple state.key access
    if (expression.startsWith('state.')) {
      const path = expression.slice(6); // Remove 'state.'
      const value = getNestedValue(state, path);
      return isNegated ? !value : !!value;
    }
    
    // Handle comparisons like: state.array.length > 0
    if (expression.includes('>') || expression.includes('<') || expression.includes('===') || expression.includes('!==')) {
      // Extract the state part and evaluate it
      const stateMatch = expression.match(/state\.[\w.]+/g);
      if (stateMatch) {
        // CSP-compliant evaluation without new Function()
        return safeEvaluateComparison(expression, state);
      }
    }
    
    return !isNegated;
  } catch (error) {
    console.error('[ConditionalWrapper] Failed to evaluate condition:', condition, error);
    return false;
  }
}

/**
 * Get nested value from object using dot notation
 * Example: getNestedValue({ foo: { bar: 'baz' } }, 'foo.bar') => 'baz'
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Safely evaluate comparison expressions without using eval() or new Function()
 * CSP-compliant implementation that parses and evaluates simple comparisons
 */
function safeEvaluateComparison(expression: string, state: Record<string, any>): boolean {
  try {
    // Parse expression like "state.array.length > 0"
    // Supported operators: >, <, >=, <=, ===, !==
    
    // Try to match different comparison patterns
    const patterns = [
      { regex: /^(.+?)\s*>\s*(.+)$/, op: (a: any, b: any) => Number(a) > Number(b) },
      { regex: /^(.+?)\s*<\s*(.+)$/, op: (a: any, b: any) => Number(a) < Number(b) },
      { regex: /^(.+?)\s*>=\s*(.+)$/, op: (a: any, b: any) => Number(a) >= Number(b) },
      { regex: /^(.+?)\s*<=\s*(.+)$/, op: (a: any, b: any) => Number(a) <= Number(b) },
      { regex: /^(.+?)\s*===\s*(.+)$/, op: (a: any, b: any) => a === b },
      { regex: /^(.+?)\s*!==\s*(.+)$/, op: (a: any, b: any) => a !== b }
    ];

    for (const pattern of patterns) {
      const match = expression.match(pattern.regex);
      if (match) {
        const [, left, right] = match;
        
        // Evaluate left side (usually state.something)
        const leftValue = left.trim().startsWith('state.') 
          ? getNestedValue(state, left.trim().slice(6))
          : parseValue(left.trim());
        
        // Evaluate right side (usually a literal or state.something)
        const rightValue = right.trim().startsWith('state.')
          ? getNestedValue(state, right.trim().slice(6))
          : parseValue(right.trim());
        
        return pattern.op(leftValue, rightValue);
      }
    }
    
    return false;
  } catch (error) {
    console.error('[safeEvaluateComparison] Error evaluating:', expression, error);
    return false;
  }
}

/**
 * Parse a literal value from string
 */
function parseValue(value: string): any {
  // Remove quotes from strings
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  
  // Parse numbers
  if (!isNaN(Number(value))) {
    return Number(value);
  }
  
  // Parse booleans
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === 'undefined') return undefined;
  
  return value;
}

export class ComponentBuilder {
  private warnings: string[] = [];
  private errors: string[] = [];

  /**
   * Map generic component types to HTML elements or basic React components
   */
  private mapComponentType(type: string): React.ComponentType<any> | string {
    const componentMap: Record<string, React.ComponentType<any> | string> = {
      'container': Container,
      'button': Button,
      'input-group': InputGroup,
      'status-indicator': StatusIndicator,
      'text': 'span',
      'label': 'label',
      'section': 'section',
      'header': 'header',
      'footer': 'footer'
    };

    return componentMap[type] || 'div';
  }

  /**
   * Build a React component from template AST
   */
  build(ast: TemplateAST): BuildResult | null {
    this.warnings = [];
    this.errors = [];

    try {
      // Validate bootstrap block
      const bootstrapBlock = getBlock(ast.bootstrap.blockId);
      if (!bootstrapBlock) {
        this.errors.push(`Bootstrap block not found: ${ast.bootstrap.blockId}`);
        return null;
      }

      // Build the component tree
      const BuiltComponent: React.FC = () => {
        const BootstrapComponent = bootstrapBlock.component as any;
        const bootstrapProps = this.resolveProps(ast.bootstrap.props, {});

        // Build context for child components
        const context: BuildContext = {
          blocks: new Map(),
          components: new Map(),
          state: bootstrapProps.initialState || {},
          actions: this.buildActionHandlers(ast.actions)
        };

        // Build child components
        const children = this.buildComponentTree(ast.components, context);

        // Wrap children with ActionListener, IpcEventListener, and original children
        const childrenWithListener = [
          React.createElement(ActionListener, { 
            key: 'action-listener',
            actions: context.actions 
          }),
          React.createElement(IpcEventListener, { 
            key: 'ipc-event-listener'
          }),
          ...React.Children.toArray(children)
        ];

        return React.createElement(
          BootstrapComponent,
          bootstrapProps,
          childrenWithListener
        );
      };

      // Track which blocks were used
      const blocksUsed = [ast.bootstrap.blockId];
      this.collectUsedBlocks(ast.components, blocksUsed);

      return {
        Component: BuiltComponent,
        metadata: {
          blocksUsed,
          warnings: this.warnings,
          errors: this.errors
        }
      };
    } catch (error) {
      this.errors.push(`Build failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Build component tree recursively
   */
  private buildComponentTree(nodes: ComponentNode[], context: BuildContext): React.ReactNode {
    console.log('[ComponentBuilder] Building component tree with', nodes.length, 'nodes');
    
    return nodes.map((node, index) => {
      console.log(`[ComponentBuilder] Building node ${index}:`, node.type, 'condition:', node.condition);
      
      // Get block if this is a block component
      let Component: React.ComponentType<any> | string = this.mapComponentType(node.type);
      
      if (node.blockId) {
        const block = getBlock(node.blockId);
        if (!block) {
          this.errors.push(`Block not found: ${node.blockId}`);
          return null;
        }
        Component = block.component;
        console.log(`[ComponentBuilder] Using block component for:`, node.blockId);
      }

      // Resolve props (handle state bindings)
      const props = this.resolveProps(node.props, context.state);

      // Build children recursively
      const children = node.children 
        ? this.buildComponentTree(node.children, context)
        : undefined;

      console.log(`[ComponentBuilder] Creating element:`, node.type, 'props:', Object.keys(props));

      // Create React element
      const element = React.createElement(
        Component,
        { key: `${node.type}-${index}`, ...props },
        children
      );

      // Wrap with conditional rendering if needed
      if (node.condition) {
        return React.createElement(
          ConditionalWrapper,
          { 
            key: `conditional-${index}`,
            condition: node.condition,
            children: element
          }
        );
      }

      return element;
    });
  }

  /**
   * Resolve props, handling state bindings like "{state.value}"
   */
  private resolveProps(props: Record<string, any>, state: Record<string, any>): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(props)) {
      if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        // This is a state binding expression
        const expression = value.slice(1, -1).trim();
        resolved[key] = this.evaluateExpression(expression, state);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively resolve nested objects
        resolved[key] = this.resolveProps(value, state);
      } else {
        // Plain value
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Evaluate state binding expression
   * IMPORTANT: This does NOT use eval() - it only handles simple property access
   */
  private evaluateExpression(expression: string, state: Record<string, any>): any {
    // Handle simple state access like "state.propertyName"
    if (expression.startsWith('state.')) {
      const path = expression.substring(6).split('.');
      let value: any = state;
      
      for (const key of path) {
        // Handle array access like "state.items[0]"
        const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
        if (arrayMatch) {
          const [, propName, index] = arrayMatch;
          value = value?.[propName]?.[parseInt(index)];
        } else {
          value = value?.[key];
        }
        
        if (value === undefined) break;
      }
      
      return value;
    }

    // Handle function calls (limited set)
    if (expression.includes('(')) {
      this.warnings.push(`Function calls in expressions not fully supported: ${expression}`);
      return undefined;
    }

    // Plain string or unsupported expression
    this.warnings.push(`Unsupported expression: ${expression}`);
    return expression;
  }

  /**
   * Build action handlers from action definitions
   */
  private buildActionHandlers(actions: Record<string, ActionNode>): Record<string, Function> {
    const handlers: Record<string, Function> = {};

    for (const [name, action] of Object.entries(actions)) {
      handlers[name] = this.createActionHandler(name, action);
    }

    return handlers;
  }

  /**
   * Create a handler function for an action
   */
  private createActionHandler(name: string, action: ActionNode): Function {
    return (eventData: any, state: any, updateState: any) => {
      console.log(`[ActionHandler] Action triggered: ${name}`, { action, eventData, state });

      switch (action.type) {
        case 'IPC_MESSAGE':
          this.handleIpcMessage(action, state, updateState);
          break;
        
        case 'STATE_UPDATE':
          this.handleStateUpdate(action, updateState);
          break;
        
        case 'CONDITIONAL':
          this.handleConditional(action, eventData);
          break;
        
        case 'AI_REQUEST':
          this.handleAiRequest(action);
          break;
        
        default:
          this.warnings.push(`Unknown action type: ${action.type}`);
      }
    };
  }

  /**
   * Handle IPC message action (send to orchestrator)
   */
  private handleIpcMessage(action: ActionNode, state: any, updateState: any): void {
    // Resolve payload with state interpolation
    const payload = this.resolveProps(action.payload || {}, state);
    
    console.log('[ActionHandler] Sending IPC message:', payload);
    
    // Check if Chrome runtime is available
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage(payload, (response: any) => {
        console.log('[ActionHandler] IPC response:', response);
        
        // Handle onSuccess actions
        if (response && !response.error && action.onSuccess) {
          this.handleSuccessActions(action.onSuccess, state, updateState, response);
        }
      });
    } else {
      console.warn('[ActionHandler] Chrome runtime not available');
    }
  }
  
  /**
   * Handle success actions after IPC response
   */
  private handleSuccessActions(successActions: any[], state: any, updateState: any, response: any): void {
    for (const successAction of successActions) {
      if (successAction.updateState) {
        // Update state with provided values
        for (const [key, value] of Object.entries(successAction.updateState)) {
          updateState(key, value);
        }
      }
    }
  }

  /**
   * Handle state update action
   */
  private handleStateUpdate(action: ActionNode, updateState: any): void {
    if (action.updates) {
      for (const [key, value] of Object.entries(action.updates)) {
        updateState(key, value);
      }
    }
  }

  /**
   * Handle conditional action (e.g., icon color routing)
   */
  private handleConditional(action: ActionNode, args: any[]): void {
    if (!action.conditions) return;

    const payload = args[0];
    
    for (const condition of action.conditions) {
      // Simple condition evaluation (e.g., "payload.color === 'blue'")
      if (this.evaluateCondition(condition.when, payload)) {
        console.log(`Condition matched: ${condition.when} -> ${condition.action}`);
        // Trigger the matched action
        break;
      }
    }
  }

  /**
   * Handle AI request action
   */
  private handleAiRequest(action: ActionNode): void {
    if (!action.prompt) return;
    
    console.log('AI Request:', action.prompt);
    
    // Send to orchestrator for AI processing
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        type: 'AI_REQUEST',
        prompt: action.prompt
      });
    }
  }

  /**
   * Evaluate a simple condition expression
   */
  private evaluateCondition(condition: string, payload: any): boolean {
    // Simple equality check: "payload.color === 'blue'"
    const match = condition.match(/^payload\.(\w+)\s*===\s*['"](.+)['"]$/);
    if (match) {
      const [, property, value] = match;
      return payload[property] === value;
    }
    
    this.warnings.push(`Complex condition not supported: ${condition}`);
    return false;
  }

  /**
   * Collect all block IDs used in component tree
   */
  private collectUsedBlocks(nodes: ComponentNode[], blocksUsed: string[]): void {
    for (const node of nodes) {
      if (node.blockId && !blocksUsed.includes(node.blockId)) {
        blocksUsed.push(node.blockId);
      }
      if (node.children) {
        this.collectUsedBlocks(node.children, blocksUsed);
      }
    }
  }

  /**
   * Get build warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Get build errors
   */
  getErrors(): string[] {
    return [...this.errors];
  }
}

// Chrome runtime types (for IPC)
declare const chrome: {
  runtime: {
    sendMessage: (message: any, callback?: (response: any) => void) => void;
  };
};

// Export singleton instance
export const componentBuilder = new ComponentBuilder();
