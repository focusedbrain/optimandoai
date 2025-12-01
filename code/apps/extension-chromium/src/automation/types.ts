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
// Unified Trigger Types (New Architecture)
// =============================================================================

/**
 * Event channel - where the triggering event originates
 */
export type EventChannel = 
  | 'chat'           // WR Chat
  | 'email'          // Email messages
  | 'web'            // Web page / Messaging
  | 'overlay'        // Augmented Overlay
  | 'agent'          // From another Agent
  | 'miniapp'        // From a Mini-App
  | 'screenshot'     // Screenshot capture
  | 'stream'         // Live stream
  | 'pdf'            // PDF document
  | 'docs'           // Document files
  | 'voicememo'      // Voice memo recording
  | 'video'          // Video content
  | 'voice_command'  // Voice command input
  | 'picture'        // Picture/image input
  | 'api'            // External API webhook
  | 'workflow'       // From another workflow

/**
 * Unified trigger type - categorizes how an agent can be activated
 * 
 * - direct_tag: Event Triggers - direct user-driven (e.g., #tag in chat/email)
 * - workflow_condition: Condition Triggers - workflow-driven activation
 * - tag_and_condition: Gated Triggers - requires both event and condition
 * - ui_event: UI Event Triggers - DOM/button events (click, scroll, hover)
 * - manual: Manual Triggers - command/button press activation
 */
export type TriggerType = 
  | 'direct_tag'          // Event Triggers (direct user-driven)
  | 'workflow_condition'  // Condition Triggers (workflow-driven)
  | 'tag_and_condition'   // Gated Triggers (event + condition)
  | 'ui_event'            // UI Event Triggers (DOM/button events)
  | 'manual'              // Manual Triggers (command/button press)

// =============================================================================
// Event Tag Trigger Condition Types
// =============================================================================

/**
 * Condition type for Event Tag triggers
 * 
 * These are predefined, reusable condition types that map to UI sections:
 * - wrcode_valid: Requires WRCode/WRGuard verification passed
 * - sender_whitelist: Sender must be in allowed list (email)
 * - body_keywords: Body must contain any of these keywords
 * - website_filter: URL must match pattern (web/overlay channel)
 */
export type EventTagConditionType = 
  | 'wrcode_valid'      // Requires valid WRCode stamp
  | 'sender_whitelist'  // Sender in allowed list
  | 'body_keywords'     // Body contains keywords
  | 'website_filter'    // URL matches pattern

/**
 * WRCode validation condition
 * Requires the event to have passed WRCode/WRGuard verification
 */
export interface WRCodeCondition {
  type: 'wrcode_valid'
  /** Whether WRCode validation is required */
  required: boolean
}

/**
 * Sender whitelist condition
 * Only allows events from specific sender addresses
 */
export interface SenderWhitelistCondition {
  type: 'sender_whitelist'
  /** List of allowed sender addresses (emails) */
  allowedSenders: string[]
}

/**
 * Body keywords condition
 * Requires the event body to contain at least one of these keywords
 */
export interface BodyKeywordsCondition {
  type: 'body_keywords'
  /** List of keywords to match (any must be present) */
  keywords: string[]
  /** Whether match should be case-insensitive (default: true) */
  caseInsensitive?: boolean
}

/**
 * Website/domain filter condition
 * Only activates for events from matching URLs (for web/overlay channels)
 */
export interface WebsiteFilterCondition {
  type: 'website_filter'
  /** URL patterns to match (supports wildcards like *.example.com) */
  patterns: string[]
}

/**
 * Union of all Event Tag condition types
 */
export type EventTagCondition = 
  | WRCodeCondition
  | SenderWhitelistCondition
  | BodyKeywordsCondition
  | WebsiteFilterCondition

/**
 * Event Tag Trigger Configuration
 * 
 * A structured, typed configuration for Event Triggers (Tag).
 * This replaces the legacy free-form text fields with a clear, validated structure.
 * 
 * @example Email trigger with WRCode and sender whitelist
 * ```typescript
 * const trigger: EventTagTriggerConfig = {
 *   type: 'direct_tag',
 *   channel: 'email',
 *   tag: '#invoice',
 *   conditions: [
 *     { type: 'wrcode_valid', required: true },
 *     { type: 'sender_whitelist', allowedSenders: ['accounting@company.com'] },
 *     { type: 'body_keywords', keywords: ['urgent', 'payment'] }
 *   ]
 * }
 * ```
 */
