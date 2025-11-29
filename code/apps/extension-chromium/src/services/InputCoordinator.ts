/**
 * Input Coordinator
 * 
 * Unified routing logic for the orchestrator. This consolidates the routing
 * decision-making that was previously split between processFlow.ts and
 * the automation/ListenerManager.
 * 
 * Forwarding Rules:
 * 1. Active trigger clicked (e.g., #tag17) -> Forward to matched agent
 * 2. Passive trigger pattern matched -> Forward to matched agent
 * 3. No listener active on agent -> Always forward to reasoning section
 * 4. No match and listener active -> Butler response only
 */

import type { AgentConfig, AgentBox, AgentMatch, RoutingDecision } from './processFlow'
import type { ClassifiedInput, AgentAllocation, AgentReasoning, OutputSlot } from '../nlp/types'
import type {
  EventTagRoutingResult,
  EventTagRoutingInput,
  EventTagRoutingBatch,
  ResolvedLlmConfig,
  ResolvedReasoningConfig,
  ResolvedExecutionConfig,
  OutputDestination,
  EventChannel,
  TriggerType,
  UnifiedTriggerConfig,
  EventTagCondition
} from '../automation/types'

/**
 * Configuration for the Input Coordinator
 */
export interface InputCoordinatorConfig {
  /** Whether to log debug information */
  debug?: boolean
}

/**
 * Result of evaluating an agent's listener configuration
 */
interface ListenerEvaluation {
  /** Whether this agent has any listener configured */
  hasListener: boolean
  /** Whether the listener is active (passiveEnabled or activeEnabled) */
  isListenerActive: boolean
  /** Whether input matches a passive trigger */
  matchesPassiveTrigger: boolean
  /** Whether input matches an active trigger */
  matchesActiveTrigger: boolean
  /** Whether input matches expected context */
  matchesExpectedContext: boolean
  /** Whether input matches applyFor criteria */
  matchesApplyFor: boolean
  /** Name of matched trigger if any */
  matchedTriggerName?: string
  /** Type of match */
  matchType: 'passive_trigger' | 'active_trigger' | 'expected_context' | 'apply_for' | 'no_listener' | 'none'
  /** Human-readable match details */
  matchDetails: string
}

/**
 * Input Coordinator - Central routing decision maker
 * 
 * Determines where user input should be sent based on:
 * - Agent listener configurations (passive/active triggers)
 * - Expected context matching
 * - ApplyFor input type matching
 * - Agent-to-AgentBox connections
 */
export class InputCoordinator {
  private debug: boolean

  constructor(config: InputCoordinatorConfig = {}) {
    this.debug = config.debug ?? false
  }

