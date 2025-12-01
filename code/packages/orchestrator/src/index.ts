/**
 * Main entry point for the Orchestrator package
 * 
 * Provides:
 * - Orchestrator: Main coordinator for template-driven apps
 * - SidebarManager: Manages mini-app sidebar panel
 * - SidebarRenderer: React component for rendering sidebar
 * - EventBus: Internal event system
 */

export { Orchestrator } from './Orchestrator';
export type { 
  OrchestratorConfig, 
  TemplateCache, 
  LoadedTemplate 
} from './Orchestrator';

export { SidebarManager, createGlassViewConfig } from './SidebarManager';
export type {
  MiniAppConfig,
  LoadedMiniApp,
  SidebarState
} from './SidebarManager';

export { SidebarRenderer } from './SidebarRenderer';
export type { SidebarRendererProps } from './SidebarRenderer';

export { EventBus } from './EventBus';
export type { 
  EventMap, 
  EventCallback, 
  EventListenerInfo 
} from './EventBus';

// Re-export from code-block-library for convenience
export type { 
  TemplateAST, 
  BuildResult, 
  BuildMetadata 
} from '@optimandoai/code-block-library';