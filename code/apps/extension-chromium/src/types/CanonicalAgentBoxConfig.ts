/**
 * Canonical Agent Box Configuration
 * 
 * This module defines the TypeScript interfaces for Agent Box configurations.
 * Agent Boxes are UI containers that display output from allocated agents.
 * 
 * CRITICAL CONNECTION LOGIC:
 * An Agent Box connects to an Agent when:
 * 1. Agent's "number" field equals AgentBox's "agentNumber"
 * 2. Agent has destinations with kind: "agentBox" 
 * 3. The AgentBox exists in the current session
 * 
 * Example:
 * - Agent with number: 5 and destinations: [{kind: 'agentBox'}]
 * - AgentBox with agentNumber: 5 and enabled: true
 * → The agent's output will route to this AgentBox
 * 
 * Schema: /schemas/agentbox.schema.json is the canonical JSON Schema.
 * 
 * @version 1.0.0
 * @module CanonicalAgentBoxConfig
 */

// =============================================================================
// Enums
// =============================================================================

/** Valid LLM providers for Agent Boxes */
export const AgentBoxProviderValues = [
  '',          // Use default/fallback
  'OpenAI',
  'Claude',
  'Gemini',
  'Grok',
  'Local AI',
  'Image AI'
] as const;
export type AgentBoxProvider = typeof AgentBoxProviderValues[number];

/** Where the agent box was created */
export const AgentBoxSourceValues = [
  'master_tab',
  'display_grid'
] as const;
export type AgentBoxSource = typeof AgentBoxSourceValues[number];

/** Side placement for hybrid master tabs */
export const AgentBoxSideValues = [
  'left',
  'right'
] as const;
export type AgentBoxSide = typeof AgentBoxSideValues[number];

// =============================================================================
// Main Interface
// =============================================================================

/**
 * Canonical Agent Box configuration - the primary export format for agent boxes.
 * 
 * Agent Boxes serve as output displays for agents. The connection between an
 * Agent and an Agent Box is established through the agentNumber field:
 * - If agent.number === agentBox.agentNumber, output routes to this box
 * - Multiple boxes can share the same agentNumber (multi-display)
 * - Each box has a unique boxNumber for identification
 */
export interface CanonicalAgentBoxConfig {
  /** Schema version for compatibility */
  _schemaVersion: '1.0.0';
  
  /** Export timestamp (ISO format) */
  _exportedAt?: string;
  
  /** Source application that exported this config */
  _source?: string;
  
  /** Helper text for LLMs understanding this config */
  _helper?: string;

  // ─────────────────────────────────────────────────────────────────────────
  // Core Identity
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Unique identifier for this agent box instance */
  id: string;
  
  /** 
   * Sequential box number (1-99). Auto-incremented when creating boxes.
   * Used for ordering and identifier generation.
   */
  boxNumber: number;
  
  /**
   * Agent number this box is allocated to (1-99).
   * CRITICAL: Links to Agent - when agent.number === agentNumber, output routes here.
   */
  agentNumber: number;
  
  /**
   * Human-readable identifier in format 'ABxxyy'
   * - xx = boxNumber (padded to 2 digits)
   * - yy = agentNumber (padded to 2 digits)
   * Example: 'AB0105' = Box 1 allocated to Agent 5
   */
  identifier: string;
  
  /** Agent reference string derived from agentNumber (e.g., 'agent5') */
  agentId: string;
  
  /** Display title shown in the box header */
  title: string;
  
  /** Hex color for box accent/border (e.g., '#4CAF50') */
  color: string;
  
  /** Whether this box is active and should receive agent output */
  enabled: boolean;

  // ─────────────────────────────────────────────────────────────────────────
  // LLM Configuration (optional - falls back to agent/global settings)
  // ─────────────────────────────────────────────────────────────────────────
  
  /** 
   * LLM provider to use for this box specifically.
   * If empty/unset, uses the allocated agent's model or global default.
   */
  provider?: AgentBoxProvider;
  
  /** Specific model within the provider (e.g., 'gpt-4o', 'auto') */
  model?: string;
  
  /** Mini apps/tools attached to this box */
  tools?: string[];

  // ─────────────────────────────────────────────────────────────────────────
  // Location & Placement
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Where this box was created: 'master_tab' or 'display_grid' */
  source?: AgentBoxSource;
  
  /** Master Tab ID this box belongs to ('01', '02', etc.) */
  masterTabId?: string;
  
  /** Tab index for positioning (1 = main, 2+ = hybrid tabs) */
  tabIndex?: number;
  
  /** Side placement for hybrid master tabs ('left' or 'right') */
  side?: AgentBoxSide;
  
  /** URL of the tab where this box was created */
  tabUrl?: string;

  // ─────────────────────────────────────────────────────────────────────────
  // Display Grid Fields (only for source === 'display_grid')
  // ─────────────────────────────────────────────────────────────────────────
  
