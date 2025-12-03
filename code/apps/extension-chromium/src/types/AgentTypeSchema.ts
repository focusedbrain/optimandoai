/**
 * Agent Type Schema - A hierarchical, machine-readable type system for AI Agent configuration
 * 
 * This module defines a Merkle-tree-like structure where:
 * - Root level: Agent metadata and description
 * - Second level: Three main sections (Listener, Reasoning, Execution)
 * - Third level: Individual elements within each section
 * 
 * Each node in the tree contains:
 * - id: Unique identifier for the element
 * - humanLabel: Human-readable display name
 * - machineKey: Machine-readable key for serialization
 * - description: Detailed explanation of the element's purpose
 * - type: The data type (string, boolean, array, object, etc.)
 * - required: Whether the field is mandatory
 * - default: Default value if not specified
 * - children: Nested elements (for complex types)
 * 
 * @version 1.0.0
 * @module AgentTypeSchema
 */

// =============================================================================
// Core Type Definitions
// =============================================================================

export type SchemaDataType = 
  | 'string' 
  | 'number' 
  | 'boolean' 
  | 'array' 
  | 'object' 
  | 'enum' 
  | 'file' 
  | 'trigger' 
  | 'workflow'
  | 'condition'
  | 'destination';

export interface SchemaEnumOption {
  value: string;
  label: string;
  description?: string;
}

export interface SchemaNode {
  /** Unique identifier for this schema node */
  id: string;
  
  /** Human-readable label for display */
  humanLabel: string;
  
  /** Machine-readable key used in serialization */
  machineKey: string;
  
  /** Detailed description of what this element does */
  description: string;
  
  /** Data type of this element */
  type: SchemaDataType;
  
  /** Whether this field is required */
  required: boolean;
  
  /** Default value when not specified */
  default?: any;
  
  /** For enum types, the available options */
  enumOptions?: SchemaEnumOption[];
  
  /** For array/object types, the schema of child elements */
  children?: Record<string, SchemaNode>;
  
  /** For array types, the schema of array items */
  itemSchema?: SchemaNode;
  
  /** Validation constraints */
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    patternDescription?: string;
  };
  
  /** Parent schema node ID (for tree traversal) */
  parentId?: string;
  
  /** Display hints for UI rendering */
  display?: {
    placeholder?: string;
    helpIcon?: boolean;
    collapsible?: boolean;
    hidden?: boolean;
    order?: number;
  };
}

// =============================================================================
// Root Agent Schema
// =============================================================================

export const AgentRootSchema: SchemaNode = {
  id: 'agent',
  humanLabel: 'AI Agent',
  machineKey: 'agent',
  description: 'An AI Agent is a configurable unit that can listen for events, reason about context, and execute actions. Agents combine triggering conditions (Listener), cognitive processing (Reasoning), and output generation (Execution) into a cohesive intelligent workflow.',
  type: 'object',
  required: true,
  children: {},
};

// =============================================================================
// Agent Identity Schema
// =============================================================================

export const AgentIdentitySchema: Record<string, SchemaNode> = {
  id: {
    id: 'agent.id',
    humanLabel: 'Agent ID',
    machineKey: 'id',
    description: 'Unique identifier for this agent. Auto-generated if not provided.',
    type: 'string',
    required: true,
    parentId: 'agent',
    display: { hidden: true },
  },
  
  name: {
    id: 'agent.name',
    humanLabel: 'Name (Command Identifier)',
    machineKey: 'name',
    description: 'The command identifier used to reference this agent. Used in triggers like @agent-name or #agent-name. Should be lowercase with hyphens.',
    type: 'string',
    required: true,
    parentId: 'agent',
    validation: {
      minLength: 1,
      maxLength: 64,
      pattern: '^[a-z0-9-]+$',
      patternDescription: 'Lowercase letters, numbers, and hyphens only',
    },
    display: {
      placeholder: 'e.g., research-agent, summarizer',
      order: 1,
    },
  },
  
  description: {
    id: 'agent.description',
    humanLabel: 'Description',
    machineKey: 'description',
    description: 'A human-readable description of what this agent does, its purpose, and how it should be used. This helps other users and systems understand the agent\'s role.',
    type: 'string',
    required: false,
    parentId: 'agent',
    display: {
      placeholder: 'Describe what this agent does...',
      order: 2,
    },
    validation: {
      maxLength: 500,
    },
  },
  
  icon: {
    id: 'agent.icon',
    humanLabel: 'Icon',
    machineKey: 'icon',
    description: 'An emoji or icon to visually identify this agent in the UI.',
    type: 'string',
    required: false,
    default: '🤖',
    parentId: 'agent',
    display: {
      placeholder: '🤖',
      order: 3,
    },
  },
  
  number: {
    id: 'agent.number',
    humanLabel: 'Agent Number',
    machineKey: 'number',
    description: 'Numeric identifier used to link this agent with Agent Boxes in display grids. Agent 01 matches with boxes where agentNumber=1.',
    type: 'number',
    required: false,
    parentId: 'agent',
    validation: {
      min: 1,
      max: 99,
    },
    display: {
      order: 4,
    },
  },
  
  enabled: {
    id: 'agent.enabled',
    humanLabel: 'Enabled',
    machineKey: 'enabled',
    description: 'Whether this agent is active and can respond to triggers.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent',
    display: {
      order: 5,
    },
  },
  
  capabilities: {
    id: 'agent.capabilities',
    humanLabel: 'Capabilities',
    machineKey: 'capabilities',
    description: 'The enabled sections for this agent. Controls which major sections (Listener, Reasoning, Execution) are active.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent',
    display: {
      order: 6,
    },
  },
};