  /**
   * Log debug information if debug mode is enabled
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[InputCoordinator]', ...args)
    }
  }

  /**
   * Extract trigger patterns from input text
   * Looks for #TriggerName or #tag17 patterns (primary format)
   * Also supports @TriggerName for backward compatibility
   */
  extractTriggerPatterns(input: string): string[] {
    const patterns: string[] = []
    
    // Match #TriggerName or #tag17 patterns (primary format)
    const hashMatches = input.match(/#[\w-]+/g)
    if (hashMatches) {
      patterns.push(...hashMatches.map(m => m.substring(1)))
    }
    
    // Match @TriggerName patterns (backward compatibility)
    const atMatches = input.match(/@[\w-]+/g)
    if (atMatches) {
      patterns.push(...atMatches.map(m => m.substring(1)))
    }
    
    return patterns
  }

  /**
   * Check if input matches agent's expected context
   */
  private matchesExpectedContext(input: string, expectedContext: string | undefined): boolean {
    if (!expectedContext) return false
    
    const contextLower = expectedContext.toLowerCase()
    const inputLower = input.toLowerCase()
    
    // Split expected context into significant words (>3 chars) and check presence
    const keywords = contextLower.split(/[\s,;]+/).filter(w => w.length > 3)
    return keywords.some(keyword => inputLower.includes(keyword))
  }

  /**
   * Check if agent's applyFor matches the input type
   */
  private matchesApplyFor(
    applyFor: string | undefined,
    inputType: 'text' | 'image' | 'mixed',
    hasImage: boolean
  ): boolean {
    if (!applyFor || applyFor === '__any__') return true
    
    const applyForLower = applyFor.toLowerCase()
    
    if (applyForLower === 'text' && inputType === 'text') return true
    if (applyForLower === 'image' && (inputType === 'image' || hasImage)) return true
    if (applyForLower === 'mixed' && inputType === 'mixed') return true
    
    return false
  }

  /**
   * Check if URL matches the website filter
   */
  private matchesWebsiteFilter(currentUrl: string | undefined, websiteFilter: string | undefined): boolean {
    if (!websiteFilter) return true // No filter = always match
    if (!currentUrl) return false
    
    return currentUrl.toLowerCase().includes(websiteFilter.toLowerCase())
  }

  /**
   * Evaluate an agent's listener configuration against the input
   * 
   * This is the core decision logic for each agent:
   * - If no listener capability -> forward to reasoning (matchType = 'no_listener')
   * - If listener capability but no listener active -> forward to reasoning (matchType = 'no_listener')
   * - If listener active and trigger matches -> forward (matchType = trigger type)
   * - If listener active but no match -> don't forward (matchType = 'none')
   */
  evaluateAgentListener(
    agent: AgentConfig,
    input: string,
    inputType: 'text' | 'image' | 'mixed',
    hasImage: boolean,
    inputTriggers: string[],
    currentUrl?: string
  ): ListenerEvaluation {
    const listening = agent.listening
    const reasoning = agent.reasoning
    
    // Check if agent has listener capability
    const hasListenerCapability = agent.capabilities?.includes('listening') ?? false
    
    // Check if any listener mode is enabled
    const passiveEnabled = listening?.passiveEnabled ?? false
    const activeEnabled = listening?.activeEnabled ?? false
    const isListenerActive = passiveEnabled || activeEnabled
    
    this.log(`Agent "${agent.name}" - hasListenerCapability: ${hasListenerCapability}, isListenerActive: ${isListenerActive}`)

    // RULE: If no listener capability OR listener not active -> always forward to reasoning
    if (!hasListenerCapability || !isListenerActive) {
      return {
        hasListener: hasListenerCapability,
        isListenerActive: false,
        matchesPassiveTrigger: false,
        matchesActiveTrigger: false,
        matchesExpectedContext: false,
        matchesApplyFor: true,
        matchType: 'no_listener',
        matchDetails: 'No listener active - forwarding all input to reasoning section'
      }
    }

    // Website filter check (if set, must pass before trigger matching)
    if (listening?.website && !this.matchesWebsiteFilter(currentUrl, listening.website)) {
      this.log(`Agent "${agent.name}" rejected by website filter: ${listening.website}`)
      return {
        hasListener: true,
        isListenerActive: true,
        matchesPassiveTrigger: false,
        matchesActiveTrigger: false,
        matchesExpectedContext: false,
        matchesApplyFor: false,
        matchType: 'none',
        matchDetails: `Website filter "${listening.website}" not matched`
      }
    }

    // Check passive triggers
    if (passiveEnabled && listening?.passive?.triggers && inputTriggers.length > 0) {
      for (const trigger of listening.passive.triggers) {
        const triggerName = trigger.tag?.name
        if (triggerName && inputTriggers.some(t => 
          t.toLowerCase() === triggerName.toLowerCase()
        )) {
          this.log(`Agent "${agent.name}" matched passive trigger: #${triggerName}`)
          return {
            hasListener: true,
            isListenerActive: true,
            matchesPassiveTrigger: true,
            matchesActiveTrigger: false,
            matchesExpectedContext: false,
            matchesApplyFor: true,
            matchedTriggerName: triggerName,
            matchType: 'passive_trigger',
            matchDetails: `Passive trigger #${triggerName} matched`
          }
        }
      }
    }

    // Check active triggers
    if (activeEnabled && listening?.active?.triggers && inputTriggers.length > 0) {
      for (const trigger of listening.active.triggers) {
        const triggerName = trigger.tag?.name
        if (triggerName && inputTriggers.some(t => 
          t.toLowerCase() === triggerName.toLowerCase()
        )) {
          this.log(`Agent "${agent.name}" matched active trigger: #${triggerName}`)
          return {
            hasListener: true,
            isListenerActive: true,
            matchesPassiveTrigger: false,
            matchesActiveTrigger: true,
            matchesExpectedContext: false,
            matchesApplyFor: true,
            matchedTriggerName: triggerName,
            matchType: 'active_trigger',
            matchDetails: `Active trigger #${triggerName} matched`
          }
        }
      }
    }

    // Check expected context
    if (listening?.expectedContext && this.matchesExpectedContext(input, listening.expectedContext)) {
      this.log(`Agent "${agent.name}" matched expected context: ${listening.expectedContext}`)
      return {
        hasListener: true,
        isListenerActive: true,
        matchesPassiveTrigger: false,
        matchesActiveTrigger: false,
        matchesExpectedContext: true,
        matchesApplyFor: true,
        matchType: 'expected_context',
        matchDetails: `Expected context "${listening.expectedContext}" matched`
      }
    }

    // Check applyFor (reasoning section input type matching)
    if (reasoning?.applyFor && reasoning.applyFor !== '__any__') {
      if (this.matchesApplyFor(reasoning.applyFor, inputType, hasImage)) {
        this.log(`Agent "${agent.name}" matched applyFor: ${reasoning.applyFor}`)
        return {
          hasListener: true,
          isListenerActive: true,
          matchesPassiveTrigger: false,
          matchesActiveTrigger: false,
          matchesExpectedContext: false,
          matchesApplyFor: true,
          matchType: 'apply_for',
          matchDetails: `ApplyFor "${reasoning.applyFor}" matched input type "${inputType}"`
        }
      }
    }

    // No match found
    return {
      hasListener: true,
      isListenerActive: true,
      matchesPassiveTrigger: false,
      matchesActiveTrigger: false,
      matchesExpectedContext: false,
      matchesApplyFor: false,
      matchType: 'none',
      matchDetails: 'Listener active but no triggers/patterns matched'
    }
  }

  /**
   * Find agent boxes connected to an agent
   * 
   * Priority:
   * 1. Check execution.specialDestinations for explicit agentBox targets
   * 2. Check listener.reportTo for explicit destinations
   * 3. Fall back to matching agent.number with box.agentNumber
   */
  findAgentBoxesForAgent(agent: AgentConfig, agentBoxes: AgentBox[]): AgentBox[] {
    const matchedBoxes: AgentBox[] = []
    
    // 1. Check execution.specialDestinations for explicit agentBox targets
    const specialDestinations = (agent as any).execution?.specialDestinations || []
    for (const dest of specialDestinations) {
      if (dest.kind === 'agentBox') {
        // If agents array specifies specific boxes like ["agentBox01", "agentBox02"]
        if (dest.agents && dest.agents.length > 0) {
          for (const targetBox of dest.agents) {
            // Parse box number from "agentBox01", "box01", etc.
            const boxNumMatch = String(targetBox).match(/(\d+)/)
            if (boxNumMatch) {
              const targetBoxNum = parseInt(boxNumMatch[1], 10)
              const box = agentBoxes.find(b => b.boxNumber === targetBoxNum && b.enabled !== false)
              if (box && !matchedBoxes.some(mb => mb.id === box.id)) {
                this.log(`Agent "${agent.name}" → Explicit destination: Agent Box ${targetBoxNum}`)
                matchedBoxes.push(box)
              }
            }
          }
        } else {
          // Generic "agentBox" destination - use agent number matching
          this.log(`Agent "${agent.name}" has generic agentBox destination, using number matching`)
        }
      }
    }
    
    // 2. Check listener.reportTo for explicit destinations
    const reportTo = agent.listening?.reportTo || []
    for (const dest of reportTo) {
      // Parse destinations like "Agent Box 01", "agentBox01", etc.
      const boxNumMatch = String(dest).match(/(?:box|Box)\s*(\d+)/i)
      if (boxNumMatch) {
        const targetBoxNum = parseInt(boxNumMatch[1], 10)
        const box = agentBoxes.find(b => b.boxNumber === targetBoxNum && b.enabled !== false)
        if (box && !matchedBoxes.some(mb => mb.id === box.id)) {
          this.log(`Agent "${agent.name}" → ReportTo destination: Agent Box ${targetBoxNum}`)
          matchedBoxes.push(box)
        }
      }
    }
    
    // 3. Fall back to agent.number matching if no explicit destinations found
    if (matchedBoxes.length === 0 && agent.number) {
      const numberMatchedBoxes = agentBoxes.filter(box => {
        const boxAgentNum = box.agentNumber
        const matches = boxAgentNum === agent.number && box.enabled !== false
        return matches
      })
      
      if (numberMatchedBoxes.length > 0) {
        this.log(`Agent ${agent.number} (${agent.name}) → Number match: ${numberMatchedBoxes.map(b => `Box ${b.boxNumber}`).join(', ')}`)
        matchedBoxes.push(...numberMatchedBoxes)
      }
    }
    
    if (matchedBoxes.length === 0) {
      this.log(`Agent "${agent.name}" has no connected boxes (checked: specialDestinations, reportTo, number matching)`)
    }
    
    return matchedBoxes
  }

  /**
   * Route input to matching agents
   * 
   * Returns a list of AgentMatch objects for agents that should receive the input.
   * 
   * @param input - The user input text
   * @param inputType - Type of input (text, image, mixed)
   * @param hasImage - Whether an image is attached
   * @param agents - List of all agents
   * @param agentBoxes - List of all agent boxes
   * @param currentUrl - Current page URL for website filtering
   */
  routeToAgents(
    input: string,
    inputType: 'text' | 'image' | 'mixed',
    hasImage: boolean,
    agents: AgentConfig[],
    agentBoxes: AgentBox[],
    currentUrl?: string
  ): AgentMatch[] {
    const matches: AgentMatch[] = []
    const inputTriggers = this.extractTriggerPatterns(input)
    
    this.log('--- Input Coordination Start ---')
    this.log(`Input: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"`)
    this.log(`Type: ${inputType}, HasImage: ${hasImage}`)
    this.log(`Detected triggers: ${inputTriggers.length > 0 ? inputTriggers.join(', ') : '(none)'}`)
    this.log(`Agents: ${agents.length}, AgentBoxes: ${agentBoxes.length}`)

    for (const agent of agents) {
      // Skip disabled agents
      if (!agent.enabled) {
        this.log(`Skipping disabled agent: ${agent.name}`)
        continue
      }

      // Evaluate listener
      const evaluation = this.evaluateAgentListener(
        agent,
        input,
        inputType,
        hasImage,
        inputTriggers,
        currentUrl
      )

      // Determine if we should forward to this agent
      const shouldForward = evaluation.matchType !== 'none'
      
      if (shouldForward) {
        // Find connected agent boxes
        const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes)
        const firstBox = connectedBoxes[0]

        // Map matchType to matchReason
        let matchReason: AgentMatch['matchReason'] = 'default'
        if (evaluation.matchType === 'passive_trigger' || evaluation.matchType === 'active_trigger') {
          matchReason = 'trigger'
        } else if (evaluation.matchType === 'expected_context') {
          matchReason = 'expected_context'
        } else if (evaluation.matchType === 'apply_for') {
          matchReason = 'apply_for'
        } else if (evaluation.matchType === 'no_listener') {
          matchReason = 'default'
        }

        matches.push({
          agentId: agent.id,
          agentName: agent.name || agent.key || 'Unnamed Agent',
          agentIcon: agent.icon || '🤖',
          agentNumber: agent.number,
          matchReason,
          matchDetails: evaluation.matchDetails,
          triggerName: evaluation.matchedTriggerName,
          triggerType: evaluation.matchType === 'passive_trigger' ? 'passive' 
                     : evaluation.matchType === 'active_trigger' ? 'active' 
                     : undefined,
          outputLocation: firstBox 
            ? `Agent Box ${String(firstBox.boxNumber).padStart(2, '0')} (${firstBox.title || 'Untitled'})`
            : agent.listening?.reportTo?.[0] || 'Agent Box',
          agentBoxId: firstBox?.id,
          agentBoxNumber: firstBox?.boxNumber,
          agentBoxProvider: firstBox?.provider,
          agentBoxModel: firstBox?.model
        })
        
        this.log(`✓ Agent "${agent.name}" will receive input (${evaluation.matchType})`)
      } else {
        this.log(`✗ Agent "${agent.name}" will not receive input (${evaluation.matchType})`)
      }
    }

    // Remove duplicates (same agent matched multiple times - keep first)
    const uniqueMatches = matches.filter((match, index, self) =>
      index === self.findIndex(m => m.agentId === match.agentId)
    )
    
    this.log(`--- Input Coordination Result: ${uniqueMatches.length} agent(s) matched ---`)
    
    return uniqueMatches
  }