export interface EventTagTriggerConfig {
  /** Discriminator - always 'direct_tag' for this config type */
  type: 'direct_tag'
  
  /** Event channel (email, chat, web, etc.) */
  channel: EventChannel
  
  /** The tag to match (e.g., '#invoice'). Required and must start with # */
  tag: string
  
  /** Optional human-readable name for this trigger */
  name?: string
  
  /** Whether this trigger is enabled */
  enabled: boolean
  
  /** Array of conditions to evaluate (all must pass) */
  conditions: EventTagCondition[]
}

/**
 * Unified trigger configuration - consolidates all trigger types into one interface
 * 
 * Each trigger type uses a subset of these fields:
 * - direct_tag: channel, tag, eventTagConditions (new structured format)
 * - workflow_condition: workflowId, conditions
 * - tag_and_condition: tagName, conditions, expectedContext
 * - ui_event: domSelector, domEvent
 * - manual: commandLabel
 * 
 * For direct_tag triggers, use the new structured eventTagConditions array
 * which provides clear, typed conditions (WRCode, sender whitelist, keywords, etc.)
 */
export interface UnifiedTriggerConfig {
  /** Unique identifier for this trigger */
  id: string
  
  /** The type of trigger */
  type: TriggerType
  
  /** Human-readable name for this trigger */
  name?: string
  
  /** Whether this trigger is enabled */
  enabled: boolean
  
  // === direct_tag fields (NEW structured format) ===
  
  /** Event channel for direct_tag triggers (email, chat, web, etc.) */
  channel?: EventChannel
  
  /** Tag to match (e.g., '#invoice'). Must start with # */
  tag?: string
  
  /** Structured conditions for direct_tag triggers */
  eventTagConditions?: EventTagCondition[]
  
  // === direct_tag fields (LEGACY - for backward compatibility) ===
  
  /** @deprecated Use 'tag' instead. Tag name without # prefix */
  tagName?: string
  
  /** @deprecated Use eventTagConditions with body_keywords instead */
  expectedContext?: string
  
  // === workflow_condition fields ===
  /** Source workflow ID that triggers this (for workflow_condition) */
  workflowId?: string
  
  /** Conditions that must be met (for workflow_condition and tag_and_condition) */
  conditions?: Condition[]
  
  // === ui_event fields ===
  /** CSS selector for DOM element (for ui_event triggers) */
  domSelector?: string
  
  /** DOM event type: click, scroll, hover, mutate, etc. (for ui_event triggers) */
  domEvent?: 'click' | 'scroll' | 'hover' | 'mutate' | 'focus' | 'blur' | 'input' | 'change'
  
  // === manual fields ===
  /** Command/button label for manual triggers */
  commandLabel?: string
  
  /** Optional keyboard shortcut for manual triggers */
  shortcut?: string
  
  // === agent channel fields ===
  /** Source agent number (01-50) for agent channel triggers */
  sourceAgent?: string
  
  // === miniapp channel fields ===
  /** Mini-App ID for miniapp channel triggers */
  miniAppId?: string
  
  /** UI elements configured for the Mini-App */
  miniAppUiElements?: Array<{
    type: 'button' | 'input' | 'select' | 'checkbox' | 'textarea'
    id: string
    label: string
  }>
  
  /** Conditions for Mini-App triggers */
  miniAppConditions?: Array<{
    field: string
    op: string
    value: string
  }>
  
  // === Common optional fields ===
  /** @deprecated Use eventTagConditions with website_filter instead */
  websiteFilter?: string
  
  /** Content modalities this trigger handles */
  modalities?: Modality[]
}

/**
 * Memory and context settings for reasoning
 */
export interface MemoryContextSettings {
  /** Session context access */
  sessionContext: {
    read: boolean
    write: boolean
  }
  
  /** Account memory access */
  accountMemory: {
    read: boolean
    write: boolean
  }
  
  /** Agent memory is always enabled (read-only display) */
  agentMemory: {
    enabled: true
  }
}

/**
 * New listening configuration using unified triggers
 */
export interface UnifiedListeningConfig {
  /** Array of unified triggers */
  triggers: UnifiedTriggerConfig[]
  