// =============================================================================
// Listener Section Schema
// =============================================================================

export const ListenerSectionSchema: SchemaNode = {
  id: 'agent.listening',
  humanLabel: 'Listener',
  machineKey: 'listening',
  description: 'The Listener section defines how this agent detects events and triggers. It configures what conditions must be met for the agent to activate, including event tags, channels, conditions, and workflows that gather context before activation.',
  type: 'object',
  required: false,
  parentId: 'agent',
  children: {},
};

export const ListenerElementsSchema: Record<string, SchemaNode> = {
  /**
   * @deprecated v2.1.0 - Use unifiedTriggers to define activation conditions.
   * Kept for UI backward compatibility only.
   */
  passiveEnabled: {
    id: 'agent.listening.passiveEnabled',
    humanLabel: 'Passive Listener (deprecated)',
    machineKey: 'passiveEnabled',
    description: '@deprecated - Use unifiedTriggers instead. This field is ignored in canonical exports.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening',
  },
  
  /**
   * @deprecated v2.1.0 - Use unifiedTriggers to define activation conditions.
   * Kept for UI backward compatibility only.
   */
  activeEnabled: {
    id: 'agent.listening.activeEnabled',
    humanLabel: 'Active Listener (deprecated)',
    machineKey: 'activeEnabled',
    description: '@deprecated - Use unifiedTriggers instead. This field is ignored in canonical exports.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening',
  },
  
  expectedContext: {
    id: 'agent.listening.expectedContext',
    humanLabel: 'Expected Context',
    machineKey: 'expectedContext',
    description: 'Keywords or phrases that describe when this agent should activate. Used for semantic matching when no explicit trigger is present.',
    type: 'string',
    required: false,
    parentId: 'agent.listening',
    display: {
      placeholder: 'e.g., User is asking about research topics',
    },
  },
  
  tags: {
    id: 'agent.listening.tags',
    humanLabel: 'Input Tags',
    machineKey: 'tags',
    description: 'Types of input data this agent can process: dom (page content), screenshot (visual capture), upload (user files).',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening',
  },
  
  source: {
    id: 'agent.listening.source',
    humanLabel: 'Listen On (Source)',
    machineKey: 'source',
    description: 'The primary source type for input events.',
    type: 'enum',
    required: false,
    default: 'all',
    parentId: 'agent.listening',
    enumOptions: [
      { value: 'all', label: 'All Sources', description: 'Listen to all available input sources' },
      { value: 'chat', label: 'Chat', description: 'Direct chat messages' },
      { value: 'dom', label: 'DOM Events', description: 'Page content and DOM interactions' },
      { value: 'agent', label: 'Other Agents', description: 'Output from other agents' },
      { value: 'email', label: 'Email', description: 'Email notifications' },
    ],
  },
  
  website: {
    id: 'agent.listening.website',
    humanLabel: 'Website Filter',
    machineKey: 'website',
    description: 'Restrict activation to specific websites. Supports patterns like "*.example.com" or exact URLs.',
    type: 'string',
    required: false,
    parentId: 'agent.listening',
    display: {
      placeholder: 'e.g., example.com, *.github.com',
    },
  },
  
  unifiedTriggers: {
    id: 'agent.listening.unifiedTriggers',
    humanLabel: 'Triggers',
    machineKey: 'unifiedTriggers',
    description: 'A list of trigger configurations that define how this agent can be activated. Each trigger specifies conditions, channels, and optional workflows.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening',
  },
};

// =============================================================================
// Trigger Schema (nested within Listener)
// =============================================================================

export const TriggerSchema: SchemaNode = {
  id: 'agent.listening.trigger',
  humanLabel: 'Trigger',
  machineKey: 'trigger',
  description: 'A trigger defines the conditions under which this agent activates. Triggers can be based on event tags (#tag), DOM events, manual commands, or workflow signals.',
  type: 'object',
  required: false,
  parentId: 'agent.listening.unifiedTriggers',
  children: {},
};

