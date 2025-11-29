# New Listener/Trigger Architecture Design

> This document describes the target architecture for the refactored automation system.

## Design Goals

1. **Separation of Concerns**: Distinct layers for triggers, conditions, reasoning, and actions
2. **Extensibility**: Easy to add new trigger sources (cron, API, etc.)
3. **Testability**: Each component independently testable
4. **Backward Compatibility**: Existing configs continue to work via adapter layer
5. **Type Safety**: Strong TypeScript types throughout

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Trigger Layer                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │   Chat   │ │   DOM    │ │   Cron   │ │   API    │ │ Workflow │      │
│  │ Trigger  │ │ Trigger  │ │ Trigger  │ │ Trigger  │ │ Trigger  │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       │            │            │            │            │             │
│       └────────────┴────────────┴────────────┴────────────┘             │
│                                 │                                        │
│                    ┌────────────▼────────────┐                          │
│                    │    Trigger Registry     │                          │
│                    │  (Normalized Events)    │                          │
│                    └────────────┬────────────┘                          │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────┐
│                        Listener Manager                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Match listeners by source/scope/modalities/tags             │   │
│  │  2. Run sensor workflows (read-only context collection)          │   │
│  │  3. Evaluate conditions (AND/OR logic)                           │   │
│  │  4. Invoke reasoning layer (LLM)                                 │   │
│  │  5. Dispatch to allowed action workflows                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────┐
│                         Workflow Layer                                   │
│  ┌─────────────────────────┐  ┌─────────────────────────┐              │
│  │    Sensor Workflows     │  │    Action Workflows      │              │
│  │  (Read-only context)    │  │  (Side effects)          │              │
│  │  - Page content         │  │  - Send email            │              │
│  │  - API data fetch       │  │  - Call API              │              │
│  │  - Session context      │  │  - Modify DOM            │              │
│  │  - User preferences     │  │  - Store data            │              │
│  └─────────────────────────┘  └─────────────────────────┘              │
└─────────────────────────────────────────────────────────────────────────┘
```

## Module Structure

```
apps/extension-chromium/src/
  automation/
    index.ts                    # Public API exports
    types.ts                    # Core type definitions
    ListenerManager.ts          # Central router/manager
    
    triggers/
      index.ts                  # Trigger exports
      TriggerRegistry.ts        # Trigger registration and normalization
      BaseTrigger.ts            # Abstract base class
      ChatTrigger.ts            # Chat/message input
      DomTrigger.ts             # DOM events (click, mutation, etc.)
      CronTrigger.ts            # Scheduled triggers
      ApiTrigger.ts             # External webhook triggers
      WorkflowTrigger.ts        # Inter-workflow triggers
    
    conditions/
      index.ts                  # Condition exports
      ConditionEngine.ts        # AND/OR/NOT evaluation
      operators.ts              # Comparison operators
    
    workflows/
      index.ts                  # Workflow exports
      WorkflowRunner.ts         # Execution engine
      SensorWorkflow.ts         # Read-only context collection
      ActionWorkflow.ts         # Side-effect execution
      WorkflowRegistry.ts       # Workflow registration
    
    adapters/
      index.ts                  # Adapter exports
      LegacyConfigAdapter.ts    # Old config → new format
```

## Core Types

### Trigger Types

```typescript
/**
 * Event source - where the trigger originates
 */
export type TriggerSource = 
  | 'chat'      // User chat input
  | 'dom'       // DOM events (click, mutation, etc.)
  | 'api'       // External API webhook
  | 'backend'   // Backend service events
  | 'workflow'  // Another workflow completed
  | 'cron'      // Scheduled time-based

/**
 * Trigger scope - what the trigger applies to
 */
export type TriggerScope = 
  | 'global'    // All agents/workflows
  | 'agent'     // Specific agent
  | 'workflow'  // Specific workflow

/**
 * Content modality - type of content
 */
export type Modality = 
  | 'text'
  | 'table'
  | 'diagram'
  | 'image'
  | 'video'
  | 'code'
  | 'math'
  | 'error'
  | 'other'

/**
 * Trigger configuration
 */
export interface TriggerConfig {
  source: TriggerSource
  scope: TriggerScope
  modalities: Modality[]
  
  // Source-specific options
  schedule?: string           // Cron expression (for 'cron')
  pollingInterval?: number    // Milliseconds (for polling)
  webhookPath?: string        // Path for API webhooks
  domSelector?: string        // CSS selector for DOM events
  domEvent?: string           // DOM event type
}
```

### Condition Types

```typescript
/**
 * Comparison operators for field conditions
 */
