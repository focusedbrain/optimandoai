/// <reference types="chrome-types"/>

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
  matchReason: 'trigger' | 'expected_context' | 'apply_for' | 'default'
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
 */
export async function loadAgentsFromSession(): Promise<AgentConfig[]> {
  try {
    // Get session key using async method (more reliable in extension context)
    const sessionKey = await getCurrentSessionKeyAsync()
    
    if (!sessionKey) {
      console.warn('[ProcessFlow] No session key found - cannot load agents')
      return []
    }
    
    console.log('[ProcessFlow] Loading agents from session:', sessionKey)

    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get([sessionKey], (data: any) => {
          const session = data?.[sessionKey]
          if (!session) {
            console.warn('[ProcessFlow] No session data found for key:', sessionKey)
            resolve([])
            return
          }

          // Get agents from session
          const agents: AgentConfig[] = session.agents || []
          
          console.log('[ProcessFlow] Found', agents.length, 'agents in session')
          
          // Parse agent configs and extract proper number
          const parsedAgents = agents.map((agent, index) => {
            let parsed = { ...agent }
            
            // Debug: Log what config data exists for this agent
            console.log(`[ProcessFlow] Agent ${index}: "${agent.name || agent.key}"`, {
              hasConfig: !!agent.config,
              configKeys: agent.config ? Object.keys(agent.config) : [],
              hasInstructions: !!agent.config?.instructions,
              instructionsType: agent.config?.instructions ? typeof agent.config.instructions : 'none',
              enabled: agent.enabled
            })
            
            // Parse config.instructions if it's a string
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
                  triggers: instructions.listening?.passive?.triggers?.length || 0,
                  activeTriggers: instructions.listening?.active?.triggers?.length || 0
                })
              } catch (e) {
                console.warn('[ProcessFlow] Failed to parse agent config:', e)
              }
            } else {
              console.warn(`[ProcessFlow] ⚠️ Agent "${agent.name || agent.key}" has NO config.instructions!`)
            }
            
            // Extract proper agent number
            parsed.number = extractAgentNumber(parsed, index)
            
            console.log(`[ProcessFlow] Agent "${parsed.name || parsed.key}": number=${parsed.number}, key=${parsed.key}, id=${parsed.id}, enabled=${parsed.enabled}`)
            
            return parsed
          })

          resolve(parsedAgents)
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to load agents:', e)
        resolve([])
      }
    })
  } catch (e) {
    console.warn('[ProcessFlow] Error in loadAgentsFromSession:', e)
    return []
  }
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
 * Load agent boxes from the current session
 */
export async function loadAgentBoxesFromSession(): Promise<AgentBox[]> {
  try {
    // Get session key using async method (more reliable in extension context)
    const sessionKey = await getCurrentSessionKeyAsync()

    if (!sessionKey) {
      console.warn('[ProcessFlow] No session key found - cannot load agent boxes')
      return []
    }
    
    console.log('[ProcessFlow] Loading agent boxes from session:', sessionKey)

    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get([sessionKey], (data: any) => {
          const session = data?.[sessionKey]
          if (!session) {
            console.warn('[ProcessFlow] No session data found for key:', sessionKey)
            resolve([])
            return
          }

          const agentBoxes: AgentBox[] = session.agentBoxes || []
          
          console.log('[ProcessFlow] Found', agentBoxes.length, 'agent boxes in session')
          
          // Normalize agent box data and extract agent numbers
          const normalizedBoxes = agentBoxes.map((box, index) => {
            const normalized = { ...box }
            
            // Ensure boxNumber is set
            if (normalized.boxNumber === undefined) {
              normalized.boxNumber = index + 1
            }
            
            // Extract agent number using the comprehensive extractor
            const extractedAgentNum = extractBoxAgentNumber(box)
            if (extractedAgentNum !== undefined) {
              normalized.agentNumber = extractedAgentNum
            }
            
            console.log(`[ProcessFlow] AgentBox ${normalized.boxNumber}:`, {
              id: normalized.id,
              title: normalized.title,
              agentNumber: normalized.agentNumber ?? '(none)',
              provider: normalized.provider ?? '(none)',
              model: normalized.model ?? '(none)',
              enabled: normalized.enabled !== false
            })
            
            return normalized
          })
          
          // Log wiring summary
          const connectedBoxes = normalizedBoxes.filter(b => b.agentNumber !== undefined)
          console.log(`[ProcessFlow] AgentBox wiring summary: ${connectedBoxes.length}/${normalizedBoxes.length} boxes connected to agents`)
          
          resolve(normalizedBoxes)
        })
      } catch (e) {
        console.warn('[ProcessFlow] Failed to load agent boxes:', e)
        resolve([])
      }
    })
  } catch (e) {
    console.warn('[ProcessFlow] Error in loadAgentBoxesFromSession:', e)
    return []
  }
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
 * Update agent box output in session storage
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

    return new Promise((resolve) => {
      chrome.storage?.local?.get([sessionKey], (data: any) => {
        const session = data?.[sessionKey]
        if (!session || !session.agentBoxes) {
          resolve(false)
          return
        }

        // Find and update the agent box
        const boxIndex = session.agentBoxes.findIndex((b: AgentBox) => b.id === agentBoxId)
        if (boxIndex === -1) {
          resolve(false)
          return
        }

        // Format output with reasoning context if provided
        let formattedOutput = output
        if (reasoningContext) {
          formattedOutput = `📋 **Reasoning Context:**\n${reasoningContext}\n\n---\n\n**Response:**\n${output}`
        }

        session.agentBoxes[boxIndex].output = formattedOutput
        session.agentBoxes[boxIndex].lastUpdated = new Date().toISOString()

        // Save back to storage
        chrome.storage?.local?.set({ [sessionKey]: session }, () => {
          console.log('[ProcessFlow] Agent box output updated:', agentBoxId)
          
          // Notify sidepanel of update
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
  } catch (e) {
    console.error('[ProcessFlow] Failed to update agent box output:', e)
    return false
  }
}

/**
 * Get agent by ID
 */
export async function getAgentById(agentId: string): Promise<AgentConfig | null> {
  const agents = await loadAgentsFromSession()
  return agents.find(a => a.id === agentId) || null
}

/**
 * Check if a model is available for use
 * For now, only local Ollama models are supported
 * Returns the model to use (agentBoxModel if local, or fallback)
 */
export function resolveModelForAgent(
  agentBoxProvider?: string,
  agentBoxModel?: string,
  fallbackModel?: string
): { model: string; isLocal: boolean; note?: string } {
  // If no agent box model configured, use fallback
  if (!agentBoxProvider || !agentBoxModel) {
    return { 
      model: fallbackModel || '', 
      isLocal: true,
      note: 'Using default local model'
    }
  }
  
  // For now, only local Ollama models are supported
  // In the future, this will check API availability
  const localProviders = ['ollama', 'local', '']
  const isLocal = localProviders.includes(agentBoxProvider.toLowerCase())
  
  if (isLocal) {
    // Use the configured local model if it's an Ollama model
    return { 
      model: agentBoxModel, 
      isLocal: true,
      note: `Using local model: ${agentBoxModel}`
    }
  }
  
  // External API providers (OpenAI, Claude, etc.) - not yet supported
  // Fall back to local model
  return { 
    model: fallbackModel || '', 
    isLocal: true,
    note: `${agentBoxProvider} API not yet connected - using local model`
  }
}
