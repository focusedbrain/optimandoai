/**
 * TypeSystemService - Lazy-loaded, cached type system for Optimando AI
 * 
 * This service provides async access to schemas and canonical conversion functions.
 * Schemas are created lazily on first access and cached for subsequent use.
 * 
 * Benefits:
 * - Schemas not loaded until needed (faster initial form load)
 * - Cached after first use (subsequent exports are fast)
 * - Conversion functions are reusable
 * - Easy to extend with Web Worker support later
 */

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA CACHE
// ─────────────────────────────────────────────────────────────────────────────

let _masterSchemaCache: any = null
let _templateCache: any = null

/**
 * Get the master unified schema (lazy-loaded, cached)
 */
export async function getMasterSchema(): Promise<any> {
  if (_masterSchemaCache) return _masterSchemaCache
  
  // Defer creation to not block main thread
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        _masterSchemaCache = createMasterSchema()
        resolve(_masterSchemaCache)
      }, 0)
    })
  })
}

/**
 * Get the unified template (lazy-loaded, cached)
 */
export async function getUnifiedTemplate(): Promise<any> {
  if (_templateCache) return _templateCache
  
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        _templateCache = createUnifiedTemplate()
        resolve(_templateCache)
      }, 0)
    })
  })
}

/**
 * Clear caches (useful for testing or memory management)
 */