  /**
   * Generate a butler response for forwarding confirmation
   */
  generateForwardingResponse(matches: AgentMatch[]): string {
    if (matches.length === 0) return ''

    if (matches.length === 1) {
      const match = matches[0]
      let response = `I'm forwarding your request to ${match.agentIcon} **${match.agentName}**.\n`
      response += `→ ${match.matchDetails}\n`
      response += `→ Output will appear in: ${match.outputLocation}`
      if (match.agentBoxProvider && match.agentBoxModel) {
        response += `\n→ Using: ${match.agentBoxProvider} / ${match.agentBoxModel}`
      }
      return response
    }

    // Multiple agents matched
    let response = `Your request matches ${matches.length} agents:\n\n`
    for (const match of matches) {
      response += `${match.agentIcon} **${match.agentName}**\n`
      response += `   ${match.matchDetails}\n`
      response += `   → Output: ${match.outputLocation}\n\n`
    }
    response += `Processing with all matched agents...`
    
    return response
  }

  /**
   * Route ClassifiedInput to matching agents and populate agent allocations
   * 
   * This is the primary routing method for the NLP pipeline. It:
   * 1. Uses pre-extracted triggers from ClassifiedInput
   * 2. Matches against agent configurations
   * 3. Populates agentAllocations with full reasoning, LLM, and output info
   * 4. Returns the enriched ClassifiedInput ready for multi-agent dispatch
   * 
   * @param classifiedInput - The classified input from NLP
   * @param agents - List of all agents
   * @param agentBoxes - List of all agent boxes
   * @param fallbackModel - Default model if agent box has none
   * @param fallbackProvider - Default provider if agent box has none
   */
  routeClassifiedInput(
    classifiedInput: ClassifiedInput,
    agents: AgentConfig[],
    agentBoxes: AgentBox[],
    fallbackModel: string = 'llama3.2',
    fallbackProvider: string = 'ollama'
  ): ClassifiedInput {
    const allocations: AgentAllocation[] = []
    
    // Extract triggers WITHOUT the # prefix for matching (but keep original in triggers array)
    const inputTriggers = classifiedInput.triggers.map(t => 
      t.startsWith('#') ? t.substring(1) : t
    )
    
    // Determine input type
    const hasImage = classifiedInput.source === 'ocr' || 
                     classifiedInput.entities.some(e => e.type === 'url' && /\.(png|jpg|jpeg|gif|webp)$/i.test(e.value))
    const inputType: 'text' | 'image' | 'mixed' = hasImage ? 'mixed' : 'text'
    
    this.log('--- Classified Input Routing ---')
    this.log(`Raw text: "${classifiedInput.rawText.substring(0, 50)}${classifiedInput.rawText.length > 50 ? '...' : ''}"`)
    this.log(`Triggers: ${classifiedInput.triggers.join(', ') || '(none)'}`)
    this.log(`Entities: ${classifiedInput.entities.length}`)

    for (const agent of agents) {
      // Skip disabled agents
      if (!agent.enabled) {
        continue
      }

      // Evaluate listener against classified input
      const evaluation = this.evaluateAgentListener(
        agent,
        classifiedInput.rawText,
        inputType,
        hasImage,
        inputTriggers,
        classifiedInput.sourceUrl
      )

      // Only allocate if matched
      if (evaluation.matchType === 'none') {
        continue
      }

      // Find connected agent boxes
      const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes)
      const primaryBox = connectedBoxes[0]

      // Build reasoning from agent config
      const reasoning: AgentReasoning = {
        goals: agent.reasoning?.goals || '',
        role: agent.reasoning?.role || '',
        rules: agent.reasoning?.rules || '',
        custom: agent.reasoning?.custom || [],
        applyFor: agent.reasoning?.applyFor
      }

      // Build output slot
      const outputSlot: OutputSlot = {
        boxId: primaryBox?.id,
        boxNumber: primaryBox?.boxNumber,
        destination: primaryBox 
          ? `Agent Box ${String(primaryBox.boxNumber).padStart(2, '0')}`
          : agent.listening?.reportTo?.[0] || 'Inline Chat',
        title: primaryBox?.title
      }

      // Determine match reason
      let matchReason: AgentAllocation['matchReason'] = 'default'
      if (evaluation.matchType === 'passive_trigger' || evaluation.matchType === 'active_trigger') {
        matchReason = 'trigger'
      } else if (evaluation.matchType === 'expected_context') {
        matchReason = 'expected_context'
      } else if (evaluation.matchType === 'apply_for') {
        matchReason = 'apply_for'
      }

      // Create allocation
      const allocation: AgentAllocation = {
        agentId: agent.id,
        agentName: agent.name || agent.key || 'Unnamed Agent',
        agentIcon: agent.icon || '🤖',
        agentNumber: agent.number,
        reasoning,
        llmProvider: primaryBox?.provider || fallbackProvider,
        llmModel: primaryBox?.model || fallbackModel,
        outputSlot,
        matchReason,
        matchDetails: evaluation.matchDetails,
        triggerName: evaluation.matchedTriggerName,
        triggerType: evaluation.matchType === 'passive_trigger' ? 'passive'
                   : evaluation.matchType === 'active_trigger' ? 'active'
                   : undefined
      }

      allocations.push(allocation)
      this.log(`✓ Allocated agent "${agent.name}" → ${outputSlot.destination} (${allocation.llmProvider}/${allocation.llmModel})`)
    }

