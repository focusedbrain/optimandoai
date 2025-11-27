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
}

/**
 * Default singleton instance with debug logging enabled
 */
export const inputCoordinator = new InputCoordinator({ debug: true })