export function clearSchemaCache(): void {
  _masterSchemaCache = null
  _templateCache = null
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL CONVERSION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert raw agent box to canonical format (v1.0.0)
 */
export function toCanonicalAgentBox(box: any): any {
  return {
    _schemaVersion: '1.0.0' as const,
    id: box.id || `box-${Date.now()}`,
    boxNumber: typeof box.boxNumber === 'number' ? box.boxNumber : (box.number || 1),
    agentNumber: typeof box.agentNumber === 'number' ? box.agentNumber : 1,
    identifier: box.identifier || `AB${String(box.boxNumber || box.number || 1).padStart(2, '0')}${String(box.agentNumber || 1).padStart(2, '0')}`,
    agentId: box.agentId || `agent${box.agentNumber || 1}`,
    title: box.title || `Agent Box ${String(box.boxNumber || box.number || 1).padStart(2, '0')}`,
    color: box.color || '#4CAF50',
    enabled: box.enabled !== false,
    provider: box.provider || '',
    model: box.model || 'auto',
    tools: Array.isArray(box.tools) ? box.tools : [],
    source: box.source || 'master_tab',
    masterTabId: box.masterTabId || '01',
    tabIndex: typeof box.tabIndex === 'number' ? box.tabIndex : 1,
    side: box.side || undefined,
    slotId: box.slotId || undefined,
    gridSessionId: box.gridSessionId || undefined,
  }
}

/**
 * Extract agent number from ID or name
 */
export function inferAgentNumber(id: string, name?: string): number | undefined {
  const idMatch = (id || '').match(/agent[-_]?(\d+)/i)
  if (idMatch) return parseInt(idMatch[1], 10)
  const nameMatch = (name || '').match(/agent[-_]?(\d+)/i)
  if (nameMatch) return parseInt(nameMatch[1], 10)
  const endMatch = (id || '').match(/(\d+)$/)
  if (endMatch) return parseInt(endMatch[1], 10)
  return undefined
}

/**
 * Convert raw agent to canonical format (v2.1.0)
 */
export function toCanonicalAgent(agent: any): any {
  const agentNumber = typeof agent.number === 'number' ? agent.number : 
                     inferAgentNumber(agent.key || agent.id, agent.name)
  
  return {
    _schemaVersion: '2.1.0' as const,
    id: agent.key || agent.id || `agent-${Date.now()}`,
    name: agent.name || agent.key || 'unnamed-agent',
    description: agent.description || '',
    icon: agent.icon || '🤖',
    number: agentNumber,
    enabled: agent.enabled !== false,
    capabilities: agent.capabilities || ['listening', 'reasoning', 'execution'],
    scope: agent.scope || 'session',
    contextSettings: agent.contextSettings || agent.config?.contextSettings || {
      agentContext: false,
      sessionContext: true,
      accountContext: false
    },
    memorySettings: agent.memorySettings || agent.config?.memorySettings || {
      agentEnabled: true,
      sessionEnabled: false,
      accountEnabled: false
    },
    listening: agent.listening || agent.config?.listening || undefined,
    reasoningSections: agent.reasoningSections || agent.config?.reasoningSections || 
      (agent.reasoning ? [agent.reasoning] : undefined) ||
      (agent.config?.reasoning ? [agent.config.reasoning] : undefined),
    executionSections: agent.executionSections || agent.config?.executionSections ||
      (agent.execution ? [agent.execution] : undefined) ||
      (agent.config?.execution ? [agent.config.execution] : undefined),
  }
}

/**
 * Build connection info from agents and boxes
 */
export function buildConnectionInfo(agents: any[], boxes: any[]): any {
  const connectionMap = new Map<number, { agentId: string, boxIdentifiers: string[] }>()
  
  agents.forEach((agent: any) => {
    if (agent.number) {
      connectionMap.set(agent.number, {
        agentId: agent.id,
        boxIdentifiers: []
      })
    }
  })
  
  boxes.forEach((box: any) => {
    const mapping = connectionMap.get(box.agentNumber)
    if (mapping) {
      mapping.boxIdentifiers.push(box.identifier)
    }
  })
  
  return {
    agentToBoxMapping: Array.from(connectionMap.entries()).map(([num, data]) => ({
      agentNumber: num,
      agentId: data.agentId,
      boxIdentifiers: data.boxIdentifiers
    })),
    routingLogic: 'Agent.number === AgentBox.agentNumber → output routes to that box'
  }
}

/**
 * Convert arrays of agents and boxes to canonical format (batch, async)
 */
export async function convertToCanonicalFormat(
  rawAgents: any[], 
  rawBoxes: any[]
): Promise<{ agents: any[], agentBoxes: any[], connectionInfo: any }> {
  return new Promise((resolve) => {
    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleWork = (window as any).requestIdleCallback || 
      ((cb: () => void) => setTimeout(cb, 1))
    
    scheduleWork(() => {
      const agents = rawAgents.map(toCanonicalAgent)
      const agentBoxes = rawBoxes.map(toCanonicalAgentBox)
      const connectionInfo = buildConnectionInfo(agents, agentBoxes)
      
      resolve({ agents, agentBoxes, connectionInfo })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA CREATION FUNCTIONS (called lazily)
// ─────────────────────────────────────────────────────────────────────────────

function createMasterSchema(): any {
  return {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "https://optimando.ai/schemas/optimando.schema.json",
    "title": "Optimando AI Master Schema",
    "description": "Unified schema for all Optimando AI configurations (v2.1.0). Includes: Agents, Agent Boxes, Mini Apps, and their connections.",
    "type": "object",
    "properties": {
      "$schema": { "type": "string" },
      "_schemaVersion": { "type": "string", "const": "2.1.0" },
      "_exportedAt": { "type": "string", "format": "date-time" },
      "_helper": { "type": "string" },
      
      "agents": {
        "type": "array",
        "description": "Array of Agent configurations.",
        "items": {
          "type": "object",
          "required": ["id", "name", "enabled", "capabilities"],
          "properties": {
            "id": { "type": "string" },
            "name": { "type": "string" },
            "description": { "type": "string" },
            "icon": { "type": "string", "default": "🤖" },
            "number": { "type": "integer", "minimum": 1, "maximum": 99 },
            "enabled": { "type": "boolean" },
            "capabilities": { "type": "array", "items": { "type": "string", "enum": ["listening", "reasoning", "execution"] } },
            "contextSettings": { "type": "object" },
            "memorySettings": { "type": "object" },
            "listening": { "type": "object" },
            "reasoningSections": { "type": "array" },
            "executionSections": { "type": "array" }
          }
        }
      },
      
      "agentBoxes": {
        "type": "array",
        "description": "Array of Agent Box configurations. Connection: AgentBox.agentNumber must match Agent.number.",
        "items": {
          "type": "object",
          "required": ["id", "boxNumber", "agentNumber", "identifier", "title", "enabled"],
          "properties": {
            "id": { "type": "string" },
            "boxNumber": { "type": "integer", "minimum": 1, "maximum": 99 },
            "agentNumber": { "type": "integer", "minimum": 1, "maximum": 99 },
            "identifier": { "type": "string", "pattern": "^AB[0-9]{2}[0-9]{2}$" },
            "agentId": { "type": "string" },
            "title": { "type": "string" },
            "color": { "type": "string" },
            "enabled": { "type": "boolean" },
            "provider": { "type": "string", "enum": ["", "OpenAI", "Claude", "Gemini", "Grok", "Local AI", "Image AI"] },
            "model": { "type": "string" },
            "tools": { "type": "array", "items": { "type": "string" } },
            "source": { "type": "string", "enum": ["master_tab", "display_grid"] },
            "masterTabId": { "type": "string" },
            "tabIndex": { "type": "integer" }
          }
        }
      },
      
      "miniApps": {
        "type": "array",
        "description": "Array of Mini App configurations. (Reserved for future)",
        "items": { "type": "object" }
      },
      
      "connectionInfo": {
        "type": "object",
        "properties": {
          "agentToBoxMapping": { "type": "array" },
          "routingLogic": { "type": "string" }
        }
      }
    },
    "_schemaInfo": {
      "enums": {
        "agent.capabilities": ["listening", "reasoning", "execution"],
        "trigger.type": ["direct_tag", "tag_and_condition", "workflow_condition", "dom_event", "dom_parser", "augmented_overlay", "agent", "miniapp", "manual"],
        "destination.kind": ["agentBox", "chat", "email", "webhook", "storage", "notification"],
        "agentBox.provider": ["", "OpenAI", "Claude", "Gemini", "Grok", "Local AI", "Image AI"]
      },
      "connectionLogic": "Agent.number === AgentBox.agentNumber → output routes to that box"
    }
  }
}

function createUnifiedTemplate(): any {
  return {
    "$schema": "./optimando.schema.json",
    "_schemaVersion": "2.1.0",
    "_exportedAt": new Date().toISOString(),
    "_source": "Optimando AI Extension - Unified Template",
    "_helper": "UNIFIED TEMPLATE for LLM generation. CRITICAL: Agent.number must equal AgentBox.agentNumber for routing.",
    
    "agents": [
      {
        "id": "my-agent-01",
        "name": "my-agent-name",
        "description": "TEMPLATE: Describe what this agent does.",
        "icon": "🤖",
        "number": 1,
        "enabled": true,
        "capabilities": ["listening", "reasoning", "execution"],
        "contextSettings": { "agentContext": true, "sessionContext": true, "accountContext": false },
        "memorySettings": { "agentEnabled": true, "sessionEnabled": false, "accountEnabled": false },
        "listening": {
          "expectedContext": "TEMPLATE: Keywords for activation",
          "sources": ["dom"],
          "unifiedTriggers": [
            {
              "id": "TRIGGER01",
              "type": "dom_parser",
              "enabled": true,
              "parserTrigger": "button_click",
              "captureInput": true,
              "captureOutput": true,
              "responseReadyMode": "quiet_period",
              "quietPeriodMs": 1500
            }
          ]
        },
        "reasoningSections": [
          {
            "applyForList": ["TRIGGER01"],
            "goals": "TEMPLATE: What should this agent achieve?",
            "role": "TEMPLATE: Agent persona",
            "rules": "TEMPLATE: Constraints"
          }
        ],
        "executionSections": [
          {
            "applyForList": ["TRIGGER01"],
            "executionMode": "agent_workflow",
            "destinations": [{ "kind": "agentBox", "agents": ["AB0101"] }]
          }
        ]
      }
    ],
    
    "agentBoxes": [
      {
        "id": "box-001",
        "boxNumber": 1,
        "agentNumber": 1,
        "identifier": "AB0101",
        "agentId": "my-agent-01",
        "title": "🤖 My Agent Output",
        "color": "#4CAF50",
        "enabled": true,
        "provider": "",
        "model": "auto",
        "tools": [],
        "source": "master_tab"
      }
    ],
    
    "miniApps": [],
    
    "connectionInfo": {
      "agentToBoxMapping": [
        { "agentNumber": 1, "agentId": "my-agent-01", "boxIdentifiers": ["AB0101"] }
      ]
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download JSON data as a file
 */
export function downloadJson(data: any, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download master schema (async, cached)
 */
export async function downloadMasterSchema(): Promise<void> {
  const schema = await getMasterSchema()
  downloadJson(schema, 'optimando.schema.json')
}

/**
 * Download unified template (async, cached)
 */
export async function downloadUnifiedTemplate(): Promise<void> {
  const template = await getUnifiedTemplate()
  downloadJson(template, 'optimando.template.json')
}

