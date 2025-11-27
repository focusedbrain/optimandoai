/**
 * Automation System Core Types
 * 
 * This module defines the core types for the listener/trigger/workflow system.
 * These types form the foundation for event-driven automation in the orchestrator.
 */

// =============================================================================
// Trigger Types
// =============================================================================

/**
 * Event source - where the trigger originates from
 */
export type TriggerSource = 
  | 'chat'      // User chat input in sidepanel/popup
  | 'dom'       // DOM events (click, mutation, scroll, etc.)
  | 'api'       // External API webhook
  | 'backend'   // Backend service events via WebSocket
  | 'workflow'  // Another workflow completed
  | 'cron'      // Scheduled time-based trigger

/**
 * Trigger scope - what the trigger applies to
 */
export type TriggerScope = 
  | 'global'    // Applies to all agents/workflows
  | 'agent'     // Specific to one agent
  | 'workflow'  // Specific to one workflow

/**
 * Content modality - type of content being processed
 */
export type Modality = 
  | 'text'      // Plain text content
  | 'table'     // Tabular data
  | 'diagram'   // Diagrams/flowcharts
  | 'image'     // Static images
  | 'video'     // Video content
  | 'code'      // Source code
  | 'math'      // Mathematical expressions
  | 'error'     // Error messages
  | 'other'     // Catch-all for other types

/**
 * Trigger configuration - defines when/how a listener is activated
 */
export interface TriggerConfig {
  /** Event source type */
  source: TriggerSource
  
  /** Scope of the trigger */
  scope: TriggerScope
  
  /** Content modalities this trigger handles */
  modalities: Modality[]
  
  // Source-specific options
  
  /** Cron expression for scheduled triggers (e.g., "0 * * * *" for hourly) */
  schedule?: string
  
  /** Polling interval in milliseconds */
  pollingInterval?: number
  
  /** Path for API webhook triggers */
  webhookPath?: string
  
  /** CSS selector for DOM event triggers */
  domSelector?: string
  
  /** DOM event type (click, mutate, scroll, etc.) */
  domEvent?: string
  
  /** Workflow ID for workflow triggers */
  workflowId?: string
}

// =============================================================================
// Condition Types
// =============================================================================

/**
 * Comparison operators for field conditions
 */
export type ConditionOperator = 
  | 'eq'        // Equals (===)
  | 'ne'        // Not equals (!==)
  | 'contains'  // String contains
  | 'startsWith'// String starts with
  | 'endsWith'  // String ends with
  | 'gt'        // Greater than (>)
  | 'lt'        // Less than (<)
  | 'gte'       // Greater than or equal (>=)
  | 'lte'       // Less than or equal (<=)
  | 'regex'     // Regex pattern match
  | 'exists'    // Field exists and is not null/undefined
  | 'in'        // Value is in array
  | 'nin'       // Value is not in array

/**
 * Field comparison condition
 */
export interface FieldCondition {
  /** Dot-notation path to field (e.g., "input.length", "metadata.url") */
  field: string
  
  /** Comparison operator */
  op: ConditionOperator
  
  /** Value to compare against */
  value: any
}

/**
 * AND condition - all sub-conditions must be true
 */
export interface AllCondition {
  all: Condition[]
}

/**
 * OR condition - at least one sub-condition must be true
 */
export interface AnyCondition {
  any: Condition[]
}

/**
 * NOT condition - sub-condition must be false
 */
export interface NotCondition {
  not: Condition
}

/**
 * Recursive condition type supporting AND/OR/NOT logic
 * 
 * @example Simple field check
 * { field: 'input.length', op: 'gt', value: 10 }
 * 
 * @example AND logic
 * { all: [
 *   { field: 'source', op: 'eq', value: 'chat' },
 *   { field: 'hasImage', op: 'eq', value: true }
 * ]}
 * 
 * @example Nested conditions
 * { all: [
 *   { field: 'enabled', op: 'eq', value: true },
 *   { any: [
 *     { field: 'priority', op: 'eq', value: 'high' },
 *     { field: 'urgent', op: 'eq', value: true }
 *   ]}
 * ]}
 */
export type Condition = 
  | AllCondition 
  | AnyCondition 
  | NotCondition 
  | FieldCondition

// =============================================================================
// Automation Config Types
// =============================================================================

/**
 * Listener mode
 * - active: Requires explicit user action (e.g., @mention)
 * - passive: Runs in background without user intervention
 */
export type ListenerMode = 'active' | 'passive'

/**
 * Main automation/listener configuration
 * 
 * This is the central configuration type that defines a complete
 * automation pipeline from trigger to action.
 */
export interface AutomationConfig {
  /** Unique identifier */
  id: string
  
  /** Human-readable name */
  name: string
  
  /** Whether this automation is enabled */
  enabled: boolean
  
  /** Active or passive listener mode */
  mode: ListenerMode
  
  /** Trigger configuration */
  trigger: TriggerConfig
  
  // Pattern matching (legacy support)
  
  /** Tag patterns to match */
  tags?: string[]
  
  /** @mention patterns (e.g., ["Invoice", "Report"]) */
  patterns?: string[]
  
  /** Keywords/phrases for context matching */
  expectedContext?: string
  
  /** URL pattern filter */
  website?: string
  
  // Pipeline configuration
  
  /** IDs of sensor workflows to run (read-only context collection) */
  sensorWorkflows: string[]
  
  /** Condition tree to evaluate (null = always pass) */
  conditions: Condition | null
  
  /** Agent ID to use for reasoning */
  reasoningProfile: string
  