  /** IDs of sensor workflows to run before reasoning */
  sensorWorkflows?: string[]
  
  /** IDs of allowed action workflows */
  allowedActions?: string[]
}

/**
 * New reasoning configuration with memory/context settings
 */
export interface UnifiedReasoningConfig {
  /** Apply for specific trigger or '__any__' */
  applyFor?: string
  
  /** Accept input from specific sources */
  acceptFrom?: string[]
  
  /** Agent's goals/system instructions */
  goals?: string
  
  /** Agent's role description */
  role?: string
  
  /** Agent's rules/constraints */
  rules?: string
  
  /** Custom key-value fields */
  custom?: Array<{ key: string; value: string }>
  
  /** Memory and context settings */
  memoryContext: MemoryContextSettings
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
 * This interface is designed to support deterministic trigger evaluation
 * without any LLM/fuzzy matching at runtime.
 */
export interface NormalizedEvent {
  /** Unique event identifier */
  id: string
  
  /** Unix timestamp when event occurred */
  timestamp: number
  
  /** Source of the event */
  source: TriggerSource
  
  /** Event channel (email, chat, web, etc.) - more specific than source */
  channel?: EventChannel
  
  /** Scope of the event */
  scope: TriggerScope
  
  /** Content modalities present */
  modalities: Modality[]
  
  // Content
  
  /** Primary text input */
  input: string
  
  /** Email/message subject line (for email/chat channels) */
  subject?: string
  
  /** Body/content text (separate from subject for emails) */
  body?: string
  
  /** Image URL if present */
  imageUrl?: string
  
  /** Video URL if present */
  videoUrl?: string
  
  /** Additional metadata */
  metadata: Record<string, any>
  
  // Email-specific fields
  
  /** Sender address (email, chat username, etc.) */
  senderAddress?: string
  
  /** Whether WRCode/WRGuard validation passed */
  wrcodeValid?: boolean
  
  /** Raw WRCode data if present */
  wrcodeData?: Record<string, any>
  
  // Tag extraction
  
  /** List of extracted tags from subject/body (e.g., ['#invoice', '#urgent']) */
  extractedTags?: string[]
  
  // Context
  
  /** Current page URL */
  url?: string
  
  /** Domain extracted from URL (e.g., 'example.com') */
  domain?: string
  
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

// =============================================================================
// Event Tag Routing Types (Refactored Wiring)
// =============================================================================

/**
 * Output destination for execution results
 */
export interface OutputDestination {
  /** Destination type */
  kind: 'agent_box' | 'wr_chat' | 'inline_chat' | 'notification' | 'webhook'
  
  /** Agent Box ID if kind is 'agent_box' */
  agentBoxId?: string
  
  /** Agent Box number (01-50) */
  agentBoxNumber?: number
  
  /** Human-readable label */
  label: string
  
  /** Whether this destination is enabled */
  enabled: boolean
}

/**
 * LLM configuration resolved from an Agent Box
 */
export interface ResolvedLlmConfig {
  /** LLM provider (ollama, openai, anthropic, etc.) */
  provider: string
  
  /** Model name/identifier */
  model: string
  
  /** Agent Box ID this config comes from */
  agentBoxId: string
  
  /** Agent Box number */
  agentBoxNumber: number
  
  /** Agent Box title for display */
  agentBoxTitle?: string
  
  /** Whether the LLM is available/enabled */
  isAvailable: boolean
  
  /** Reason if not available */
  unavailableReason?: string
}

/**
 * Image generation configuration resolved from an Agent Box
 */
export interface ResolvedImageConfig {
  /** Image provider ID (comfyui, replicate, etc.) */
  provider: string
  
  /** Image model/preset name */
  model: string
  
  /** Provider type (local or cloud) */
  providerType: 'local' | 'cloud'
  
  /** Agent Box ID this config comes from */
  agentBoxId: string
  
  /** Agent Box number */
  agentBoxNumber: number
  
  /** Agent Box title for display */
  agentBoxTitle?: string
  
  /** Whether the image provider is available/enabled */
  isAvailable: boolean
  
  /** Reason if not available */
  unavailableReason?: string
}

/**
 * Reasoning configuration for an agent
 */
export interface ResolvedReasoningConfig {
  /** What this reasoning applies to (trigger ID or '__any__') */
  applyFor: string
  
