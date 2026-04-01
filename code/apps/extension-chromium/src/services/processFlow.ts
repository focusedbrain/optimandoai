/**
 * Process Flow Service
 * Handles trigger matching, input routing, butler response generation,
 * and agent box output routing based on Input/Output Coordinator rules
 * 
 * This module uses the unified InputCoordinator for all routing decisions.
 * The InputCoordinator consolidates the routing logic with clear forwarding rules:
 * 1. Active trigger clicked (e.g., #tag17) -> Forward to agent
 * 2. Passive trigger pattern matched -> Forward to agent
 * 3. No listener active on agent -> Always forward to reasoning
 * 4. No match at all -> Butler response only
 */

// Import canonical provider identity constants
import { PROVIDER_IDS, toProviderId, toProviderLabel, CLOUD_DEFAULT_MODELS, PROVIDER_API_KEY_NAMES, type ProviderId } from '../constants/providers'

// Import the unified Input Coordinator
import { InputCoordinator, inputCoordinator } from './InputCoordinator'

// Import NLP Classifier for structured input parsing
import { nlpClassifier } from '../nlp/NlpClassifier'

// Import new automation system for enhanced features (kept for compatibility)
import { 
  ListenerManager, 
  TriggerRegistry, 
  ChatTrigger,
  ConditionEngine,
  LegacyConfigAdapter,
  type NormalizedEvent,
  type AutomationConfig,
  type EventTagRoutingBatch,
  type EventTagRoutingResult
} from '../automation'

// Re-export types needed by sidepanel
export type { EventTagRoutingBatch, EventTagRoutingResult }

// =============================================================================
// New Automation System Integration
// =============================================================================

/**
 * Singleton instances of the new automation system
 */
let _listenerManager: ListenerManager | null = null
let _triggerRegistry: TriggerRegistry | null = null
let _chatTrigger: ChatTrigger | null = null
let _legacyAdapter: LegacyConfigAdapter | null = null

/**
 * Get or create the ListenerManager instance
 */
export function getListenerManager(): ListenerManager {
  if (!_listenerManager) {
    _triggerRegistry = new TriggerRegistry()
    _listenerManager = new ListenerManager(_triggerRegistry)
    _chatTrigger = new ChatTrigger()
    _triggerRegistry.registerTrigger(_chatTrigger)
    _legacyAdapter = new LegacyConfigAdapter()
    console.log('[ProcessFlow] Initialized new automation system')
  }
  return _listenerManager
}

/**
 * Get the TriggerRegistry instance
 */
export function getTriggerRegistry(): TriggerRegistry {
  getListenerManager() // Ensure initialized
  return _triggerRegistry!
}

/**
 * Get the ChatTrigger instance
 */
export function getChatTrigger(): ChatTrigger {
  getListenerManager() // Ensure initialized
  return _chatTrigger!
}

/**
 * Get the LegacyConfigAdapter instance
 */
export function getLegacyAdapter(): LegacyConfigAdapter {
  getListenerManager() // Ensure initialized
  return _legacyAdapter!
}

/**
 * Initialize automation configs from loaded agents
 * Converts legacy AgentConfig to new AutomationConfig format
 */
export async function initializeAutomationsFromSession(): Promise<void> {
  const manager = getListenerManager()
  const adapter = getLegacyAdapter()
  
  // Load agents from session
  const agents = await loadAgentsFromSession()
  
  // Convert each agent to automation config and register
  for (const agent of agents) {
    if (!agent.enabled) continue
    
    try {
      // Use the legacy adapter to convert
      const automationConfig = adapter.adapt(agent as any)
      manager.register(automationConfig)
      console.log(`[ProcessFlow] Registered automation from agent: ${agent.name}`)
    } catch (e) {
      console.warn(`[ProcessFlow] Failed to convert agent ${agent.id}:`, e)
    }
  }
  
  console.log(`[ProcessFlow] Initialized ${manager.getAll().length} automations from session`)
}

/**
 * Process input through the new automation system
 * This is an alternative to routeInput that uses the full pipeline
 */
export async function processWithAutomation(
  input: string,
  hasImage: boolean,
  imageUrl?: string,
  url?: string,
  sessionKey?: string
): Promise<{ processed: boolean; results: any[] }> {
  const manager = getListenerManager()
  const chatTrigger = getChatTrigger()
  
  // Ensure automations are initialized
  if (manager.getAll().length === 0) {
    await initializeAutomationsFromSession()
  }
  
  // Create and emit chat event
  chatTrigger.handleMessage({
    text: input,
    hasImage,
    imageUrl,
    url,
    sessionKey
  })
  
  // For now, return synchronously
  // The full async processing happens via the ListenerManager
  return { processed: true, results: [] }
}

// =============================================================================
// Original Process Flow Types and Functions
// =============================================================================

// Types for process flow
export interface AgentMatch {
  agentId: string
  agentName: string
  agentIcon: string
  agentNumber?: number
  matchReason: 'trigger' | 'expected_context'
  matchDetails: string
  triggerName?: string
  triggerType?: 'passive' | 'active'
  outputLocation?: string
  agentBoxId?: string
  agentBoxNumber?: number
  // Agent box model info for LLM selection
  agentBoxProvider?: string
  agentBoxModel?: string
}