export const TriggerElementsSchema: Record<string, SchemaNode> = {
  id: {
    id: 'agent.listening.trigger.id',
    humanLabel: 'Trigger ID',
    machineKey: 'id',
    description: 'Unique identifier for this trigger. Auto-generated if not provided.',
    type: 'string',
    required: true,
    parentId: 'agent.listening.trigger',
  },
  
  type: {
    id: 'agent.listening.trigger.type',
    humanLabel: 'Trigger Type',
    machineKey: 'type',
    description: 'The type of event that activates this trigger.',
    type: 'enum',
    required: true,
    default: 'direct_tag',
    parentId: 'agent.listening.trigger',
    enumOptions: [
      { value: 'direct_tag', label: 'Event Tag', description: 'Activate on #hashtag detection' },
      { value: 'tag_and_condition', label: 'Tag + Conditions', description: 'Tag with additional conditions' },
      { value: 'workflow_condition', label: 'Workflow Condition', description: 'Activate based on workflow output' },
      { value: 'dom_event', label: 'DOM Event', description: 'Activate on page element interactions' },
      { value: 'dom_parser', label: 'DOM Parser', description: 'Parse website DOM and check for patterns, keywords, content' },
      { value: 'augmented_overlay', label: 'Augmented Overlay', description: 'Activate from overlay interface' },
      { value: 'manual', label: 'Manual', description: 'Activate via command or button' },
    ],
  },
  
  enabled: {
    id: 'agent.listening.trigger.enabled',
    humanLabel: 'Enabled',
    machineKey: 'enabled',
    description: 'Whether this trigger is active.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening.trigger',
  },
  
  tag: {
    id: 'agent.listening.trigger.tag',
    humanLabel: 'Event Tag',
    machineKey: 'tag',
    description: 'The #hashtag that activates this trigger. Include the # prefix.',
    type: 'string',
    required: false,
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: 'e.g., #research, #summarize',
    },
  },
  
  channel: {
    id: 'agent.listening.trigger.channel',
    humanLabel: 'Channel',
    machineKey: 'channel',
    description: 'The input channel to listen on for this trigger.',
    type: 'enum',
    required: false,
    default: 'chat',
    parentId: 'agent.listening.trigger',
    enumOptions: [
      { value: 'chat', label: 'Chat', description: 'Direct chat messages' },
      { value: 'agent', label: 'Agent', description: 'Output from another agent' },
      { value: 'email', label: 'Email', description: 'Email events' },
      { value: 'miniapp', label: 'Mini App', description: 'Mini application events' },
      { value: 'cron', label: 'Scheduled', description: 'Time-based scheduling' },
    ],
  },
  
  eventTagConditions: {
    id: 'agent.listening.trigger.eventTagConditions',
    humanLabel: 'Event Tag Conditions',
    machineKey: 'eventTagConditions',
    description: 'Additional conditions that must be met alongside the event tag for activation.',
    type: 'array',
    required: false,
    parentId: 'agent.listening.trigger',
  },
  
  sensorWorkflows: {
    id: 'agent.listening.trigger.sensorWorkflows',
    humanLabel: 'Sensor Workflows',
    machineKey: 'sensorWorkflows',
    description: 'Workflows that gather additional context before the agent activates. These run as sensors to enrich the input data.',
    type: 'array',
    required: false,
    parentId: 'agent.listening.trigger',
  },
  
  allowedActions: {
    id: 'agent.listening.trigger.allowedActions',
    humanLabel: 'Allowed Actions',
    machineKey: 'allowedActions',
    description: 'Workflows that define what actions this trigger is permitted to execute.',
    type: 'array',
    required: false,
    parentId: 'agent.listening.trigger',
  },
  
  // ==========================================================================
  // DOM Parser Trigger Configuration
  // Comprehensive settings for parsing AI chat UIs (ChatGPT, Claude, Gemini)
  // ==========================================================================
  
  /** When to trigger the DOM parsing operation */
  parserTrigger: {
    id: 'agent.listening.trigger.parserTrigger',
    humanLabel: 'Parse Trigger',
    machineKey: 'parserTrigger',
    description: 'When to trigger the DOM parsing: on page load, DOM change, interval, button click, or manual.',
    type: 'enum',
    required: false,
    default: 'page_load',
    parentId: 'agent.listening.trigger',
    enumOptions: [
      { value: 'page_load', label: 'On Page Load', description: 'Parse when page loads' },
      { value: 'dom_change', label: 'On DOM Change', description: 'Parse when DOM mutates' },
      { value: 'interval', label: 'On Interval', description: 'Parse at regular intervals' },
      { value: 'button_click', label: 'On Button Click', description: 'Parse when a specific button is clicked' },
      { value: 'manual', label: 'Manual / On Demand', description: 'Parse only when explicitly triggered' },
    ],
  },

  // --- URL / Site Filters ---
  
  /** URL patterns to match (glob patterns converted to regex internally) */
  siteFilters: {
    id: 'agent.listening.trigger.siteFilters',
    humanLabel: 'Site Filters',
    machineKey: 'siteFilters',
    description: 'URL patterns to restrict where this trigger activates. Supports glob patterns like "*.openai.com/*", "https://claude.ai/*". Leave empty to match all sites.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: '*.openai.com/*, https://claude.ai/*, *gemini.google.com/*',
      helpIcon: true,
    },
  },

  // --- Auto-Detection Configuration ---
  
  /** Enable automatic selector discovery */
  autoDetectSelectors: {
    id: 'agent.listening.trigger.autoDetectSelectors',
    humanLabel: 'Auto-Detect Selectors',
    machineKey: 'autoDetectSelectors',
    description: 'Enable automatic discovery of button, input, and output selectors by monitoring user interactions.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },
  
  /** Auto-detected selector results */
  autoDetected: {
    id: 'agent.listening.trigger.autoDetected',
    humanLabel: 'Auto-Detected Selectors',
    machineKey: 'autoDetected',
    description: 'Results from automatic selector detection. Contains button, input, and output selectors discovered via click tracking and DOM observation.',
    type: 'object',
    required: false,
    default: null,
    parentId: 'agent.listening.trigger',
  },
  
  // --- Trigger Source Configuration ---
  
  /** CSS selectors for the submit/send button(s) to monitor */
  buttonSelectors: {
    id: 'agent.listening.trigger.buttonSelectors',
    humanLabel: 'Button Selectors',
    machineKey: 'buttonSelectors',
    description: 'CSS selectors for send/submit buttons. Supports multiple selectors (one per line or comma-separated). First match wins.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: 'button[data-testid="send-button"]\n.send-btn\n#submit-message',
    },
  },
  
  /** Whether to also trigger on Enter key press in the input field */
  triggerOnEnterKey: {
    id: 'agent.listening.trigger.triggerOnEnterKey',
    humanLabel: 'Trigger on Enter Key',
    machineKey: 'triggerOnEnterKey',
    description: 'Also trigger capture when Enter key is pressed in the input field (without Shift). Useful for chat UIs that submit on Enter.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },
  
  /** Require Shift+Enter to NOT trigger (allows Enter to trigger, Shift+Enter for newline) */
  enterKeyIgnoreShift: {
    id: 'agent.listening.trigger.enterKeyIgnoreShift',
    humanLabel: 'Ignore Shift+Enter',
    machineKey: 'enterKeyIgnoreShift',
    description: 'When enabled, Shift+Enter will not trigger capture (allows newlines). Only plain Enter triggers.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening.trigger',
  },

  // --- Input Capture Configuration ---
  
  /** CSS selectors for input/prompt elements */
  inputSelectors: {
    id: 'agent.listening.trigger.inputSelectors',
    humanLabel: 'Input Selectors',
    machineKey: 'inputSelectors',
    description: 'CSS selectors for the input/prompt text area(s). Supports multiple selectors. First match with content wins.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: 'textarea[data-id="root"]\n#prompt-textarea\n.chat-input',
    },
  },
  
  /** Whether to capture the input/prompt content */
  captureInput: {
    id: 'agent.listening.trigger.captureInput',
    humanLabel: 'Capture Input',
    machineKey: 'captureInput',
    description: 'Capture the user\'s question/prompt when the trigger fires.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening.trigger',
  },

  // --- Output/Response Capture Configuration ---
  
  /** CSS selectors for output/response elements */
  outputSelectors: {
    id: 'agent.listening.trigger.outputSelectors',
    humanLabel: 'Output Selectors',
    machineKey: 'outputSelectors',
    description: 'CSS selectors for the AI response container(s). Supports multiple selectors. Last matching element (most recent response) is captured.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: '[data-message-author-role="assistant"]\n.markdown-body\n.response-content',
    },
  },
  
  /** Whether to capture the AI response/output */
  captureOutput: {
    id: 'agent.listening.trigger.captureOutput',
    humanLabel: 'Capture Output',
    machineKey: 'captureOutput',
    description: 'Capture the AI\'s response after it appears. Requires response detection configuration.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },

  // --- Response Detection Configuration ---
  
  /** How to detect when the AI response is ready */
  responseReadyMode: {
    id: 'agent.listening.trigger.responseReadyMode',
    humanLabel: 'Response Ready Mode',
    machineKey: 'responseReadyMode',
    description: 'How to determine when the AI response is complete and ready for capture.',
    type: 'enum',
    required: false,
    default: 'first_change',
    parentId: 'agent.listening.trigger',
    enumOptions: [
      { value: 'first_change', label: 'First Change', description: 'Capture as soon as content appears in output selector' },
      { value: 'quiet_period', label: 'Quiet Period', description: 'Wait until content stops changing for a specified duration' },
      { value: 'selector_signal', label: 'Selector Signal', description: 'Wait for a specific element to appear (e.g., "Copy" button)' },
    ],
  },
  
  /** Milliseconds of no changes before considering response complete (for quiet_period mode) */
  quietPeriodMs: {
    id: 'agent.listening.trigger.quietPeriodMs',
    humanLabel: 'Quiet Period (ms)',
    machineKey: 'quietPeriodMs',
    description: 'Milliseconds to wait with no content changes before capturing. Used with "Quiet Period" mode.',
    type: 'number',
    required: false,
    default: 1500,
    parentId: 'agent.listening.trigger',
    validation: { min: 100, max: 30000 },
  },
  
  /** CSS selector that signals response is complete (for selector_signal mode) */
  responseSignalSelector: {
    id: 'agent.listening.trigger.responseSignalSelector',
    humanLabel: 'Signal Selector',
    machineKey: 'responseSignalSelector',
    description: 'CSS selector for element that appears when response is complete (e.g., copy button, thumbs up/down). Used with "Selector Signal" mode.',
    type: 'string',
    required: false,
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: 'button[aria-label="Copy"], .feedback-buttons',
    },
  },
  
  /** Maximum time to wait for response before giving up */
  maxWaitTimeMs: {
    id: 'agent.listening.trigger.maxWaitTimeMs',
    humanLabel: 'Max Wait Time (ms)',
    machineKey: 'maxWaitTimeMs',
    description: 'Maximum milliseconds to wait for response. Capture proceeds with available content if exceeded.',
    type: 'number',
    required: false,
    default: 60000,
    parentId: 'agent.listening.trigger',
    validation: { min: 1000, max: 300000 },
  },

  // --- Meta Capture Configuration ---
  
  /** Whether to capture the current page URL */
  captureUrl: {
    id: 'agent.listening.trigger.captureUrl',
    humanLabel: 'Capture URL',
    machineKey: 'captureUrl',
    description: 'Include the current page URL in the captured data.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening.trigger',
  },
  
  /** Whether to capture the page title */
  capturePageTitle: {
    id: 'agent.listening.trigger.capturePageTitle',
    humanLabel: 'Capture Page Title',
    machineKey: 'capturePageTitle',
    description: 'Include the page title in the captured data.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },
  
  /** Additional selectors for extra context capture */
  metaSelectors: {
    id: 'agent.listening.trigger.metaSelectors',
    humanLabel: 'Meta Selectors',
    machineKey: 'metaSelectors',
    description: 'Additional CSS selectors for capturing extra context (e.g., conversation ID, model name, system prompt indicators).',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.listening.trigger',
    display: {
      placeholder: '[data-conversation-id]\n.model-selector\n.system-prompt-indicator',
    },
  },

  // --- Sanitization Options ---
  
  /** Trim whitespace from captured text */
  sanitizeTrim: {
    id: 'agent.listening.trigger.sanitizeTrim',
    humanLabel: 'Trim Whitespace',
    machineKey: 'sanitizeTrim',
    description: 'Remove leading and trailing whitespace from captured text.',
    type: 'boolean',
    required: false,
    default: true,
    parentId: 'agent.listening.trigger',
  },
  
  /** Strip markdown formatting from captured text */
  sanitizeStripMarkdown: {
    id: 'agent.listening.trigger.sanitizeStripMarkdown',
    humanLabel: 'Strip Markdown',
    machineKey: 'sanitizeStripMarkdown',
    description: 'Remove markdown formatting (headers, bold, italic, code blocks) from captured text.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },
  
  /** Remove common boilerplate text */
  sanitizeRemoveBoilerplate: {
    id: 'agent.listening.trigger.sanitizeRemoveBoilerplate',
    humanLabel: 'Remove Boilerplate',
    machineKey: 'sanitizeRemoveBoilerplate',
    description: 'Attempt to remove common boilerplate (disclaimers, "As an AI...", etc.) from captured response.',
    type: 'boolean',
    required: false,
    default: false,
    parentId: 'agent.listening.trigger',
  },

  // --- Legacy Fields (backward compatibility) ---
  
  /** @deprecated Use buttonSelectors instead */
  buttonSelector: {
    id: 'agent.listening.trigger.buttonSelector',
    humanLabel: 'Button Selector (Legacy)',
    machineKey: 'buttonSelector',
    description: '[Deprecated] Use buttonSelectors instead. Single CSS selector for the button.',
    type: 'string',
    required: false,
    parentId: 'agent.listening.trigger',
    display: { hidden: true },
  },
  
  /** @deprecated Use inputSelectors instead */
  inputSelector: {
    id: 'agent.listening.trigger.inputSelector',
    humanLabel: 'Input Selector (Legacy)',
    machineKey: 'inputSelector',
    description: '[Deprecated] Use inputSelectors instead. Single CSS selector for input.',
    type: 'string',
    required: false,
    parentId: 'agent.listening.trigger',
    display: { hidden: true },
  },
  
  /** @deprecated Use outputSelectors instead */
  outputSelector: {
    id: 'agent.listening.trigger.outputSelector',
    humanLabel: 'Output Selector (Legacy)',
    machineKey: 'outputSelector',
    description: '[Deprecated] Use outputSelectors instead. Single CSS selector for output.',
    type: 'string',
    required: false,
    parentId: 'agent.listening.trigger',
    display: { hidden: true },
  },
  
  /** @deprecated Use responseReadyMode instead */
  outputWaitMethod: {
    id: 'agent.listening.trigger.outputWaitMethod',
    humanLabel: 'Output Wait Method (Legacy)',
    machineKey: 'outputWaitMethod',
    description: '[Deprecated] Use responseReadyMode instead.',
    type: 'enum',
    required: false,
    default: 'mutation',
    parentId: 'agent.listening.trigger',
    enumOptions: [
      { value: 'mutation', label: 'DOM Mutation', description: 'Auto-detect content changes' },
      { value: 'delay', label: 'Fixed Delay', description: 'Wait fixed time' },
      { value: 'polling', label: 'Poll Until Stable', description: 'Poll for stability' },
    ],
    display: { hidden: true },
  },
  
  /** @deprecated Use quietPeriodMs or maxWaitTimeMs instead */
  outputWaitDelay: {
    id: 'agent.listening.trigger.outputWaitDelay',
    humanLabel: 'Output Wait Delay (Legacy)',
    machineKey: 'outputWaitDelay',
    description: '[Deprecated] Use quietPeriodMs or maxWaitTimeMs instead.',
    type: 'number',
    required: false,
    default: 3000,
    parentId: 'agent.listening.trigger',
    display: { hidden: true },
  },
};

// =============================================================================
// Reasoning Section Schema
// =============================================================================

export const ReasoningSectionSchema: SchemaNode = {
  id: 'agent.reasoning',
  humanLabel: 'Reasoning',
  machineKey: 'reasoning',
  description: 'The Reasoning section configures how the agent processes and thinks about input. It defines the agent\'s goals, role, rules, memory access, and any workflows that should run to gather additional context before the main reasoning process.',
  type: 'object',
  required: false,
  parentId: 'agent',
  children: {},
};

export const ReasoningElementsSchema: Record<string, SchemaNode> = {
  applyFor: {
    id: 'agent.reasoning.applyFor',
    humanLabel: 'Apply For',
    machineKey: 'applyFor',
    description: 'Which triggers this reasoning section applies to. Use "__any__" for all triggers or select specific trigger IDs.',
    type: 'enum',
    required: false,
    default: '__any__',
    parentId: 'agent.reasoning',
  },
  
  applyForList: {
    id: 'agent.reasoning.applyForList',
    humanLabel: 'Apply For (Multiple)',
    machineKey: 'applyForList',
    description: 'List of triggers this reasoning section applies to. Allows selecting multiple triggers.',
    type: 'array',
    required: false,
    default: ['__any__'],
    parentId: 'agent.reasoning',
  },
  
  goals: {
    id: 'agent.reasoning.goals',
    humanLabel: 'Goals (System Instructions)',
    machineKey: 'goals',
    description: 'The main system instructions that guide this agent\'s behavior. Define what the agent should accomplish, how it should think, and what output format to use.',
    type: 'string',
    required: false,
    parentId: 'agent.reasoning',
    display: {
      placeholder: 'You are an expert at... Analyze the input and...',
      helpIcon: true,
    },
  },
  
  role: {
    id: 'agent.reasoning.role',
    humanLabel: 'Role',
    machineKey: 'role',
    description: 'A concise role description that sets the agent\'s persona. E.g., "Research Assistant", "Code Reviewer", "Writing Coach".',
    type: 'string',
    required: false,
    parentId: 'agent.reasoning',
    display: {
      placeholder: 'e.g., Research Assistant, Code Reviewer',
    },
  },
  
  rules: {
    id: 'agent.reasoning.rules',
    humanLabel: 'Rules',
    machineKey: 'rules',
    description: 'Explicit rules and constraints the agent must follow. These are treated as hard requirements.',
    type: 'string',
    required: false,
    parentId: 'agent.reasoning',
    display: {
      placeholder: 'Always cite sources. Never make up facts...',
    },
  },
  
  custom: {
    id: 'agent.reasoning.custom',
    humanLabel: 'Custom Fields',
    machineKey: 'custom',
    description: 'Key-value pairs for additional configuration. Useful for domain-specific settings.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.reasoning',
  },
  
  acceptFrom: {
    id: 'agent.reasoning.acceptFrom',
    humanLabel: 'Accept From (Listen From)',
    machineKey: 'acceptFrom',
    description: 'Sources this agent accepts input from. Filter input to only process from specific agents, workflows, or tools.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.reasoning',
  },
  
  memoryContext: {
    id: 'agent.reasoning.memoryContext',
    humanLabel: 'Memory & Context',
    machineKey: 'memoryContext',
    description: 'Configuration for which memory sources the agent can access during reasoning.',
    type: 'object',
    required: false,
    parentId: 'agent.reasoning',
  },
  
  reasoningWorkflows: {
    id: 'agent.reasoning.reasoningWorkflows',
    humanLabel: 'Reasoning Workflows',
    machineKey: 'reasoningWorkflows',
    description: 'Optional workflows that run before the main reasoning process to gather additional context.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.reasoning',
  },
};

// =============================================================================
// Memory Context Schema (nested within Reasoning)
// =============================================================================

export const MemoryContextSchema: Record<string, SchemaNode> = {
  sessionContext: {
    id: 'agent.reasoning.memoryContext.sessionContext',
    humanLabel: 'Session Context',
    machineKey: 'sessionContext',
    description: 'Configuration for session-level memory (persists within current session).',
    type: 'object',
    required: false,
    parentId: 'agent.reasoning.memoryContext',
    children: {
      read: {
        id: 'agent.reasoning.memoryContext.sessionContext.read',
        humanLabel: 'Read',
        machineKey: 'read',
        description: 'Allow reading from session memory.',
        type: 'boolean',
        required: false,
        default: true,
        parentId: 'agent.reasoning.memoryContext.sessionContext',
      },
      write: {
        id: 'agent.reasoning.memoryContext.sessionContext.write',
        humanLabel: 'Write',
        machineKey: 'write',
        description: 'Allow writing to session memory.',
        type: 'boolean',
        required: false,
        default: true,
        parentId: 'agent.reasoning.memoryContext.sessionContext',
      },
    },
  },
  
  accountMemory: {
    id: 'agent.reasoning.memoryContext.accountMemory',
    humanLabel: 'Account Memory',
    machineKey: 'accountMemory',
    description: 'Configuration for account-level memory (persists across sessions).',
    type: 'object',
    required: false,
    parentId: 'agent.reasoning.memoryContext',
    children: {
      read: {
        id: 'agent.reasoning.memoryContext.accountMemory.read',
        humanLabel: 'Read',
        machineKey: 'read',
        description: 'Allow reading from account memory.',
        type: 'boolean',
        required: false,
        default: false,
        parentId: 'agent.reasoning.memoryContext.accountMemory',
      },
      write: {
        id: 'agent.reasoning.memoryContext.accountMemory.write',
        humanLabel: 'Write',
        machineKey: 'write',
        description: 'Allow writing to account memory.',
        type: 'boolean',
        required: false,
        default: false,
        parentId: 'agent.reasoning.memoryContext.accountMemory',
      },
    },
  },
  
  agentMemory: {
    id: 'agent.reasoning.memoryContext.agentMemory',
    humanLabel: 'Agent Memory',
    machineKey: 'agentMemory',
    description: 'Agent-specific memory that persists for this agent only.',
    type: 'object',
    required: false,
    parentId: 'agent.reasoning.memoryContext',
    children: {
      enabled: {
        id: 'agent.reasoning.memoryContext.agentMemory.enabled',
        humanLabel: 'Enabled',
        machineKey: 'enabled',
        description: 'Enable agent-specific memory.',
        type: 'boolean',
        required: false,
        default: true,
        parentId: 'agent.reasoning.memoryContext.agentMemory',
      },
    },
  },
};

// =============================================================================
// Execution Section Schema
// =============================================================================

export const ExecutionSectionSchema: SchemaNode = {
  id: 'agent.execution',
  humanLabel: 'Execution',
  machineKey: 'execution',
  description: 'The Execution section configures how the agent delivers its output and what actions it can take. It defines output destinations (Agent Boxes, other agents, workflows), execution mode, and any external workflows to call.',
  type: 'object',
  required: false,
  parentId: 'agent',
  children: {},
};

export const ExecutionElementsSchema: Record<string, SchemaNode> = {
  applyFor: {
    id: 'agent.execution.applyFor',
    humanLabel: 'Apply For',
    machineKey: 'applyFor',
    description: 'Which triggers this execution section applies to. Use "__any__" for all triggers or select specific trigger IDs.',
    type: 'enum',
    required: false,
    default: '__any__',
    parentId: 'agent.execution',
  },
  
  applyForList: {
    id: 'agent.execution.applyForList',
    humanLabel: 'Apply For (Multiple)',
    machineKey: 'applyForList',
    description: 'List of triggers this execution section applies to. Allows selecting multiple triggers.',
    type: 'array',
    required: false,
    default: ['__any__'],
    parentId: 'agent.execution',
  },
  
  executionMode: {
    id: 'agent.execution.executionMode',
    humanLabel: 'Execution Mode',
    machineKey: 'executionMode',
    description: 'Controls how output is generated: agent response only, agent + workflows, or workflows only.',
    type: 'enum',
    required: false,
    default: 'agent_workflow',
    parentId: 'agent.execution',
    enumOptions: [
      { value: 'agent_only', label: 'Agent response only', description: 'Returns output from Agent Box only' },
      { value: 'agent_workflow', label: 'Agent response + workflows', description: 'Calls both Agent Box and external workflows' },
      { value: 'workflow_only', label: 'Workflows only', description: 'Calls external workflows without Agent Box response' },
    ],
  },
  
  specialDestinations: {
    id: 'agent.execution.specialDestinations',
    humanLabel: 'Report To',
    machineKey: 'specialDestinations',
    description: 'Output destinations for this agent. Can include Agent Boxes, other agents, or workflows.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.execution',
  },
  
  workflows: {
    id: 'agent.execution.workflows',
    humanLabel: 'Workflows (Legacy)',
    machineKey: 'workflows',
    description: 'Legacy format: List of workflow IDs to execute. Use executionWorkflows for new configurations.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.execution',
  },
  
  executionWorkflows: {
    id: 'agent.execution.executionWorkflows',
    humanLabel: 'Execution Workflows',
    machineKey: 'executionWorkflows',
    description: 'Workflows to execute as part of the agent\'s output. Each workflow can have conditions for when it runs.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.execution',
  },
  
  executionSections: {
    id: 'agent.execution.executionSections',
    humanLabel: 'Additional Execution Sections',
    machineKey: 'executionSections',
    description: 'Additional execution sections for different triggers. Each section can have its own destinations and workflows.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'agent.execution',
  },
};

// =============================================================================
// Workflow Schema (used in multiple sections)
// =============================================================================

export const WorkflowSchema: SchemaNode = {
  id: 'workflow',
  humanLabel: 'Workflow',
  machineKey: 'workflow',
  description: 'A workflow definition that can be executed by triggers, reasoning, or execution sections. Workflows can be internal (parser) or external (API call).',
  type: 'object',
  required: false,
  children: {},
};

export const WorkflowElementsSchema: Record<string, SchemaNode> = {
  type: {
    id: 'workflow.type',
    humanLabel: 'Type',
    machineKey: 'type',
    description: 'Whether this is an internal parser or external API workflow.',
    type: 'enum',
    required: true,
    default: 'external',
    parentId: 'workflow',
    enumOptions: [
      { value: 'internal', label: 'Internal Parser', description: 'Built-in parsing workflow' },
      { value: 'external', label: 'External Workflow', description: 'External API workflow' },
    ],
  },
  
  workflowId: {
    id: 'workflow.workflowId',
    humanLabel: 'Workflow ID',
    machineKey: 'workflowId',
    description: 'Unique identifier or name of the workflow to execute.',
    type: 'string',
    required: true,
    parentId: 'workflow',
    display: {
      placeholder: 'e.g., extract-entities, send-email',
    },
  },
  
  runWhenType: {
    id: 'workflow.runWhenType',
    humanLabel: 'Run When',
    machineKey: 'runWhenType',
    description: 'Condition type that determines when this workflow runs.',
    type: 'enum',
    required: false,
    default: 'always',
    parentId: 'workflow',
    enumOptions: [
      { value: 'always', label: 'Always', description: 'Run on every invocation' },
      { value: 'boolean', label: 'Boolean Condition', description: 'Run based on field value conditions' },
      { value: 'tag', label: 'Tag Detected', description: 'Run when specific tag is present' },
      { value: 'signal', label: 'Workflow Signal', description: 'Run when signal is emitted' },
    ],
  },
  
  conditions: {
    id: 'workflow.conditions',
    humanLabel: 'Conditions',
    machineKey: 'conditions',
    description: 'Conditions that must be met for this workflow to execute.',
    type: 'array',
    required: false,
    default: [],
    parentId: 'workflow',
  },
};

// =============================================================================
// Condition Schema
// =============================================================================

export const ConditionSchema: SchemaNode = {
  id: 'condition',
  humanLabel: 'Condition',
  machineKey: 'condition',
  description: 'A condition that evaluates input or context to make routing decisions.',
  type: 'object',
  required: false,
  children: {},
};

export const ConditionElementsSchema: Record<string, SchemaNode> = {
  conditionType: {
    id: 'condition.conditionType',
    humanLabel: 'Condition Type',
    machineKey: 'conditionType',
    description: 'The type of condition check to perform.',
    type: 'enum',
    required: false,
    default: 'boolean',
    parentId: 'condition',
    enumOptions: [
      { value: 'boolean', label: 'Boolean', description: 'Compare field value' },
      { value: 'tag', label: 'Tag', description: 'Check for tag presence' },
      { value: 'signal', label: 'Signal', description: 'Check for signal' },
    ],
  },
  
  field: {
    id: 'condition.field',
    humanLabel: 'Field',
    machineKey: 'field',
    description: 'The field path to evaluate (for boolean conditions).',
    type: 'string',
    required: false,
    parentId: 'condition',
    display: {
      placeholder: 'e.g., input.action_type, output.success',
    },
  },
  
  op: {
    id: 'condition.op',
    humanLabel: 'Operator',
    machineKey: 'op',
    description: 'The comparison operator to use.',
    type: 'enum',
    required: false,
    default: 'eq',
    parentId: 'condition',
    enumOptions: [
      { value: 'eq', label: 'equals', description: 'Exact match' },
      { value: 'ne', label: 'not equals', description: 'Not equal' },
      { value: 'contains', label: 'contains', description: 'Contains substring' },
      { value: 'startsWith', label: 'starts with', description: 'Starts with prefix' },
      { value: 'endsWith', label: 'ends with', description: 'Ends with suffix' },
      { value: 'matches', label: 'matches regex', description: 'Regex match' },
      { value: 'gt', label: '> (greater)', description: 'Number greater than' },
      { value: 'gte', label: '>= (greater or equal)', description: 'Number greater or equal' },
      { value: 'lt', label: '< (less)', description: 'Number less than' },
      { value: 'lte', label: '<= (less or equal)', description: 'Number less or equal' },
      { value: 'isTrue', label: 'is true', description: 'Boolean true' },
      { value: 'isFalse', label: 'is false', description: 'Boolean false' },
      { value: 'exists', label: 'exists', description: 'Field exists' },
    ],
  },
  
  value: {
    id: 'condition.value',
    humanLabel: 'Value',
    machineKey: 'value',
    description: 'The value to compare against.',
    type: 'string',
    required: false,
    parentId: 'condition',
  },
  
  tag: {
    id: 'condition.tag',
    humanLabel: 'Tag',
    machineKey: 'tag',
    description: 'The tag to check for (for tag conditions).',
    type: 'string',
    required: false,
    parentId: 'condition',
    display: {
      placeholder: 'e.g., #create_chart',
    },
  },
  
  signal: {
    id: 'condition.signal',
    humanLabel: 'Signal',
    machineKey: 'signal',
    description: 'The signal name to check for (for signal conditions).',
    type: 'string',
    required: false,
    parentId: 'condition',
    display: {
      placeholder: 'e.g., chart.ready',
    },
  },
  
  action: {
    id: 'condition.action',
    humanLabel: 'Action',
    machineKey: 'action',
    description: 'What to do when this condition matches.',
    type: 'enum',
    required: false,
    default: 'execute',
    parentId: 'condition',
    enumOptions: [
      { value: 'execute', label: 'Execute', description: 'Continue with execution' },
      { value: 'skip', label: 'Skip', description: 'Skip this workflow' },
      { value: 'route', label: 'Route to...', description: 'Route to another workflow' },
    ],
  },
};

// =============================================================================
// Complete Agent Schema Tree (for export)
// =============================================================================

export const CompleteAgentSchema = {
  root: AgentRootSchema,
  identity: AgentIdentitySchema,
  listener: {
    section: ListenerSectionSchema,
    elements: ListenerElementsSchema,
    trigger: {
      schema: TriggerSchema,
      elements: TriggerElementsSchema,
    },
  },
  reasoning: {
    section: ReasoningSectionSchema,
    elements: ReasoningElementsSchema,
    memoryContext: MemoryContextSchema,
  },
  execution: {
    section: ExecutionSectionSchema,
    elements: ExecutionElementsSchema,
  },
  workflow: {
    schema: WorkflowSchema,
    elements: WorkflowElementsSchema,
  },
  condition: {
    schema: ConditionSchema,
    elements: ConditionElementsSchema,
  },
};

// =============================================================================
// Schema Utility Functions
// =============================================================================

/**
 * Get all schema nodes as a flat map for quick lookup
 */
export function getSchemaNodeMap(): Map<string, SchemaNode> {
  const map = new Map<string, SchemaNode>();
  
  const addNodes = (nodes: Record<string, SchemaNode>) => {
    Object.values(nodes).forEach(node => {
      map.set(node.id, node);
      if (node.children) {
        addNodes(node.children);
      }
    });
  };
  
  map.set(AgentRootSchema.id, AgentRootSchema);
  addNodes(AgentIdentitySchema);
  map.set(ListenerSectionSchema.id, ListenerSectionSchema);
  addNodes(ListenerElementsSchema);
  map.set(TriggerSchema.id, TriggerSchema);
  addNodes(TriggerElementsSchema);
  map.set(ReasoningSectionSchema.id, ReasoningSectionSchema);
  addNodes(ReasoningElementsSchema);
  addNodes(MemoryContextSchema);
  map.set(ExecutionSectionSchema.id, ExecutionSectionSchema);
  addNodes(ExecutionElementsSchema);
  map.set(WorkflowSchema.id, WorkflowSchema);
  addNodes(WorkflowElementsSchema);
  map.set(ConditionSchema.id, ConditionSchema);
  addNodes(ConditionElementsSchema);
  
  return map;
}

/**
 * Get the description for a schema node by its ID
 */
export function getSchemaDescription(nodeId: string): string | undefined {
  const map = getSchemaNodeMap();
  return map.get(nodeId)?.description;
}

/**
 * Get the human label for a schema node by its ID
 */
export function getSchemaLabel(nodeId: string): string | undefined {
  const map = getSchemaNodeMap();
  return map.get(nodeId)?.humanLabel;
}

/**
 * Build a schema hash (for Merkle-tree-like integrity checking)
 */
export function computeSchemaHash(schema: SchemaNode): string {
  const content = JSON.stringify({
    id: schema.id,
    type: schema.type,
    children: schema.children ? Object.keys(schema.children).sort() : [],
  });
  
  // Simple hash for demonstration - in production use a proper hash function
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16).padStart(8, '0');
}

// Export schema version for compatibility tracking
export const SCHEMA_VERSION = '1.0.0';