  /** Agent's goals/system instructions */
  goals: string
  
  /** Agent's role description */
  role: string
  
  /** Agent's rules/constraints */
  rules: string
  
  /** Custom key-value fields */
  custom: Array<{ key: string; value: string }>
  
  /** Memory and context settings */
  memoryContext: {
    sessionContext: { read: boolean; write: boolean }
    accountMemory: { read: boolean; write: boolean }
    agentMemory: { enabled: boolean }
  }
  
  /** Reasoning workflows to run before LLM */
  reasoningWorkflows: string[]
}

/**
 * Execution configuration for an agent
 */
export interface ResolvedExecutionConfig {
  /** What this execution applies to (trigger ID or '__any__') */
  applyFor: string
  
  /** Workflows to execute */
  workflows: string[]
  
  /** Where to send the output */
  reportTo: OutputDestination[]
}

/**
 * Complete routing result for an Event Tag trigger match
 * 
 * This represents the full resolved configuration after:
 * 1. Listener matching (tag + channel + conditions)
 * 2. Sensor workflow context collection
 * 3. LLM resolution from connected Agent Box
 * 4. Reasoning section selection (via applyFor)
 * 5. Execution section selection (via applyFor)
 * 6. Output destination resolution (via reportTo)
 */
export interface EventTagRoutingResult {
  /** Whether a match was found */
  matched: boolean
  
  /** The matched agent's ID */
  agentId: string
  
  /** The matched agent's name */
  agentName: string
  
  /** The matched agent's icon */
  agentIcon: string
  
  /** The matched agent's number */
  agentNumber?: number
  
  /** The trigger that matched */
  trigger: {
    /** Trigger ID (e.g., 'ID#invoice') */
    id: string
    /** Trigger type */
    type: TriggerType
    /** The tag that matched (e.g., '#invoice') */
    tag: string
    /** The channel the trigger listens to */
    channel: EventChannel
  }
  
  /** Results from condition evaluation */
  conditionResults: {
    /** Whether all conditions passed */
    allPassed: boolean
    /** Individual condition results */
    conditions: Array<{
      type: EventTagConditionType | string
      passed: boolean
      details: string
    }>
  }
  
  /** Context collected from sensor workflows */
  sensorContext: Record<string, any>
  
  /** Resolved LLM configuration from Agent Box */
  llmConfig: ResolvedLlmConfig
  
  /** Resolved reasoning configuration */
  reasoningConfig: ResolvedReasoningConfig
  
  /** Resolved execution configuration */
  executionConfig: ResolvedExecutionConfig
  
  /** Human-readable match reason for logging/display */
  matchDetails: string
  
  /** Timestamp when routing was resolved */
  timestamp: number
}

/**
 * Input to the Event Tag routing flow
 */
export interface EventTagRoutingInput {
  /** The classified input from NLP */
  classifiedInput: {
    rawText: string
    normalizedText: string
    triggers: string[]
    entities: Array<{ type: string; value: string; start: number; end: number }>
    source: 'inline_chat' | 'ocr' | 'other'
    sourceUrl?: string
    sessionKey?: string
  }
  
  /** All agents in the current session */
  agents: LegacyAgentConfig[]
  
  /** All agent boxes in the current session */
  agentBoxes: Array<{
    id: string
    boxNumber: number
    title?: string
    agentNumber?: number
    enabled?: boolean
    provider?: string
    model?: string
  }>
  
  /** Current page URL for website filtering */
  currentUrl?: string
  
  /** Session key for context */
  sessionKey?: string
}

/**
 * Batch result when routing to multiple agents
 */
export interface EventTagRoutingBatch {
  /** Individual routing results for each matched agent */
  results: EventTagRoutingResult[]
  
  /** Summary of the routing */
  summary: {
    /** Total agents checked */
    totalAgentsChecked: number
    /** Agents with active listeners */
    agentsWithListeners: number
    /** Agents that matched */
    agentsMatched: number
    /** Agents skipped (disabled or no match) */
    agentsSkipped: number
  }
  
  /** The original input text */
  originalInput: string
  
  /** Triggers found in the input */
  triggersFound: string[]
  
  /** Processing time in milliseconds */
  processingTimeMs: number
}




