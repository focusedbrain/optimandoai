/**
 * Block Schema Types
 * Defines the structure for code block metadata and configuration
 */

import type React from 'react';

export interface BlockInput {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function';
  description: string;
  required?: boolean;
  default?: any;
}

export interface BlockOutput {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'function' | 'component';
  description: string;
}

export interface BlockMetadata {
  id: string;
  name: string;
  description: string;
  category: 'bootstrap' | 'ui' | 'diff-viewer' | 'integrations' | 'actions';
  version: string;
  inputs: Record<string, BlockInput>;
  outputs: Record<string, BlockOutput>;
  dependencies: string[];
  cspCompliant: boolean;
  securityHash: string;
  plainEnglishDescription: string;
}

/**
 * Template AST Types
 * Represents parsed template structure
 */

export interface ComponentNode {
  type: string; // Component type
  blockId?: string; // Block ID if this is a code block component
  props: Record<string, any>;
  condition?: string; // Conditional rendering expression
  children?: ComponentNode[];
}

export interface ActionNode {
  type: string; // Action type (IPC_MESSAGE, STATE_UPDATE, CONDITIONAL, AI_REQUEST, etc.)
  payload?: any;
  updates?: Record<string, any>;
  conditions?: Array<{ when: string; action: string }>;
  blocks?: Array<{ block: string; props: Record<string, any> }>;
  prompt?: string;
  onSuccess?: any[];
  then?: any[];
}

export interface BootstrapConfig {
  blockId: string; // Block ID for app bootstrap
  props: Record<string, any>; // Bootstrap configuration
}

export interface TemplateComponent {
  block: string;
  props?: Record<string, any>;
  on?: Record<string, string>;
  icons?: IconTrigger[];
  children?: TemplateComponent[];
}

export interface IconTrigger {
  block: string;
  color: string;
  action: string;
  matchColor: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TemplateAST {
  name: string;
  version: string;
  bootstrap: BootstrapConfig;
  components: ComponentNode[];
  actions: Record<string, ActionNode>;
  events: any[];
}

/**
 * Builder Types
 */

export interface BuildContext {
  blocks: Map<string, BlockMetadata>;
  components: Map<string, React.ComponentType<any>>;
  state: Record<string, any>;
  actions: Record<string, Function>;
}

export interface BuildResult {
  Component: React.ComponentType<any>;
  metadata: {
    blocksUsed: string[];
    warnings: string[];
    errors: string[];
  };
}