export interface AgentConfig {
  id: string
  name: string
  description?: string // Human-readable description of the agent
  key?: string
  icon: string
  enabled: boolean
  number?: number // Agent number for matching with agent boxes
  capabilities?: string[]
  listening?: {
    passiveEnabled?: boolean
    activeEnabled?: boolean
    expectedContext?: string
    tags?: string[]
    source?: string
    website?: string
    passive?: {
      triggers?: Array<{ tag?: { name: string; kind?: string } }>
    }
    active?: {
      triggers?: Array<{ tag?: { name: string; kind?: string } }>
    }
    reportTo?: string[]
    unifiedTriggers?: Array<{ tag?: string; tagName?: string; keywords?: string[]; keywordMode?: string }>
    triggers?: Array<{ tag?: string; tagName?: string; name?: string; keywords?: string[]; keywordMode?: string }>
  }
  reasoning?: {
    applyFor?: string // '__any__' or specific type
    acceptFrom?: string[] // Sources to accept input from
    goals?: string
    role?: string
    rules?: string
    custom?: Array<{ key: string; value: string }>
  }
  execution?: {
    applyFor?: string
    acceptFrom?: string[]
    specialDestinations?: Array<{
      kind: string
      agents?: string[]
    }>
    workflows?: string[]
    executionSections?: Array<{
      applyFor?: string
      acceptFrom?: string[]
      specialDestinations?: Array<{ kind: string; agents?: string[] }>
      workflows?: string[]
    }>
  }
  config?: {
    instructions?: string | object
  }
}

export interface AgentBox {
  id: string
  boxNumber: number
  title: string
  agentNumber?: number // Links to agent.number
  agentId?: string // May contain "agent1", "agent2", etc.
  outputId?: string
  output?: string
  locationLabel?: string
  locationId?: string
  slotId?: string
  enabled?: boolean
  color?: string
  provider?: string // LLM provider (OpenAI, Claude, etc.)
  model?: string // LLM model
  imageProvider?: string // Image generation provider ID (comfyui, replicate, etc.)
  imageModel?: string // Image model/preset for the selected provider
}

export interface RoutingDecision {
  shouldForwardToAgent: boolean
  matchedAgents: AgentMatch[]
  butlerResponse: string
  originalInput: string
  inputType: 'text' | 'image' | 'trigger' | 'mixed'
  targetAgentBoxes: AgentBox[]
}

/**
 * Enriched input for the current user turn.
 * Assembled BEFORE routing so OCR-derived text can influence agent matching.
 */
export interface EnrichedTurnInput {
  typedText: string
  ocrText: string
  combinedText: string
  hasImage: boolean
  imageUrl?: string
  currentUrl: string
  source: 'wr_chat' | 'trigger' | 'screenshot'
}

// Storage key for triggers
const TRIGGERS_STORAGE_KEY = 'optimando-tagged-triggers'

/**
 * Get current session key - async version that reads from chrome.storage
 */
async function getCurrentSessionKeyAsync(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get(['optimando-active-session-key'], (data: any) => {
        const sessionKey = data?.['optimando-active-session-key'] || null
        console.log('[ProcessFlow] getCurrentSessionKeyAsync:', sessionKey)
        resolve(sessionKey)
      })
    } catch {
      resolve(null)
    }
  })
}

/**
 * Get current session key - sync version for backward compatibility
 * Falls back to localStorage if chrome.storage is not available
 */
function getCurrentSessionKey(): string | null {
  try {
    // First try localStorage (used by some parts of the extension)
    let sessionKey = localStorage.getItem('optimando-active-session-key')
    if (!sessionKey) {
      sessionKey = localStorage.getItem('optimando-global-active-session')
    }
    if (!sessionKey) {
      sessionKey = sessionStorage.getItem('optimando-current-session-key')
    }
    return sessionKey
  } catch {
    return null
  }
}

/**
 * Extract agent number from various sources
 * Priority: explicit number field > parsed from key > parsed from name > parsed from id > index-based
 * 
 * This is the authoritative function for determining an agent's number, used by:
 * - loadAgentsFromSession() - sets agent.number on load
 * - InputCoordinator - uses agent.number for matching
 * - findAgentBoxesForAgent() - matches agent.number to box.agentNumber
 */
function extractAgentNumber(agent: any, index: number): number {
  // 1. Check explicit number field (from parsed config.instructions or direct assignment)
  if (typeof agent.number === 'number' && agent.number > 0) {
    console.log(`[ProcessFlow] extractAgentNumber: Found explicit number ${agent.number} for "${agent.name || agent.key}"`)
    return agent.number
  }
  
  // 2. Try to parse from key (e.g., "agent1", "agent2")
  if (agent.key) {
    const keyMatch = String(agent.key).match(/^agent(\d+)$/i)
    if (keyMatch) {
      const num = parseInt(keyMatch[1], 10)
      console.log(`[ProcessFlow] extractAgentNumber: Extracted ${num} from key "${agent.key}"`)
      return num
    }
  }
  
  // 3. Try to parse from name (e.g., "Agent 01", "Agent 02: Invoice Processor")
  if (agent.name) {
    // Match "Agent XX" or "Agent XX:" patterns
    const nameMatch = String(agent.name).match(/^agent\s*(\d+)/i)
    if (nameMatch) {
      const num = parseInt(nameMatch[1], 10)
      console.log(`[ProcessFlow] extractAgentNumber: Extracted ${num} from name "${agent.name}"`)
      return num
    }
  }
  
  // 4. Try to parse from id (e.g., "agent1-uuid", "session_agent2")
  if (agent.id) {
    const idMatch = String(agent.id).match(/agent(\d+)/i)
    if (idMatch) {
      const num = parseInt(idMatch[1], 10)
      console.log(`[ProcessFlow] extractAgentNumber: Extracted ${num} from id "${agent.id}"`)
      return num
    }
  }
  
  // 5. Fall back to 1-indexed position
  const fallbackNum = index + 1
  console.log(`[ProcessFlow] extractAgentNumber: Using fallback index ${fallbackNum} for "${agent.name || agent.key || agent.id}"`)
  return fallbackNum
}

/**
 * Load saved triggers from chrome storage
 */
export async function loadSavedTriggers(): Promise<any[]> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local?.get([TRIGGERS_STORAGE_KEY], (data: any) => {
        const triggers = Array.isArray(data?.[TRIGGERS_STORAGE_KEY]) 
          ? data[TRIGGERS_STORAGE_KEY] 
          : []
        resolve(triggers)
      })
    } catch (e) {
      console.warn('[ProcessFlow] Failed to load triggers:', e)
      resolve([])
    }
  })
}

