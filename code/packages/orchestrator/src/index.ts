/**
 * Main entry point for the Orchestrator package
 */

export { Orchestrator } from './Orchestrator';
export type { 
  OrchestratorConfig, 
  TemplateCache, 
  LoadedTemplate 
} from './Orchestrator';

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