export type ConditionOperator = 
  | 'eq'        // Equals
  | 'ne'        // Not equals
  | 'contains'  // String contains
  | 'gt'        // Greater than
  | 'lt'        // Less than
  | 'gte'       // Greater than or equal
  | 'lte'       // Less than or equal
  | 'regex'     // Regex match
  | 'exists'    // Field exists
  | 'in'        // Value in array
  | 'nin'       // Value not in array

/**
 * Recursive condition type supporting AND/OR/NOT logic
 */
export type Condition =
  | { all: Condition[] }                                    // AND
  | { any: Condition[] }                                    // OR
  | { not: Condition }                                      // NOT
  | { field: string; op: ConditionOperator; value: any }    // Field comparison

/**
 * Example conditions:
 * 
 * // Simple field check
 * { field: 'input.length', op: 'gt', value: 10 }
 * 
 * // AND logic
 * { all: [
 *   { field: 'source', op: 'eq', value: 'chat' },
 *   { field: 'hasImage', op: 'eq', value: true }
 * ]}
 * 
 * // OR logic
 * { any: [
 *   { field: 'modality', op: 'eq', value: 'image' },
 *   { field: 'modality', op: 'eq', value: 'video' }
 * ]}
 * 
 * // NOT logic
 * { not: { field: 'url', op: 'contains', value: 'admin' } }
 * 
 * // Nested
 * { all: [
 *   { field: 'enabled', op: 'eq', value: true },
 *   { any: [
 *     { field: 'priority', op: 'eq', value: 'high' },
 *     { field: 'urgent', op: 'eq', value: true }
 *   ]}
 * ]}
 */
```

### Automation Config

```typescript
/**
 * Main automation/listener configuration
 */
export interface AutomationConfig {
  id: string
  name: string
  enabled: boolean
  mode: 'active' | 'passive'
  
  // Trigger configuration
  trigger: TriggerConfig
  
  // Pattern matching (legacy support)
  tags?: string[]              // Tag patterns to match
  patterns?: string[]          // @mention patterns
  expectedContext?: string     // Keyword context matching
  website?: string             // URL filter
  
  // Pipeline configuration
  sensorWorkflows: string[]    // IDs of sensor workflows to run
  conditions: Condition | null // Condition tree to evaluate
  reasoningProfile: string     // Agent ID for reasoning
  allowedActions: string[]     // Whitelisted action workflow IDs
  
  // Reporting
  reportTo?: string[]          // Destinations for results
}
```

### Workflow Types

```typescript
/**
 * Workflow step types
 */
export type WorkflowStepType = 
  | 'agent'      // Call an agent
  | 'condition'  // Conditional branching
  | 'loop'       // Loop iteration
  | 'parallel'   // Parallel execution
  | 'wait'       // Wait/delay
  | 'transform'  // Data transformation
  | 'api'        // API call
  | 'store'      // Storage operation

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  id: string
  name: string
  type: 'sensor' | 'action'
  steps: WorkflowStep[]
}

/**
 * Single workflow step
 */
export interface WorkflowStep {
  id: string
  type: WorkflowStepType
  config: Record<string, any>
  nextSteps: string[]
  onError?: string  // Step to run on error
}

/**
 * Workflow execution context
 */
export interface WorkflowContext {
  event: NormalizedEvent
  collectedData: Record<string, any>
  reasoningResult?: any
  errors: Error[]
}
```

### Normalized Event

```typescript
/**
 * Normalized event from any trigger source
 */
export interface NormalizedEvent {
  id: string
  timestamp: number
  source: TriggerSource
  scope: TriggerScope
  modalities: Modality[]
  
  // Content
  input: string
  imageUrl?: string
  videoUrl?: string
  metadata: Record<string, any>
  
  // Context
  url?: string
  tabId?: number
  sessionKey?: string
  agentId?: string
}
```

## Component Details

### TriggerRegistry

Manages trigger sources and normalizes events:

```typescript
class TriggerRegistry {
  // Register a trigger source
  register(source: TriggerSource, handler: TriggerHandler): void
  
  // Unregister a trigger source
  unregister(source: TriggerSource): void
  
  // Emit an event from a trigger
  emit(event: NormalizedEvent): void
  
  // Subscribe to events
  subscribe(callback: (event: NormalizedEvent) => void): () => void
}
```

### ListenerManager

Central router that orchestrates the pipeline:

```typescript
class ListenerManager {
  // Register an automation config
  register(config: AutomationConfig): void
  
  // Unregister by ID
  unregister(id: string): void
  
  // Process an event through the pipeline
  async processEvent(event: NormalizedEvent): Promise<ProcessingResult>
  