  /** Grid slot identifier for display grid boxes */
  slotId?: string;
  
  /** Display grid session ID */
  gridSessionId?: string;
  
  /** Human-readable location identifier */
  locationId?: string;
  
  /** Display label for the location */
  locationLabel?: string;

  // ─────────────────────────────────────────────────────────────────────────
  // Internal/Auto-generated
  // ─────────────────────────────────────────────────────────────────────────
  
  /** DOM element ID for output container */
  outputId?: string;
  
  /** @deprecated Use boxNumber instead */
  number?: number;
}

// =============================================================================
// Combined Export Format
// =============================================================================

/**
 * Combined export format when exporting an agent with its connected agent boxes.
 * This allows recreating the complete agent setup including output routing.
 */
export interface AgentWithBoxesExport {
  /** Export format version */
  _exportVersion: '1.0.0';
  
  /** Export timestamp */
  _exportedAt: string;
  
  /** Source application */
  _source: string;
  
  /**
   * Helper text explaining this combined export format.
   * Useful for LLMs to understand the relationship.
   */
  _helper: string;
  
  /** The agent configuration */
  agent: any; // CanonicalAgentConfig from CanonicalAgentConfig.ts
  
  /**
   * Connected agent boxes (where agentBox.agentNumber === agent.number
   * AND the agent has destinations with kind: 'agentBox')
   */
  connectedAgentBoxes: CanonicalAgentBoxConfig[];
  
  /**
   * Connection metadata explaining why these boxes are connected
   */
  connectionInfo: {
    /** The agent's number that links to boxes */
    agentNumber: number;
    
    /** How many boxes are connected */
    connectedBoxCount: number;
    
    /** Whether the agent has agentBox destinations configured */
    hasAgentBoxDestination: boolean;
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Normalize a raw agent box object to canonical format
 */
export function toCanonicalAgentBox(raw: any): CanonicalAgentBoxConfig {
  const boxNumber = typeof raw.boxNumber === 'number' ? raw.boxNumber : 
                    typeof raw.number === 'number' ? raw.number : 1;
  const agentNumber = typeof raw.agentNumber === 'number' ? raw.agentNumber : boxNumber;
  
  return {
    _schemaVersion: '1.0.0',
    _exportedAt: new Date().toISOString(),
    _source: 'optimando-extension',
    
    id: raw.id || `box-${Date.now()}`,
    boxNumber,
    agentNumber,
    identifier: raw.identifier || `AB${String(boxNumber).padStart(2, '0')}${String(agentNumber).padStart(2, '0')}`,
    agentId: raw.agentId || `agent${agentNumber}`,
    title: raw.title || `Agent Box ${String(boxNumber).padStart(2, '0')}`,
    color: raw.color || '#4CAF50',
    enabled: raw.enabled !== false,
    
    provider: raw.provider || '',
    model: raw.model || 'auto',
    tools: Array.isArray(raw.tools) ? raw.tools : [],
    
    source: raw.source || 'master_tab',
    masterTabId: raw.masterTabId || '01',
    tabIndex: typeof raw.tabIndex === 'number' ? raw.tabIndex : 1,
    side: raw.side || undefined,
    tabUrl: raw.tabUrl || undefined,
    
    slotId: raw.slotId || undefined,
    gridSessionId: raw.gridSessionId || undefined,
    locationId: raw.locationId || undefined,
    locationLabel: raw.locationLabel || undefined,
    
    outputId: raw.outputId || `${raw.id}-output`,
  };
}

/**
 * Generate the identifier string for an agent box
 */
export function generateAgentBoxIdentifier(boxNumber: number, agentNumber: number): string {
  return `AB${String(boxNumber).padStart(2, '0')}${String(agentNumber).padStart(2, '0')}`;
}

/**
 * Check if an agent box is connected to an agent based on the connection rules:
 * 1. Agent's number matches AgentBox's agentNumber
 * 2. Agent has destinations with kind: 'agentBox'
 * 3. AgentBox is enabled
 */
export function isAgentBoxConnectedToAgent(
  agentBox: CanonicalAgentBoxConfig,
  agentNumber: number,
  hasAgentBoxDestination: boolean
): boolean {
  return (
    agentBox.agentNumber === agentNumber &&
    agentBox.enabled &&
    hasAgentBoxDestination
  );
}

/**
 * Find all connected agent boxes from a list based on agent configuration
 */
export function findConnectedAgentBoxes(
  allBoxes: any[],
  agentNumber: number,
  destinations: any[]
): CanonicalAgentBoxConfig[] {
  // Check if agent has agentBox destination
  const hasAgentBoxDestination = destinations?.some(
    (d: any) => d.kind === 'agentBox'
  ) ?? false;
  
  if (!hasAgentBoxDestination || !agentNumber) {
    return [];
  }
  
  return allBoxes
    .filter((box: any) => box.agentNumber === agentNumber && box.enabled !== false)
    .map((box: any) => toCanonicalAgentBox(box));
}