/**
 * Load agents from the current session
 * Uses SQLite as the single source of truth via background script messaging
 */
export async function loadAgentsFromSession(): Promise<AgentConfig[]> {
  try {
    // Get session key using async method (more reliable in extension context)
    const sessionKey = await getCurrentSessionKeyAsync()
    
    if (!sessionKey) {
      console.warn('[ProcessFlow] No session key found - cannot load agents')
      return []
    }
    
    console.log('[ProcessFlow] Loading agents from SQLite session:', sessionKey)

    return new Promise((resolve) => {
      try {
        // Load from SQLite via background script (single source of truth)
        chrome.runtime?.sendMessage({ 
          type: 'GET_SESSION_FROM_SQLITE', 
          sessionKey 
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[ProcessFlow] Error loading from SQLite:', chrome.runtime.lastError.message)
            // Fallback to chrome.storage.local
            loadAgentsFromChromeStorage(sessionKey).then(resolve)
            return
          }
          
          if (!response?.success || !response?.session) {
            console.warn('[ProcessFlow] No session data found in SQLite for key:', sessionKey)
            // Fallback to chrome.storage.local
            loadAgentsFromChromeStorage(sessionKey).then(resolve)
            return
          }
          
          const session = response.session
          const agents = parseAgentsFromSession(session)
          console.log('[ProcessFlow] ✅ Loaded', agents.length, 'agents from SQLite')
          resolve(agents)
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to load agents from SQLite:', e)
        loadAgentsFromChromeStorage(sessionKey).then(resolve)
      }
    })
  } catch (e) {
    console.warn('[ProcessFlow] Error in loadAgentsFromSession:', e)
    return []
  }
}

/**
 * Fallback: Load agents from chrome.storage.local
 */
async function loadAgentsFromChromeStorage(sessionKey: string): Promise<AgentConfig[]> {
  return new Promise((resolve) => {
    chrome.storage?.local?.get([sessionKey], (data: any) => {
      const session = data?.[sessionKey]
      if (!session) {
        console.warn('[ProcessFlow] No session data in chrome.storage for key:', sessionKey)
        resolve([])
        return
      }
      const agents = parseAgentsFromSession(session)
      console.log('[ProcessFlow] Loaded', agents.length, 'agents from chrome.storage (fallback)')
      resolve(agents)
    })
  })
}

/**
 * Parse agents from session data structure
 */
function parseAgentsFromSession(session: any): AgentConfig[] {
  // Get agents from session
  const agents: AgentConfig[] = session.agents || []
  
  console.log('[ProcessFlow] Found', agents.length, 'agents in session')
  
  // Parse agent configs and extract proper number
  const parsedAgents = agents.map((agent: any, index: number) => {
    let parsed = { ...agent }
    
    // Debug: Log what config data exists for this agent
    console.log(`[ProcessFlow] Agent ${index}: "${agent.name || agent.key}"`, {
      hasConfig: !!agent.config,
      configKeys: agent.config ? Object.keys(agent.config) : [],
      hasInstructions: !!agent.config?.instructions,
      instructionsType: agent.config?.instructions ? typeof agent.config.instructions : 'none',
      enabled: agent.enabled,
      // Check for unified triggers directly on listening
      hasListeningDirect: !!agent.listening,
      unifiedTriggersCount: agent.listening?.unifiedTriggers?.length || 0
    })
    
    // First check if listening/reasoning/execution are directly on the agent (new format)
    if (agent.listening || agent.reasoning || agent.execution) {
      console.log(`[ProcessFlow] ✅ Agent "${agent.name || agent.key}" has direct sections:`, {
        hasListening: !!agent.listening,
        hasReasoning: !!agent.reasoning,
        hasExecution: !!agent.execution,
        unifiedTriggers: agent.listening?.unifiedTriggers?.length || 0,
        passiveTriggers: agent.listening?.passive?.triggers?.length || 0,
        activeTriggers: agent.listening?.active?.triggers?.length || 0
      })
    }
    
    // Parse config.instructions if it's a string (legacy format)
    if (agent.config?.instructions) {
      try {
        const instructions = typeof agent.config.instructions === 'string'
          ? JSON.parse(agent.config.instructions)
          : agent.config.instructions
        parsed = { ...parsed, ...instructions }
        console.log(`[ProcessFlow] ✅ Parsed instructions for "${agent.name || agent.key}":`, {
          hasListening: !!instructions.listening,
          hasReasoning: !!instructions.reasoning,
          hasExecution: !!instructions.execution,
          unifiedTriggers: instructions.listening?.unifiedTriggers?.length || 0,
          triggers: instructions.listening?.passive?.triggers?.length || 0,
          activeTriggers: instructions.listening?.active?.triggers?.length || 0
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to parse agent config:', e)
      }
    }
    
    // Extract proper agent number
    parsed.number = extractAgentNumber(parsed, index)
    
    console.log(`[ProcessFlow] Agent "${parsed.name || parsed.key}": number=${parsed.number}, enabled=${parsed.enabled}`)
    
    return parsed
  })

  return parsedAgents
}

/**
 * Extract agent number from AgentBox data
 * Priority: explicit agentNumber > allocatedAgentNumber > parsed from agentId > parsed from model > parsed from title
 * 
 * This is the authoritative function for determining which agent is connected to a box.
 */
function extractBoxAgentNumber(box: any): number | undefined {
  // 1. Check explicit agentNumber field (set by UI when allocating agent)
  if (typeof box.agentNumber === 'number' && box.agentNumber > 0) {
    return box.agentNumber
  }
  
  // 2. Check allocatedAgentNumber (alternative field name)
  if (typeof box.allocatedAgentNumber === 'number' && box.allocatedAgentNumber > 0) {
    return box.allocatedAgentNumber
  }
  
  // 3. Try to parse from agentId (e.g., "agent1", "agent2")
  if (box.agentId) {
    const match = String(box.agentId).match(/agent(\d+)/i)
    if (match) {
      return parseInt(match[1], 10)
    }
  }
  
  // 4. Try to parse from model field (legacy: sometimes agent number was stored here)
  if (box.model && typeof box.model === 'string') {
    const match = String(box.model).match(/agent(\d+)/i)
    if (match) {
      return parseInt(match[1], 10)
    }
  }
  
  // 5. Try to parse from title (e.g., "Agent 01 Output")
  if (box.title) {
    const match = String(box.title).match(/agent\s*(\d+)/i)
    if (match) {
      return parseInt(match[1], 10)
    }
  }
  
  // No agent number found - box is not connected to an agent
  return undefined
}

/**
 * Load agent boxes from the current session.
 * Primary source: SQLite via background (same as loadAgentsFromSession).
 * Fallback: chrome.storage.local.
 */
export async function loadAgentBoxesFromSession(): Promise<AgentBox[]> {
  try {
    const sessionKey = await getCurrentSessionKeyAsync()

    if (!sessionKey) {
      console.warn('[ProcessFlow] No session key found - cannot load agent boxes')
      return []
    }
    
    console.log('[ProcessFlow] Loading agent boxes from SQLite session:', sessionKey)

    return new Promise((resolve) => {
      try {
        chrome.runtime?.sendMessage({
          type: 'GET_SESSION_FROM_SQLITE',
          sessionKey
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[ProcessFlow] Error loading boxes from SQLite:', chrome.runtime.lastError.message)
            loadAgentBoxesFromChromeStorage(sessionKey).then(resolve)
            return
          }

          if (!response?.success || !response?.session) {
            console.warn('[ProcessFlow] No session in SQLite for boxes, falling back to chrome.storage.local')
            loadAgentBoxesFromChromeStorage(sessionKey).then(resolve)
            return
          }

          const boxes = normalizeAgentBoxes(response.session.agentBoxes || [])
          console.log('[ProcessFlow] Loaded', boxes.length, 'agent boxes from SQLite')
          resolve(boxes)
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to load agent boxes from SQLite:', e)
        loadAgentBoxesFromChromeStorage(sessionKey).then(resolve)
      }
    })
  } catch (e) {
    console.warn('[ProcessFlow] Error in loadAgentBoxesFromSession:', e)
    return []
  }
}

/**
 * Fallback: load agent boxes from chrome.storage.local
 */
async function loadAgentBoxesFromChromeStorage(sessionKey: string): Promise<AgentBox[]> {
  return new Promise((resolve) => {
    chrome.storage?.local?.get([sessionKey], (data: any) => {
      const session = data?.[sessionKey]
      if (!session) {
        console.warn('[ProcessFlow] No session data in chrome.storage for boxes, key:', sessionKey)
        resolve([])
        return
      }
      const boxes = normalizeAgentBoxes(session.agentBoxes || [])
      console.log('[ProcessFlow] Loaded', boxes.length, 'agent boxes from chrome.storage (fallback)')
      resolve(boxes)
    })
  })
}

/**
 * Normalize agent box data: ensure id, boxNumber, agentNumber are set.
 * Grid boxes store identity in `identifier` but lack `id` — this bridges the gap.
 */
function normalizeAgentBoxes(agentBoxes: any[]): AgentBox[] {
  const normalizedBoxes = agentBoxes.map((box: any, index: number) => {
    const normalized = { ...box }

    // Bridge id/identifier: grid boxes have identifier but no id
    if (!normalized.id && normalized.identifier) {
      normalized.id = normalized.identifier
    }
    if (!normalized.identifier && normalized.id) {
      normalized.identifier = normalized.id
    }

    if (normalized.boxNumber === undefined) {
      normalized.boxNumber = index + 1
    }

    const extractedAgentNum = extractBoxAgentNumber(box)
    if (extractedAgentNum !== undefined) {
      normalized.agentNumber = extractedAgentNum
    }

    console.log(`[ProcessFlow] AgentBox ${normalized.boxNumber}:`, {
      id: normalized.id,
      identifier: normalized.identifier,
      title: normalized.title,
      source: normalized.source ?? 'master_tab',
      agentNumber: normalized.agentNumber ?? '(none)',
      provider: normalized.provider ?? '(none)',
      model: normalized.model ?? '(none)',
      enabled: normalized.enabled !== false
    })

    return normalized
  })

  const connectedBoxes = normalizedBoxes.filter((b: any) => b.agentNumber !== undefined)
  console.log(`[ProcessFlow] AgentBox wiring summary: ${connectedBoxes.length}/${normalizedBoxes.length} boxes connected to agents`)

  return normalizedBoxes
}

/**
 * Find agent boxes connected to an agent via agentNumber matching
 * 
 * Uses the InputCoordinator's implementation for consistent matching logic.
 */
export function findAgentBoxesForAgent(
  agent: AgentConfig,
  agentBoxes: AgentBox[]
): AgentBox[] {
  // Delegate to InputCoordinator for consistent matching
  return inputCoordinator.findAgentBoxesForAgent(agent, agentBoxes)
}

/**
 * Extract trigger patterns from input text
 * Looks for #TriggerName patterns (primary) and @TriggerName (backward compatibility)
 */
export function extractTriggerPatterns(input: string): string[] {
  // Delegate to InputCoordinator for consistent pattern extraction
  return inputCoordinator.extractTriggerPatterns(input)
}

/**
 * Check if input matches agent's expected context
 */
function matchesExpectedContext(input: string, expectedContext: string): boolean {
  if (!expectedContext) return false
  
  // Simple keyword/phrase matching
  const contextLower = expectedContext.toLowerCase()
  const inputLower = input.toLowerCase()
  
  // Check if any significant words from expected context are in input
  const keywords = contextLower.split(/[\s,;]+/).filter(w => w.length > 3)
  return keywords.some(keyword => inputLower.includes(keyword))
}

/**
 * Check if agent's applyFor matches the input type
 */
function matchesApplyFor(applyFor: string | undefined, inputType: string, hasImage: boolean): boolean {
  if (!applyFor || applyFor === '__any__') return true
  
  const applyForLower = applyFor.toLowerCase()
  
  if (applyForLower === 'text' && inputType === 'text') return true
  if (applyForLower === 'image' && (inputType === 'image' || hasImage)) return true
  if (applyForLower === 'mixed' && inputType === 'mixed') return true
  
  return false
}

/**
 * Full routing logic - matches input against all agent rules
 * 
 * Uses the unified InputCoordinator with the following forwarding rules:
 * 1. Active trigger clicked (e.g., #tag17) -> Forward to matched agent
 * 2. Passive trigger pattern matched -> Forward to matched agent
 * 3. No listener active on agent -> Always forward to reasoning section
 * 4. No match at all -> Butler response only (empty array returned)
 */
export function matchInputToAgents(
  input: string,
  inputType: 'text' | 'image' | 'mixed',
  hasImage: boolean,
  agents: AgentConfig[],
  agentBoxes: AgentBox[],
  currentUrl?: string
): AgentMatch[] {
  // Delegate to the unified InputCoordinator
  return inputCoordinator.routeToAgents(
    input,
    inputType,
    hasImage,
    agents,
    agentBoxes,
    currentUrl
  )
}

/**
 * Check if input is a system query (asking about status, agents, etc.)
 */
export function isSystemQuery(input: string): boolean {
  const systemPatterns = [
    /what\s+(agents?|status|system)/i,
    /show\s+(agents?|status|system)/i,
    /list\s+agents?/i,
    /active\s+agents?/i,
    /system\s+status/i,
    /connection\s+status/i,
    /^status$/i,
    /^agents?$/i
  ]
  
  return systemPatterns.some(pattern => pattern.test(input.trim()))
}

/**
 * Generate butler response for agent forwarding
 */
export function generateForwardingResponse(matches: AgentMatch[]): string {
  // Delegate to InputCoordinator for consistent response generation
  return inputCoordinator.generateForwardingResponse(matches)
}

/**
 * Generate system status response
 */
export async function generateSystemStatusResponse(
  agents: AgentConfig[],
  agentBoxes: AgentBox[],
  connectionStatus: { isConnected: boolean },
  sessionName: string,
  activeLlmModel: string
): Promise<string> {
  const enabledAgents = agents.filter(a => a.enabled)
  
  let response = `**System Status**\n\n`
  response += `• Electron Backend: ${connectionStatus.isConnected ? '✓ Connected' : '✗ Disconnected'}\n`
  response += `• Active LLM Model: ${activeLlmModel || 'Not selected'}\n`
  response += `• Session: ${sessionName || 'Unnamed Session'}\n`
  response += `• Active Agents: ${enabledAgents.length} enabled\n`
  response += `• Agent Boxes: ${agentBoxes.length} configured\n\n`

  if (enabledAgents.length > 0) {
    response += `**Active Agents:**\n`
    for (const agent of enabledAgents) {
      const icon = agent.icon || '🤖'
      const name = agent.name || agent.key || 'Unnamed'
      const num = agent.number ? String(agent.number).padStart(2, '0') : '??'
      const triggers: string[] = []
      
      if (agent.listening?.passive?.triggers) {
        triggers.push(...agent.listening.passive.triggers
          .map(t => t.tag?.name)
          .filter(Boolean) as string[])
      }
      if (agent.listening?.active?.triggers) {
        triggers.push(...agent.listening.active.triggers
          .map(t => t.tag?.name)
          .filter(Boolean) as string[])
      }

      // Find connected agent box
      const connectedBoxes = findAgentBoxesForAgent(agent, agentBoxes)

      response += `\n${icon} **Agent ${num}: ${name}**\n`
      if (triggers.length > 0) {
        response += `   Triggers: ${triggers.map(t => '#' + t).join(', ')}\n`
      }
      if (agent.listening?.expectedContext) {
        response += `   Expected: "${agent.listening.expectedContext}"\n`
      }
      if (connectedBoxes.length > 0) {
        const boxInfo = connectedBoxes.map(b => {
          let info = `Box ${String(b.boxNumber).padStart(2, '0')}`
          if (b.provider && b.model) {
            info += ` (${b.provider}/${b.model})`
          }
          return info
        }).join(', ')
        response += `   → Connected to: ${boxInfo}\n`
      }
    }
  } else {
    response += `No agents currently enabled. Create agents in Admin → Agent Settings.`
  }

  return response
}

/**
 * Generate butler system prompt for direct LLM responses
 */
export function getButlerSystemPrompt(
  sessionName: string,
  agentCount: number,
  isConnected: boolean
): string {
  return `You are a helpful assistant for the Optimando AI orchestration system. 
You help users manage their AI agents, understand system status, and answer general questions.

Keep responses concise and professional. If the user seems to want a specific 
agent task done, suggest which agent might help and how to trigger it.

To trigger an agent, users can:
1. Use #TriggerName in their message (e.g., "#Invoice process this")
2. Use the pencil icon to select a screen region and create a trigger
3. Configure triggers in the agent's Listener section
4. Agents may also auto-match based on expected context or applyFor settings

Current system context:
- Session: ${sessionName || 'Active Session'}
- Active agents: ${agentCount}
- Backend connection: ${isConnected ? 'Connected' : 'Disconnected'}

Be helpful, concise, and guide users to use the agent system effectively.`
}

/**
 * Main routing function - decides where to send user input
 * Uses full Input Coordinator rules, not just triggers
 */
export async function routeInput(
  input: string,
  hasImage: boolean,
  connectionStatus: { isConnected: boolean },
  sessionName: string,
  activeLlmModel: string,
  currentUrl?: string
): Promise<RoutingDecision> {
  // Determine input type
  let inputType: RoutingDecision['inputType'] = 'text'
  if (hasImage && input) inputType = 'mixed'
  else if (hasImage) inputType = 'image'

  // Load agents and agent boxes
  const agents = await loadAgentsFromSession()
  const agentBoxes = await loadAgentBoxesFromSession()
  
  console.log('[ProcessFlow] routeInput:', { 
    input: input.substring(0, 50), 
    inputType, 
    agentCount: agents.length, 
    boxCount: agentBoxes.length 
  })
  
  // Check for system queries first
  if (isSystemQuery(input)) {
    const statusResponse = await generateSystemStatusResponse(
      agents,
      agentBoxes,
      connectionStatus,
      sessionName,
      activeLlmModel
    )
    return {
      shouldForwardToAgent: false,
      matchedAgents: [],
      butlerResponse: statusResponse,
      originalInput: input,
      inputType,
      targetAgentBoxes: []
    }
  }

  // Match input to agents using full routing rules
  const matchedAgents = matchInputToAgents(
    input,
    inputType,
    hasImage,
    agents,
    agentBoxes,
    currentUrl
  )

  if (matchedAgents.length > 0) {
    // Generate forwarding response
    const butlerResponse = generateForwardingResponse(matchedAgents)
    
    // Find target agent boxes for output
    const targetAgentBoxes = matchedAgents
      .filter(m => m.agentBoxId)
      .map(m => agentBoxes.find(b => b.id === m.agentBoxId))
      .filter(Boolean) as AgentBox[]

    return {
      shouldForwardToAgent: true,
      matchedAgents,
      butlerResponse,
      originalInput: input,
      inputType,
      targetAgentBoxes
    }
  }

  // No matches - will use butler LLM response
  return {
    shouldForwardToAgent: false,
    matchedAgents: [],
    butlerResponse: '', // Will be filled by LLM
    originalInput: input,
    inputType,
    targetAgentBoxes: []
  }
}

// =============================================================================
// Event Tag Routing - New Wiring Flow
// =============================================================================

/**
 * Route input through the complete Event Tag wiring flow:
 * 
 * 1. WR Chat input → NLP Classifier → ClassifiedInput with #tags
 * 2. InputCoordinator.routeEventTagTrigger() → Match listeners
 * 3. Evaluate conditions (WRCode, sender, keywords, website)
 * 4. Collect sensor workflow context (placeholder)
 * 5. Resolve LLM from connected Agent Box
 * 6. Determine Reasoning section (via applyFor)
 * 7. Determine Execution section (via applyFor)
 * 8. Resolve output destinations (Report to)
 * 
 * This is the refactored flow that properly wires triggers to reasoning to execution.
 */
export async function routeEventTagInput(
  input: string,
  source: 'inline_chat' | 'ocr' | 'other' = 'inline_chat',
  currentUrl?: string,
  sessionKey?: string
): Promise<{
  batch: EventTagRoutingBatch
  classificationTimeMs: number
  routingTimeMs: number
}> {
  const classificationStart = Date.now()
  
  // Step 1: Classify input with NLP
  const classificationResult = await nlpClassifier.classify(input, source, {
    sourceUrl: currentUrl,
    sessionKey
  })
  
  const classificationTimeMs = Date.now() - classificationStart
  const classifiedInput = classificationResult.input
  
  console.log('[ProcessFlow] Event Tag Routing - Input classified:', {
    triggers: classifiedInput.triggers,
    entities: classifiedInput.entities.length,
    source: classifiedInput.source
  })
  
  // Step 2: Load agents and agent boxes from session
  const routingStart = Date.now()
  const agents = await loadAgentsFromSession()
  const agentBoxes = await loadAgentBoxesFromSession()
  
  // Step 3: Route through the Event Tag flow
  const batch = inputCoordinator.routeEventTagTrigger({
    classifiedInput: {
      rawText: classifiedInput.rawText,
      normalizedText: classifiedInput.normalizedText,
      triggers: classifiedInput.triggers,
      entities: classifiedInput.entities,
      source: classifiedInput.source,
      sourceUrl: classifiedInput.sourceUrl,
      sessionKey: classifiedInput.sessionKey
    },
    agents: agents as any[],
    agentBoxes: agentBoxes as any[],
    currentUrl,
    sessionKey
  })
  
  const routingTimeMs = Date.now() - routingStart
  
  console.log('[ProcessFlow] Event Tag Routing complete:', {
    matched: batch.results.length,
    triggers: batch.triggersFound,
    totalTimeMs: classificationTimeMs + routingTimeMs
  })
  
  return {
    batch,
    classificationTimeMs,
    routingTimeMs
  }
}

/**
 * Process a matched Event Tag routing result
 * 
 * This function takes a routing result and executes the complete flow:
 * 1. Collect sensor workflow context (if configured)
 * 2. Build the reasoning prompt (Goals, Role, Rules)
 * 3. Call the LLM from the connected Agent Box
 * 4. Route output to the configured destinations (Report to)
 */
export async function processEventTagMatch(
  result: EventTagRoutingResult,
  originalInput: string
): Promise<{
  success: boolean
  output: string
  llmUsed: { provider: string; model: string }
  destinations: string[]
  error?: string
}> {
  console.log('[ProcessFlow] Processing Event Tag match:', {
    agent: result.agentName,
    trigger: result.trigger.tag,
    llm: `${result.llmConfig.provider}/${result.llmConfig.model}`,
    reportTo: result.executionConfig.reportTo.map(r => r.label)
  })
  
  // Check if LLM is available
  if (!result.llmConfig.isAvailable) {
    return {
      success: false,
      output: '',
      llmUsed: { provider: result.llmConfig.provider, model: result.llmConfig.model },
      destinations: [],
      error: result.llmConfig.unavailableReason || 'LLM not available'
    }
  }
  
  // Build reasoning prompt from agent config
  const { goals, role, rules, custom } = result.reasoningConfig
  
  let systemPrompt = ''
  if (role) systemPrompt += `You are ${role}.\n\n`
  if (goals) systemPrompt += `Goals:\n${goals}\n\n`
  if (rules) systemPrompt += `Rules:\n${rules}\n\n`
  if (custom && custom.length > 0) {
    systemPrompt += 'Additional Context:\n'
    for (const field of custom) {
      systemPrompt += `${field.key}: ${field.value}\n`
    }
    systemPrompt += '\n'
  }
  
  // Add sensor context if available
  if (Object.keys(result.sensorContext).length > 0) {
    systemPrompt += 'Sensor Context:\n'
    systemPrompt += JSON.stringify(result.sensorContext, null, 2)
    systemPrompt += '\n\n'
  }
  
  console.log('[ProcessFlow] Built reasoning prompt:', {
    systemPromptLength: systemPrompt.length,
    hasGoals: !!goals,
    hasRole: !!role,
    hasRules: !!rules,
    customFields: custom?.length || 0
  })
  
  // TODO: Actually call the LLM here
  // For now, return a placeholder indicating the wiring is complete
  const placeholderOutput = `[Event Tag Routing Complete]\n\n` +
    `Agent: ${result.agentName}\n` +
    `Trigger: ${result.trigger.tag}\n` +
    `Channel: ${result.trigger.channel}\n` +
    `LLM: ${result.llmConfig.provider}/${result.llmConfig.model}\n\n` +
    `System Prompt (${systemPrompt.length} chars):\n${systemPrompt.substring(0, 200)}...\n\n` +
    `User Input: ${originalInput}\n\n` +
    `Output will be sent to: ${result.executionConfig.reportTo.map(r => r.label).join(', ')}`
  
  return {
    success: true,
    output: placeholderOutput,
    llmUsed: { provider: result.llmConfig.provider, model: result.llmConfig.model },
    destinations: result.executionConfig.reportTo.map(r => r.label)
  }
}

/**
 * Generate a butler response summarizing Event Tag routing
 */
export function generateEventTagRoutingSummary(batch: EventTagRoutingBatch): string {
  return inputCoordinator.generateRoutingSummary(batch)
}

/**
 * Forward input to agent for processing
 * Wraps input with agent's reasoning instructions
 */
export function wrapInputForAgent(
  input: string,
  agent: AgentConfig,
  imageText?: string
): string {
  const reasoning = agent.reasoning
  if (!reasoning) return input

  let wrappedInput = ''

  // Add role context
  if (reasoning.role) {
    wrappedInput += `[Role: ${reasoning.role}]\n\n`
  }

  // Add goals
  if (reasoning.goals) {
    wrappedInput += `[Goals]\n${reasoning.goals}\n\n`
  }

  // Add rules
  if (reasoning.rules) {
    wrappedInput += `[Rules]\n${reasoning.rules}\n\n`
  }

  // Add custom fields
  if (reasoning.custom && reasoning.custom.length > 0) {
    wrappedInput += `[Context]\n`
    for (const field of reasoning.custom) {
      wrappedInput += `${field.key}: ${field.value}\n`
    }
    wrappedInput += '\n'
  }

  // Add the actual input
  wrappedInput += `[User Input]\n${input}`

  // Add image text if available
  if (imageText) {
    wrappedInput += `\n\n[Extracted Image Text]\n${imageText}`
  }

  return wrappedInput
}

/**
 * Update agent box output in session storage.
 * Primary: SQLite via background handler (works for both sidepanel and grid boxes).
 * Fallback: chrome.storage.local.
 * The background handler also broadcasts UPDATE_AGENT_BOX_OUTPUT to all extension pages.
 */
export async function updateAgentBoxOutput(
  agentBoxId: string,
  output: string,
  reasoningContext?: string
): Promise<boolean> {
  try {
    const sessionKey = await getCurrentSessionKeyAsync()
    if (!sessionKey) {
      console.warn('[ProcessFlow] No session key found - cannot update agent box output')
      return false
    }

    let formattedOutput = output
    if (reasoningContext) {
      formattedOutput = `📋 **Reasoning Context:**\n${reasoningContext}\n\n---\n\n**Response:**\n${output}`
    }

    return new Promise((resolve) => {
      try {
        chrome.runtime?.sendMessage({
          type: 'UPDATE_BOX_OUTPUT_SQLITE',
          sessionKey,
          agentBoxId,
          output: formattedOutput
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[ProcessFlow] SQLite output update failed:', chrome.runtime.lastError.message)
            updateAgentBoxOutputInChromeStorage(sessionKey, agentBoxId, formattedOutput).then(resolve)
            return
          }

          if (!response?.success) {
            console.warn('[ProcessFlow] SQLite output update returned failure, trying chrome.storage fallback')
            updateAgentBoxOutputInChromeStorage(sessionKey, agentBoxId, formattedOutput).then(resolve)
            return
          }

          console.log('[ProcessFlow] Agent box output updated in SQLite:', agentBoxId)
          resolve(true)
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to send UPDATE_BOX_OUTPUT_SQLITE:', e)
        updateAgentBoxOutputInChromeStorage(sessionKey, agentBoxId, formattedOutput).then(resolve)
      }
    })
  } catch (e) {
    console.error('[ProcessFlow] Failed to update agent box output:', e)
    return false
  }
}

/**
 * Fallback: update agent box output in chrome.storage.local
 */
async function updateAgentBoxOutputInChromeStorage(
  sessionKey: string,
  agentBoxId: string,
  formattedOutput: string
): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage?.local?.get([sessionKey], (data: any) => {
      const session = data?.[sessionKey]
      if (!session || !session.agentBoxes) {
        resolve(false)
        return
      }

      const boxIndex = session.agentBoxes.findIndex(
        (b: any) => b.id === agentBoxId || b.identifier === agentBoxId
      )
      if (boxIndex === -1) {
        resolve(false)
        return
      }

      session.agentBoxes[boxIndex].output = formattedOutput
      session.agentBoxes[boxIndex].lastUpdated = new Date().toISOString()

      chrome.storage?.local?.set({ [sessionKey]: session }, () => {
        console.log('[ProcessFlow] Agent box output updated in chrome.storage (fallback):', agentBoxId)

        chrome.runtime?.sendMessage({
          type: 'UPDATE_AGENT_BOX_OUTPUT',
          data: {
            agentBoxId,
            output: formattedOutput,
            allBoxes: session.agentBoxes
          }
        })

        resolve(true)
      })
    })
  })
}

/**
 * Get agent by ID
 */
export async function getAgentById(agentId: string): Promise<AgentConfig | null> {
  const agents = await loadAgentsFromSession()
  return agents.find(a => a.id === agentId) || null
}

export type BrainResolution =
  | { ok: true; model: string; isLocal: boolean; provider: string; note?: string }
  | { ok: false; model: string; isLocal: boolean; provider: string; error: string; errorType: BrainErrorType }

export type BrainErrorType =
  | 'no_provider'
  | 'no_model'
  | 'no_api_key'
  | 'cloud_not_implemented'
  | 'unknown_provider'

/**
 * Resolve which model to use for an agent's LLM call.
 * Uses canonical ProviderId constants — handles both normalized IDs
 * and legacy UI labels (e.g. 'Local AI') via toProviderId().
 * 
 * Returns a typed BrainResolution: ok:true with the model to use,
 * or ok:false with a user-visible error and errorType.
 * Never silently falls back to a different model.
 */
export function resolveModelForAgent(
  agentBoxProvider?: string,
  agentBoxModel?: string,
  fallbackModel?: string
): BrainResolution {
  const providerId = toProviderId(agentBoxProvider || '');

  if (!agentBoxProvider && !agentBoxModel) {
    return {
      ok: true,
      model: fallbackModel || '',
      isLocal: true,
      provider: PROVIDER_IDS.OLLAMA,
      note: 'No provider/model configured — using default local model'
    }
  }

  if (!agentBoxModel) {
    return {
      ok: true,
      model: fallbackModel || '',
      isLocal: true,
      provider: PROVIDER_IDS.OLLAMA,
      note: 'No model configured — using default local model'
    }
  }

  switch (providerId) {
    case PROVIDER_IDS.OLLAMA:
    case '':
      return {
        ok: true,
        model: agentBoxModel,
        isLocal: true,
        provider: PROVIDER_IDS.OLLAMA,
        note: `Using local model: ${agentBoxModel}`
      }

    case PROVIDER_IDS.OPENAI:
    case PROVIDER_IDS.ANTHROPIC:
    case PROVIDER_IDS.GEMINI:
    case PROVIDER_IDS.GROK: {
      const cloudModel = (!agentBoxModel || agentBoxModel === 'auto')
        ? (CLOUD_DEFAULT_MODELS[providerId as ProviderId] || agentBoxModel || 'auto')
        : agentBoxModel
      return {
        ok: true,
        model: cloudModel,
        isLocal: false,
        provider: providerId,
        note: `Cloud provider: ${toProviderLabel(providerId)} / ${cloudModel}`
      }
    }

    case PROVIDER_IDS.IMAGE_AI:
      return {
        ok: false,
        model: fallbackModel || '',
        isLocal: true,
        provider: providerId,
        error: 'Image AI is for image generation, not text chat. Select a different provider (Local AI, OpenAI, Claude, Gemini, or Grok) for this Agent Box.',
        errorType: 'cloud_not_implemented'
      }

    default:
      return {
        ok: false,
        model: fallbackModel || '',
        isLocal: true,
        provider: agentBoxProvider || '',
        error: `Unknown provider "${agentBoxProvider}". Check your Agent Box configuration.`,
        errorType: 'unknown_provider'
      }
  }
}

/**
 * Read a cloud provider's API key from chrome.storage.local.
 * Keys are synced there by the settings overlay in content-script.tsx.
 */
export function getCloudApiKey(provider: string): Promise<string | null> {
  return new Promise((resolve) => {
    const storageKeyName = PROVIDER_API_KEY_NAMES[provider as ProviderId] || provider
    chrome.storage?.local?.get(['optimando-cloud-api-keys'], (data: any) => {
      const keys = data?.['optimando-cloud-api-keys'] || {}
      const apiKey = keys[storageKeyName]
      resolve(apiKey && apiKey.trim() ? apiKey.trim() : null)
    })
  })
}

export type LlmRequestBody = {
  modelId: string
  messages: Array<{ role: string; content: string }>
  provider?: string
  apiKey?: string
}

/**
 * Build the JSON body for a /api/llm/chat request.
 * For cloud providers, reads the API key from storage and includes provider + apiKey.
 * Returns an error string if a cloud key is required but missing.
 */
export async function buildLlmRequestBody(
  modelResolution: BrainResolution & { ok: true },
  messages: Array<{ role: string; content: string }>
): Promise<{ body: LlmRequestBody; error?: string }> {
  const body: LlmRequestBody = { modelId: modelResolution.model, messages }

  if (modelResolution.isLocal) {
    return { body }
  }

  const apiKey = await getCloudApiKey(modelResolution.provider)
  if (!apiKey) {
    const label = toProviderLabel(modelResolution.provider)
    return {
      body,
      error: `No API key found for ${label}. Add your ${label} API key in Settings → API Keys, then try again.`
    }
  }

  body.provider = modelResolution.provider
  body.apiKey = apiKey
  return { body }
}