  // Get matching listeners for an event
  getMatchingListeners(event: NormalizedEvent): AutomationConfig[]
}
```

### ConditionEngine

Evaluates condition trees:

```typescript
class ConditionEngine {
  // Evaluate a condition against context
  evaluate(condition: Condition, context: Record<string, any>): boolean
  
  // Validate condition structure
  validate(condition: Condition): ValidationResult
}
```

### WorkflowRunner

Executes workflow steps:

```typescript
class WorkflowRunner {
  // Run a sensor workflow (read-only)
  async runSensor(
    workflow: WorkflowDefinition, 
    context: WorkflowContext
  ): Promise<Record<string, any>>
  
  // Run an action workflow (side effects)
  async runAction(
    workflow: WorkflowDefinition, 
    context: WorkflowContext
  ): Promise<ActionResult>
}
```

## Pipeline Flow

### Step-by-Step Processing

1. **Event Arrives** → TriggerRegistry normalizes to `NormalizedEvent`

2. **Listener Matching** → ListenerManager finds configs matching:
   - Source (chat, dom, cron, etc.)
   - Scope (global, agent, workflow)
   - Modalities (text, image, etc.)
   - Tags/patterns

3. **Sensor Workflows** → For each matched listener:
   - Run sensor workflows in order
   - Collect read-only context data
   - Build combined context object

4. **Condition Evaluation** → ConditionEngine evaluates:
   - Condition tree against collected context
   - Skip listener if conditions fail

5. **Reasoning** → Invoke reasoning layer:
   - Use configured agent profile
   - Pass collected context
   - Get reasoning result

6. **Action Dispatch** → For each allowed action:
   - Verify action is whitelisted
   - Run action workflow
   - Collect results

7. **Reporting** → Send results to configured destinations

## Legacy Compatibility

### LegacyConfigAdapter

Converts old `AgentConfig` to new `AutomationConfig`:

```typescript
function adaptLegacyConfig(agent: AgentConfig): AutomationConfig {
  return {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    mode: agent.listening?.passiveEnabled ? 'passive' : 'active',
    
    trigger: {
      source: mapLegacySource(agent.listening?.source),
      scope: 'agent',
      modalities: inferModalities(agent),
    },
    
    tags: agent.listening?.tags,
    patterns: extractPatterns(agent.listening?.passive?.triggers),
    expectedContext: agent.listening?.expectedContext,
    website: agent.listening?.website,
    
    sensorWorkflows: [],  // No sensor workflows in legacy
    conditions: null,      // No conditions in legacy
    reasoningProfile: agent.id,
    allowedActions: agent.execution?.workflows || [],
    reportTo: agent.listening?.reportTo,
  }
}
```

## Cron Trigger Integration

### Schedule Format

Uses standard cron expressions:

```
┌─────────── minute (0-59)
│ ┌───────── hour (0-23)
│ │ ┌─────── day of month (1-31)
│ │ │ ┌───── month (1-12)
│ │ │ │ ┌─── day of week (0-6, 0=Sunday)
│ │ │ │ │
* * * * *
```

### Examples

```typescript
// Every 5 minutes
{ schedule: '*/5 * * * *' }

// Every hour at minute 0
{ schedule: '0 * * * *' }

// Daily at 9 AM
{ schedule: '0 9 * * *' }

// Weekdays at 9 AM
{ schedule: '0 9 * * 1-5' }
```

### CronTrigger Implementation

```typescript
class CronTrigger {
  // Start the scheduler
  start(): void
  
  // Stop the scheduler
  stop(): void
  
  // Add a scheduled job
  schedule(id: string, expression: string, callback: () => void): void
  
  // Remove a scheduled job
  unschedule(id: string): void
}
```

## Testing Strategy

### Unit Tests

1. **ConditionEngine**
   - AND logic (all)
   - OR logic (any)
   - NOT logic
   - Nested conditions
   - All operators
   - Edge cases (empty arrays, null values)

2. **TriggerRegistry**
   - Registration/unregistration
   - Event normalization
   - Subscription management

3. **ListenerManager**
   - Listener matching
   - Pipeline execution
   - Error handling

4. **WorkflowRunner**
   - Sensor workflow execution
   - Action workflow execution
   - Step sequencing

### Integration Tests

1. **End-to-end pipeline**
   - Mock event → sensor → condition → reasoning → action

2. **Legacy adapter**
   - Old config conversion
   - Behavior preservation

## Migration Path

1. **Phase 1**: Add new system alongside existing
2. **Phase 2**: Adapter layer for legacy configs
3. **Phase 3**: Gradual migration of UI
4. **Phase 4**: Deprecation of old interfaces
5. **Phase 5**: Removal of legacy code (future)