  /** Whitelisted action workflow IDs */
  allowedActions: string[]
  
  /** Destinations for reporting results */
  reportTo?: string[]
}

// =============================================================================
// Workflow Types
// =============================================================================

/**
 * Workflow step types
 */
export type WorkflowStepType = 
  | 'agent'      // Call an agent for processing
  | 'condition'  // Conditional branching
  | 'loop'       // Loop/iteration
  | 'parallel'   // Parallel execution of steps
  | 'wait'       // Wait/delay
  | 'transform'  // Data transformation
  | 'api'        // External API call
  | 'store'      // Storage operation
  | 'notify'     // Send notification

/**
 * Single workflow step
 */
export interface WorkflowStep {
  /** Unique step identifier */
  id: string
  
  /** Human-readable name */
  name?: string
  
  /** Step type */
  type: WorkflowStepType
  
  /** Type-specific configuration */
  config: Record<string, any>
  
  /** IDs of next steps to execute */
  nextSteps: string[]
  
  /** Step to run on error (optional) */
  onError?: string
}

/**
 * Workflow type classification
 */
export type WorkflowType = 'sensor' | 'action'

/**
 * Complete workflow definition
 */
export interface WorkflowDefinition {
  /** Unique workflow identifier */
  id: string
  
  /** Human-readable name */
  name: string
  
  /** Description of what this workflow does */
  description?: string
  
  /** Whether this is a sensor (read-only) or action (side-effects) workflow */
  type: WorkflowType
  
  /** Ordered list of steps */
  steps: WorkflowStep[]
  
  /** ID of the first step to execute */
  entryStep: string
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Normalized event from any trigger source
 * 
 * All triggers produce this normalized format for consistent processing.
 */
export interface NormalizedEvent {
  /** Unique event identifier */
  id: string
  
  /** Unix timestamp when event occurred */
  timestamp: number
  
  /** Source of the event */
  source: TriggerSource
  
  /** Scope of the event */
  scope: TriggerScope
  
  /** Content modalities present */
  modalities: Modality[]
  
  // Content
  
  /** Primary text input */
  input: string
  
  /** Image URL if present */
  imageUrl?: string
  
  /** Video URL if present */
  videoUrl?: string
  
  /** Additional metadata */
  metadata: Record<string, any>
  
  // Context
  
  /** Current page URL */
  url?: string
  
  /** Chrome tab ID */
  tabId?: number
  
  /** Session key */
  sessionKey?: string
  
  /** Target agent ID (for scoped events) */
  agentId?: string
  
  /** Source workflow ID (for workflow triggers) */
  sourceWorkflowId?: string
}

// =============================================================================
// Execution Context Types
// =============================================================================

/**
 * Workflow execution context
 * 
 * Passed through the pipeline and accumulates data from each step.
 */
export interface WorkflowContext {
  /** The triggering event */
  event: NormalizedEvent
  
  /** Data collected by sensor workflows */
  collectedData: Record<string, any>
  
  /** Result from the reasoning layer */
  reasoningResult?: any
  
  /** Errors that occurred during execution */
  errors: Error[]
  
  /** Current step in execution */
  currentStep?: string
  
  /** Execution start time */
  startTime: number
}

/**
 * Result from processing an event
 */
export interface ProcessingResult {
  /** Whether processing succeeded */
  success: boolean
  
  /** The automation config that was executed */
  automationId: string
  
  /** Matched listener information */
  matchReason: string
  
  /** Data collected by sensor workflows */
  sensorData: Record<string, any>
  
  /** Whether conditions passed */
  conditionsPassed: boolean
  
  /** Result from reasoning */
  reasoningResult?: any
  
  /** Results from action workflows */
  actionResults: ActionResult[]
  
  /** Any errors that occurred */
  errors: Error[]
  
  /** Execution duration in ms */
  duration: number
}

/**
 * Result from an action workflow
 */
export interface ActionResult {
  /** Workflow ID */
  workflowId: string
  
  /** Whether action succeeded */
  success: boolean
  
  /** Action output data */
  output?: any
  
  /** Error if failed */
  error?: Error
}

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Trigger handler function signature
 */
export type TriggerHandler = (event: NormalizedEvent) => void

/**
 * Event subscription callback
 */
export type EventSubscriber = (event: NormalizedEvent) => void | Promise<void>

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// =============================================================================
// Legacy Compatibility Types
// =============================================================================

/**
 * Legacy trigger format (from old AgentConfig)
 */
export interface LegacyTrigger {
  tag?: {
    name: string
    kind?: string
  }
}

/**
 * Legacy listening configuration (from old AgentConfig)
 */
export interface LegacyListeningConfig {
  passiveEnabled?: boolean
  activeEnabled?: boolean
  expectedContext?: string
  tags?: string[]
  source?: string
  website?: string
  passive?: {
    triggers?: LegacyTrigger[]
  }
  active?: {
    triggers?: LegacyTrigger[]
  }
  reportTo?: string[]
}

/**
 * Legacy agent configuration (partial, for adapter)
 */
export interface LegacyAgentConfig {
  id: string
  name: string
  key?: string
  enabled: boolean
  number?: number
  listening?: LegacyListeningConfig
  reasoning?: {
    applyFor?: string
    acceptFrom?: string[]
    goals?: string
    role?: string
    rules?: string
    custom?: Array<{ key: string; value: string }>
  }
  execution?: {
    workflows?: string[]
    specialDestinations?: Array<{ kind: string; agents?: string[] }>
  }
}