    // Remove duplicates (keep first occurrence)
    const uniqueAllocations = allocations.filter((alloc, index, self) =>
      index === self.findIndex(a => a.agentId === alloc.agentId)
    )

    this.log(`--- Routing Result: ${uniqueAllocations.length} agent(s) allocated ---`)

    // Return enriched ClassifiedInput
    return {
      ...classifiedInput,
      agentAllocations: uniqueAllocations
    }
  }

  /**
   * Generate a butler response from ClassifiedInput with allocations
   */
  generateForwardingResponseFromClassified(classifiedInput: ClassifiedInput): string {
    const allocations = classifiedInput.agentAllocations || []
    if (allocations.length === 0) return ''

    if (allocations.length === 1) {
      const alloc = allocations[0]
      let response = `I'm forwarding your request to ${alloc.agentIcon} **${alloc.agentName}**.\n`
      response += `→ ${alloc.matchDetails}\n`
      response += `→ Output will appear in: ${alloc.outputSlot.destination}`
      response += `\n→ Using: ${alloc.llmProvider} / ${alloc.llmModel}`
      return response
    }

    // Multiple agents allocated
    let response = `Your request matches ${allocations.length} agents:\n\n`
    for (const alloc of allocations) {
      response += `${alloc.agentIcon} **${alloc.agentName}**\n`
      response += `   ${alloc.matchDetails}\n`
      response += `   → Output: ${alloc.outputSlot.destination}\n`
      response += `   → Model: ${alloc.llmProvider}/${alloc.llmModel}\n\n`
    }
    response += `Processing with all matched agents...`
    
    return response
  }

  // =============================================================================
  // Event Tag Routing - Complete Flow Implementation
  // =============================================================================

  /**
   * Route Event Tag triggers through the complete flow:
   * 
   * 1. WR Chat input → NLP parsing → ClassifiedInput with #tags
   * 2. Check all agents' listeners in session for matching triggers
   * 3. Evaluate eventTagConditions (WRCode, sender whitelist, keywords, website)
   * 4. Collect sensor workflow context
   * 5. Resolve LLM from connected Agent Box
   * 6. Determine which Reasoning section applies (via applyFor)
   * 7. Determine which Execution section applies (via applyFor)
   * 8. Resolve output destinations from "Report to"
   * 
   * @param input - The routing input containing classified input, agents, and agent boxes
   * @returns Batch result with all matched agents and their resolved configurations
   */
  routeEventTagTrigger(input: EventTagRoutingInput): EventTagRoutingBatch {
    const startTime = Date.now()
    const results: EventTagRoutingResult[] = []
    
    const { classifiedInput, agents, agentBoxes, currentUrl, sessionKey } = input
    
    // Extract triggers from the classified input (without # prefix for matching)
    const triggersFound = classifiedInput.triggers || []
    const triggerNames = triggersFound.map(t => t.startsWith('#') ? t.substring(1) : t)
    
    this.log('=== Event Tag Routing Start ===')
    this.log(`Input: "${classifiedInput.rawText.substring(0, 50)}${classifiedInput.rawText.length > 50 ? '...' : ''}"`)
    this.log(`Triggers found: ${triggersFound.length > 0 ? triggersFound.join(', ') : '(none)'}`)
    this.log(`Agents to check: ${agents.length}`)
    
    let agentsWithListeners = 0
    let agentsMatched = 0
    let agentsSkipped = 0
    
    // Process each agent
    for (const agent of agents) {
      // Skip disabled agents
      if (!agent.enabled) {
        agentsSkipped++
        this.log(`⊘ Skipping disabled agent: ${agent.name}`)
        continue
      }
      
      // Check if agent has any event tag triggers
      const eventTagTriggers = this.extractEventTagTriggers(agent)
      
      if (eventTagTriggers.length === 0) {
        // Agent has no event tag listeners - skip for this routing type
        this.log(`⊘ Agent "${agent.name}" has no event tag triggers`)
        agentsSkipped++
        continue
      }
      
      agentsWithListeners++
      
      // Check each trigger for a match
      for (const trigger of eventTagTriggers) {
        const triggerTag = trigger.tag?.replace('#', '') || trigger.tagName || ''
        
        if (!triggerTag) continue
        
        // Check if any input trigger matches this agent's trigger
        const isMatch = triggerNames.some(t => 
          t.toLowerCase() === triggerTag.toLowerCase()
        )
        
        if (!isMatch) continue
        
        this.log(`✓ Trigger match: #${triggerTag} for agent "${agent.name}"`)
        
        // Evaluate event tag conditions
        const conditionResults = this.evaluateEventTagConditions(
          trigger,
          classifiedInput,
          currentUrl
        )
        
        if (!conditionResults.allPassed) {
          this.log(`✗ Conditions not met for agent "${agent.name}": ${conditionResults.conditions.map(c => `${c.type}:${c.passed}`).join(', ')}`)
          continue
        }
        
        agentsMatched++
        
        // Resolve LLM from connected Agent Box
        const llmConfig = this.resolveLlmFromAgentBox(agent, agentBoxes)
        
        // Resolve reasoning configuration
        const reasoningConfig = this.resolveReasoningConfig(agent, trigger)
        
        // Resolve execution configuration
        const executionConfig = this.resolveExecutionConfig(agent, trigger, agentBoxes)
        
        // Build the routing result
        const result: EventTagRoutingResult = {
          matched: true,
          agentId: agent.id,
          agentName: agent.name || agent.key || 'Unnamed Agent',
          agentIcon: '🤖', // Default icon
          agentNumber: agent.number,
          trigger: {
            id: trigger.id || `ID#${triggerTag}`,
            type: (trigger.type as TriggerType) || 'direct_tag',
            tag: `#${triggerTag}`,
            channel: (trigger.channel as EventChannel) || 'chat'
          },
          conditionResults,
          sensorContext: {}, // Will be populated by sensor workflows
          llmConfig,
          reasoningConfig,
          executionConfig,
          matchDetails: `Event tag #${triggerTag} matched in ${trigger.channel || 'chat'} channel`,
          timestamp: Date.now()
        }
        
        results.push(result)
        this.log(`✓ Agent "${agent.name}" routed: LLM=${llmConfig.provider}/${llmConfig.model}, ReportTo=${executionConfig.reportTo.map(r => r.label).join(', ')}`)
        
        // Only match first trigger per agent to avoid duplicates
        break
      }
    }
    
    this.log(`=== Event Tag Routing Complete: ${results.length} match(es) ===`)
    
    return {
      results,
      summary: {
        totalAgentsChecked: agents.length,
        agentsWithListeners,
        agentsMatched,
        agentsSkipped
      },
      originalInput: classifiedInput.rawText,
      triggersFound,
      processingTimeMs: Date.now() - startTime
    }
  }

  /**
   * Extract event tag triggers from an agent's configuration
   */
  private extractEventTagTriggers(agent: any): any[] {
    const triggers: any[] = []
    const listening = agent.listening
    
    if (!listening) return triggers
    
    // Check unified triggers format (new)
    if (listening.triggers && Array.isArray(listening.triggers)) {
      const eventTagTriggers = listening.triggers.filter((t: any) => 
        t.type === 'direct_tag' || t.type === 'tag_and_condition'
      )
      triggers.push(...eventTagTriggers)
    }
    
    // Check legacy passive triggers
    if (listening.passiveEnabled && listening.passive?.triggers) {
      for (const t of listening.passive.triggers) {
        if (t.tag?.name) {
          triggers.push({
            type: 'direct_tag',
            tag: t.tag.name,
            tagName: t.tag.name,
            channel: listening.source || 'chat',
            enabled: true
          })
        }
      }
    }
    
    // Check legacy active triggers
    if (listening.activeEnabled && listening.active?.triggers) {
      for (const t of listening.active.triggers) {
        if (t.tag?.name) {
          triggers.push({
            type: 'direct_tag',
            tag: t.tag.name,
            tagName: t.tag.name,
            channel: listening.source || 'chat',
            enabled: true
          })
        }
      }
    }
    
    return triggers
  }

  /**
   * Evaluate event tag conditions (WRCode, sender whitelist, keywords, website)
   */
  private evaluateEventTagConditions(
    trigger: any,
    classifiedInput: EventTagRoutingInput['classifiedInput'],
    currentUrl?: string
  ): EventTagRoutingResult['conditionResults'] {
    const conditions: Array<{ type: string; passed: boolean; details: string }> = []
    let allPassed = true
    
    const eventTagConditions = trigger.eventTagConditions || []
    
    for (const condition of eventTagConditions) {
      let passed = true
      let details = ''
      
      switch (condition.type) {
        case 'wrcode_valid':
          // WRCode validation - check if email has valid WRCode stamp
          // For now, skip if not required or if not an email channel
          if (condition.required) {
            // In a real implementation, this would check the WRCode validation result
            passed = true // Placeholder - would check classifiedInput metadata
            details = passed ? 'WRCode validation passed' : 'WRCode validation required but not present'
          } else {
            passed = true
            details = 'WRCode not required'
          }
          break
          
        case 'sender_whitelist':
          // Sender whitelist - only for email channel
          if (condition.allowedSenders && condition.allowedSenders.length > 0) {
            // Would check against sender address from classifiedInput
            passed = true // Placeholder
            details = `Sender whitelist check (${condition.allowedSenders.length} addresses)`
          } else {
            passed = true
            details = 'No sender whitelist configured'
          }
          break
          
        case 'body_keywords':
          // Keyword matching in the input text
          if (condition.keywords && condition.keywords.length > 0) {
            const searchText = classifiedInput.rawText.toLowerCase()
            const matchedKeyword = condition.keywords.find((kw: string) => 
              searchText.includes(kw.toLowerCase())
            )
            passed = !!matchedKeyword
            details = passed 
              ? `Keyword "${matchedKeyword}" found` 
              : `None of ${condition.keywords.length} keywords found`
          } else {
            passed = true
            details = 'No keywords configured'
          }
          break
          
        case 'website_filter':
          // Website/URL pattern matching
          if (condition.patterns && condition.patterns.length > 0 && currentUrl) {
            const matchedPattern = condition.patterns.find((pattern: string) => {
              const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i')
              return regex.test(currentUrl)
            })
            passed = !!matchedPattern
            details = passed 
              ? `URL matches pattern "${matchedPattern}"` 
              : `URL ${currentUrl} doesn't match any patterns`
          } else if (!currentUrl) {
            passed = true
            details = 'No URL context available'
          } else {
            passed = true
            details = 'No website filter configured'
          }
          break
          
        default:
          passed = true
          details = `Unknown condition type: ${condition.type}`
      }
      
      conditions.push({ type: condition.type, passed, details })
      if (!passed) allPassed = false
    }
    
    // Also check legacy expectedContext if present
    if (trigger.expectedContext && !eventTagConditions.some((c: any) => c.type === 'body_keywords')) {
      const keywords = trigger.expectedContext.split(',').map((k: string) => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const searchText = classifiedInput.rawText.toLowerCase()
        const matchedKeyword = keywords.find((kw: string) => searchText.includes(kw.toLowerCase()))
        const passed = !!matchedKeyword
        conditions.push({
          type: 'body_keywords',
          passed,
          details: passed ? `Context keyword "${matchedKeyword}" found` : `None of ${keywords.length} context keywords found`
        })
        if (!passed) allPassed = false
      }
    }
    
    // If no conditions, all pass by default
    if (conditions.length === 0) {
      conditions.push({ type: 'none', passed: true, details: 'No conditions configured' })
    }
    
    return { allPassed, conditions }
  }

  /**
   * Resolve LLM configuration from the agent's connected Agent Box
   */
  private resolveLlmFromAgentBox(
    agent: any,
    agentBoxes: EventTagRoutingInput['agentBoxes']
  ): ResolvedLlmConfig {
    // Find agent boxes connected to this agent
    const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes as AgentBox[])
    
    const primaryBox = connectedBoxes.find(box => box.enabled !== false)
    
    if (primaryBox && primaryBox.provider && primaryBox.model) {
      return {
        provider: primaryBox.provider,
        model: primaryBox.model,
        agentBoxId: primaryBox.id,
        agentBoxNumber: primaryBox.boxNumber,
        agentBoxTitle: primaryBox.title,
        isAvailable: true
      }
    }
    
    // Fallback to default Ollama if no box configured
    return {
      provider: 'ollama',
      model: 'llama3.2',
      agentBoxId: primaryBox?.id || '',
      agentBoxNumber: primaryBox?.boxNumber || 0,
      agentBoxTitle: primaryBox?.title,
      isAvailable: primaryBox ? true : false,
      unavailableReason: primaryBox ? undefined : 'No Agent Box connected to this agent'
    }
  }

  /**
   * Resolve reasoning configuration for an agent
   * Checks which reasoning section applies based on applyFor
   */
  private resolveReasoningConfig(
    agent: any,
    trigger: any
  ): ResolvedReasoningConfig {
    const reasoning = agent.reasoning || {}
    const triggerId = trigger.id || `ID#${trigger.tag?.replace('#', '') || trigger.tagName || ''}`
    
    // Check if there are multiple reasoning sections
    const reasoningSections = reasoning.sections || []
    
    // Find the section that applies to this trigger
    let applicableSection = reasoningSections.find((section: any) => {
      const applyForList = section.applyForList || [section.applyFor || '__any__']
      return applyForList.includes(triggerId) || applyForList.includes('__any__')
    })
    
    // If no matching section, use the main reasoning config
    if (!applicableSection) {
      applicableSection = reasoning
    }
    
    return {
      applyFor: applicableSection.applyFor || '__any__',
      goals: applicableSection.goals || reasoning.goals || '',
      role: applicableSection.role || reasoning.role || '',
      rules: applicableSection.rules || reasoning.rules || '',
      custom: applicableSection.custom || reasoning.custom || [],
      memoryContext: {
        sessionContext: {
          read: applicableSection.memoryContext?.sessionContext?.read ?? false,
          write: applicableSection.memoryContext?.sessionContext?.write ?? false
        },
        accountMemory: {
          read: applicableSection.memoryContext?.accountMemory?.read ?? false,
          write: applicableSection.memoryContext?.accountMemory?.write ?? false
        },
        agentMemory: { enabled: true }
      },
      reasoningWorkflows: applicableSection.reasoningWorkflows || []
    }
  }

  /**
   * Resolve execution configuration for an agent
   * Checks which execution section applies and resolves report destinations
   */
  private resolveExecutionConfig(
    agent: any,
    trigger: any,
    agentBoxes: EventTagRoutingInput['agentBoxes']
  ): ResolvedExecutionConfig {
    const execution = agent.execution || {}
    const triggerId = trigger.id || `ID#${trigger.tag?.replace('#', '') || trigger.tagName || ''}`
    
    // Check if there are multiple execution sections
    const executionSections = execution.executionSections || []
    
    // Find the section that applies to this trigger
    let applicableSection = executionSections.find((section: any) => {
      const applyForList = section.applyForList || [section.applyFor || '__any__']
      return applyForList.includes(triggerId) || applyForList.includes('__any__')
    })
    
    // If no matching section, use the main execution config
    if (!applicableSection) {
      applicableSection = execution
    }
    
    // Resolve report destinations
    const reportTo: OutputDestination[] = []
    
    // Check specialDestinations
    const specialDestinations = applicableSection.specialDestinations || execution.specialDestinations || []
    
    for (const dest of specialDestinations) {
      if (dest.kind === 'agentBox') {
        // Resolve specific agent boxes
        if (dest.agents && dest.agents.length > 0) {
          for (const boxRef of dest.agents) {
            const boxNumMatch = String(boxRef).match(/(\d+)/)
            if (boxNumMatch) {
              const boxNum = parseInt(boxNumMatch[1], 10)
              const box = agentBoxes.find(b => b.boxNumber === boxNum)
              if (box) {
                reportTo.push({
                  kind: 'agent_box',
                  agentBoxId: box.id,
                  agentBoxNumber: box.boxNumber,
                  label: `Agent Box ${String(box.boxNumber).padStart(2, '0')}${box.title ? ` (${box.title})` : ''}`,
                  enabled: box.enabled !== false
                })
              }
            }
          }
        } else {
          // Generic agent box - use agent's connected box
          const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes as AgentBox[])
          for (const box of connectedBoxes) {
            reportTo.push({
              kind: 'agent_box',
              agentBoxId: box.id,
              agentBoxNumber: box.boxNumber,
              label: `Agent Box ${String(box.boxNumber).padStart(2, '0')}${box.title ? ` (${box.title})` : ''}`,
              enabled: box.enabled !== false
            })
          }
        }
      } else if (dest.kind === 'wrChat' || dest.kind === 'commandChat') {
        reportTo.push({
          kind: 'wr_chat',
          label: 'WR Chat (Command Chat)',
          enabled: true
        })
      } else if (dest.kind === 'inlineChat') {
        reportTo.push({
          kind: 'inline_chat',
          label: 'Inline Chat',
          enabled: true
        })
      }
    }
    
    // Check legacy reportTo in listening section
    const listenerReportTo = agent.listening?.reportTo || []
    for (const dest of listenerReportTo) {
      const boxNumMatch = String(dest).match(/(?:box|Box)\s*(\d+)/i)
      if (boxNumMatch) {
        const boxNum = parseInt(boxNumMatch[1], 10)
        const box = agentBoxes.find(b => b.boxNumber === boxNum)
        if (box && !reportTo.some(r => r.agentBoxId === box.id)) {
          reportTo.push({
            kind: 'agent_box',
            agentBoxId: box.id,
            agentBoxNumber: box.boxNumber,
            label: `Agent Box ${String(box.boxNumber).padStart(2, '0')}${box.title ? ` (${box.title})` : ''}`,
            enabled: box.enabled !== false
          })
        }
      }
    }
    
    // Default to agent's connected box if no explicit reportTo
    if (reportTo.length === 0) {
      const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes as AgentBox[])
      for (const box of connectedBoxes) {
        reportTo.push({
          kind: 'agent_box',
          agentBoxId: box.id,
          agentBoxNumber: box.boxNumber,
          label: `Agent Box ${String(box.boxNumber).padStart(2, '0')}${box.title ? ` (${box.title})` : ''}`,
          enabled: box.enabled !== false
        })
      }
    }
    
    // If still no destinations, default to inline chat
    if (reportTo.length === 0) {
      reportTo.push({
        kind: 'inline_chat',
        label: 'Inline Chat',
        enabled: true
      })
    }
    
    return {
      applyFor: applicableSection.applyFor || '__any__',
      workflows: applicableSection.workflows || execution.workflows || [],
      reportTo
    }
  }

  /**
   * Run sensor workflows and collect context
   * This is called after trigger matching but before reasoning
   */
  async collectSensorContext(
    agent: any,
    classifiedInput: EventTagRoutingInput['classifiedInput']
  ): Promise<Record<string, any>> {
    const sensorContext: Record<string, any> = {}
    
    const listening = agent.listening || {}
    const sensorWorkflows = listening.sensorWorkflows || []
    
    if (sensorWorkflows.length === 0) {
      return sensorContext
    }
    
    this.log(`Running ${sensorWorkflows.length} sensor workflow(s) for agent "${agent.name}"`)
    
    // In a real implementation, this would execute each sensor workflow
    // and collect their outputs into the context
    for (const workflowId of sensorWorkflows) {
      try {
        // Placeholder - actual workflow execution would happen here
        sensorContext[workflowId] = {
          status: 'pending',
          note: 'Sensor workflow execution not yet implemented'
        }
      } catch (error) {
        sensorContext[workflowId] = {
          status: 'error',
          error: String(error)
        }
      }
    }
    
    return sensorContext
  }

  /**
   * Generate a summary response for the routing results
   */
  generateRoutingSummary(batch: EventTagRoutingBatch): string {
    if (batch.results.length === 0) {
      return ''
    }
    
    if (batch.results.length === 1) {
      const result = batch.results[0]
      let summary = `Routing to ${result.agentIcon} **${result.agentName}**\n`
      summary += `→ Trigger: ${result.trigger.tag} (${result.trigger.channel})\n`
      summary += `→ LLM: ${result.llmConfig.provider}/${result.llmConfig.model}\n`
      summary += `→ Output: ${result.executionConfig.reportTo.map(r => r.label).join(', ')}`
      return summary
    }
    
    let summary = `Your request matches ${batch.results.length} agents:\n\n`
    for (const result of batch.results) {
      summary += `${result.agentIcon} **${result.agentName}**\n`
      summary += `   Trigger: ${result.trigger.tag}\n`
      summary += `   LLM: ${result.llmConfig.provider}/${result.llmConfig.model}\n`
      summary += `   → ${result.executionConfig.reportTo.map(r => r.label).join(', ')}\n\n`
    }
    
    return summary
  }
}

/**
 * Default singleton instance
 */
export const inputCoordinator = new InputCoordinator({ debug: false })

