# Current Listener/Trigger Architecture Analysis

> This document analyzes the existing automation/orchestrator system before refactoring.

## Overview

The current system is a Chrome extension-based AI orchestrator that routes user input to specialized agents based on triggers, context matching, and configuration rules.

## Core Files

| File | Purpose |
|------|---------|
| `apps/extension-chromium/src/services/processFlow.ts` | Core routing logic, trigger matching, agent forwarding |
| `apps/extension-chromium/src/types/orchestration.ts` | Type definitions for workflows and templates |
| `apps/extension-chromium/src/sidepanel.tsx` | UI integration, LLM calls, screenshot processing |
| `apps/extension-chromium/src/content-script.tsx` | DOM events, agent configuration overlay |
| `apps/extension-chromium/src/background.ts` | WebSocket communication, message routing |

## Current Data Model

### AgentConfig (processFlow.ts:27-76)

The main agent configuration type with three major sections:

```typescript
interface AgentConfig {
  id: string
  name: string
  key?: string
  icon: string
  enabled: boolean
  number?: number
  capabilities?: string[]
  
  listening?: {
    passiveEnabled?: boolean
    activeEnabled?: boolean
    expectedContext?: string
    tags?: string[]
    source?: string           // "Listen on (type)" - mixed concerns
    website?: string
    passive?: {
      triggers?: Array<{ tag?: { name: string; kind?: string } }>
    }
    active?: {
      triggers?: Array<{ tag?: { name: string; kind?: string } }>
    }
    reportTo?: string[]
  }
  
  reasoning?: {
    applyFor?: string         // '__any__' or specific type
    acceptFrom?: string[]     // Sources to accept input from
    goals?: string
    role?: string
    rules?: string
    custom?: Array<{ key: string; value: string }>
  }
  
  execution?: {
    applyFor?: string
    acceptFrom?: string[]
    specialDestinations?: Array<{ kind: string; agents?: string[] }>
    workflows?: string[]
    executionSections?: Array<{...}>
  }
}
```

### WorkflowStep (orchestration.ts:45-53)

Defined but not fully implemented:

```typescript
interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'condition' | 'loop' | 'parallel' | 'wait'
  agentId?: string
  condition?: string
  nextSteps: string[]
  parameters: Record<string, any>
}
```

## Current Pipeline

### Input Routing Flow

```
User Input → routeInput() → matchInputToAgents() → Agent Match → LLM Processing → Agent Box Output
```

### Key Functions

1. **`routeInput()`** (processFlow.ts:729-811)
   - Entry point for all user input
   - Determines input type (text/image/mixed)
   - Loads agents and agent boxes from session
   - Calls `matchInputToAgents()` for routing

2. **`matchInputToAgents()`** (processFlow.ts:437-582)
   - Iterates through all enabled agents
   - Matches by priority:
     1. Trigger match (`@TriggerName` patterns)
     2. Expected context match (keyword matching)
     3. Website filter (URL pattern)
     4. ApplyFor match (input type matching)
   - Returns list of `AgentMatch` objects

3. **`extractTriggerPatterns()`** (processFlow.ts:387-397)
   - Extracts `@TriggerName` patterns from input
   - Simple regex matching

4. **`wrapInputForAgent()`** (processFlow.ts:817-860)
   - Prepares input with agent's reasoning context
   - Adds role, goals, rules, custom fields

## Current Trigger System

### Passive vs Active Listeners

**Passive Listeners:**
- Background monitoring
- Triggered without explicit user action
- Configured via `listening.passiveEnabled` and `listening.passive.triggers`

**Active Listeners:**
- Require user action (e.g., @mention)
- Configured via `listening.activeEnabled` and `listening.active.triggers`

### Tagged Triggers

Stored screen regions for quick reuse:
- Storage: `chrome.storage.local` with key `'optimando-tagged-triggers'`
- Format: `{ name, at, image, rect, mode }`
- Modes: `'screenshot'` (headless) or `'stream'` (visible)

### "Listen on (type)" Field

Current options in UI dropdown (`L-source`):
- Mixes **source** (where events come from) with **modality** (type of content)
- No clear separation between chat, DOM, API sources
- No support for cron/scheduled triggers

## Pain Points

### 1. Mixed Concerns in "Listen on"

The `listening.source` field conflates:
- **Event source**: chat, DOM, API, backend
- **Content modality**: text, image, table, code
- **Scope**: global, agent-specific, workflow-specific

### 2. No Condition Engine

Current matching is simple:
- Keyword substring matching for `expectedContext`
- Exact @trigger pattern matching
- No AND/OR logic between conditions
- No field-based conditional evaluation

### 3. Workflows Not Implemented

`WorkflowStep` type exists but:
- No workflow execution engine
- No sensor workflows (read-only context collection)
- No action workflows (side effect execution)
- No workflow chaining or composition

### 4. No Cron/Scheduler Support

- All triggers are event-driven
- No time-based scheduling
- No polling mechanisms
- No recurring task support

### 5. No Action Whitelisting

- Agents can theoretically execute any action
- No per-listener action restrictions
- No separation between allowed and disallowed actions

### 6. Tight Coupling

`processFlow.ts` combines:
- Trigger matching
- Context evaluation
- Agent routing
- LLM preparation
- Output routing

## Storage Architecture

### Session-Based Storage

- Sessions stored in `chrome.storage.local` with keys like `session_{timestamp}_{random}`
- Session contains: agents, agentBoxes, displayGrids, metadata
- Active session key stored in `optimando-active-session-key`

### Agent Configuration

Stored in `agent.config.instructions` as JSON string:
- Parsed on load in `loadAgentsFromSession()`
- Contains listening, reasoning, execution sections

## Communication Patterns

### Extension ↔ Electron

- WebSocket connection on `ws://localhost:51247/`
- Message types: `START_SELECTION`, `SELECTION_RESULT`, `SAVE_TRIGGER`, etc.
- Fallback to HTTP API at `http://127.0.0.1:51248/`

### Content Script ↔ Background

- Chrome runtime messaging
- Message types: `CAPTURE_VISIBLE_TAB`, `ELECTRON_START_SELECTION`, etc.

## Recommendations for Refactoring

1. **Separate Trigger Sources**: Create distinct trigger types (chat, dom, api, cron)
2. **Add Condition Engine**: Implement AND/OR logic with field-based conditions
3. **Implement Workflow System**: Create sensor and action workflow runners
4. **Add Cron Support**: Integrate schedule-based triggers
5. **Create ListenerManager**: Central router for all event types
6. **Maintain Backward Compatibility**: Adapter layer for old configs



