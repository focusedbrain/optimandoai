/**
 * Input Coordinator
 * 
 * Unified routing logic for the orchestrator. This consolidates the routing
 * decision-making that was previously split between processFlow.ts and
 * the automation/ListenerManager.
 * 
 * Strict Chain: Listener -> Reasoning -> Execution
 * 1. Active trigger clicked (e.g., #tag17) -> Forward to matched agent
 * 2. Passive trigger pattern matched -> Forward to matched agent
 * 3. No active listener on agent -> REJECT (agent does not receive external input)
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
  /** Name of matched trigger if any (first match for backward compatibility) */
  matchedTriggerName?: string
  /** ALL matched trigger names */
  matchedTriggerNames?: string[]
  /** Type of match — only Listener-derived match types are valid */
  matchType: 'passive_trigger' | 'active_trigger' | 'expected_context' | 'none'
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
   * Check if trigger's keyword conditions are met
   * Returns { valid: boolean, matchedKeyword?: string }
   * - valid=true if no keywords configured OR at least one keyword found
   * - matchedKeyword contains the first keyword that was found (for display)
   */
  private checkTriggerKeywords(trigger: any, input: string): { valid: boolean; matchedKeyword?: string } {
    const inputLower = input.toLowerCase()
    
    // Check eventTagConditions for body_keywords
    if (trigger.eventTagConditions && Array.isArray(trigger.eventTagConditions)) {
      const keywordCondition = trigger.eventTagConditions.find((c: any) => c.type === 'body_keywords')
      if (keywordCondition && keywordCondition.keywords && keywordCondition.keywords.length > 0) {
        const matchedKeyword = keywordCondition.keywords.find((kw: string) => 
          inputLower.includes(kw.toLowerCase())
        )
        this.log(`Keyword check (eventTagConditions): keywords=${keywordCondition.keywords.join(',')}, matched=${matchedKeyword || 'none'}`)
        return { valid: !!matchedKeyword, matchedKeyword }
      }
    }
    
    // Check trigger.keywords (string, comma-separated)
    if (trigger.keywords && typeof trigger.keywords === 'string' && trigger.keywords.trim()) {
      const keywords = trigger.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const matchedKeyword = keywords.find((kw: string) => inputLower.includes(kw.toLowerCase()))
        this.log(`Keyword check (trigger.keywords): keywords=${keywords.join(',')}, matched=${matchedKeyword || 'none'}`)
        return { valid: !!matchedKeyword, matchedKeyword }
      }
    }
    
    // Check trigger.expectedContext (legacy, comma-separated)
    if (trigger.expectedContext && typeof trigger.expectedContext === 'string' && trigger.expectedContext.trim()) {
      const keywords = trigger.expectedContext.split(',').map((k: string) => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const matchedKeyword = keywords.find((kw: string) => inputLower.includes(kw.toLowerCase()))
        this.log(`Keyword check (expectedContext): keywords=${keywords.join(',')}, matched=${matchedKeyword || 'none'}`)
        return { valid: !!matchedKeyword, matchedKeyword }
      }
    }
    
    // No keywords configured = always match (no keyword to display)
    return { valid: true }
  }

  /**
   * Evaluate an agent's listener configuration against the input
   * 
   * STRICT CHAIN ENFORCEMENT: Listener -> Reasoning -> Execution
   * 
   * Only the Listener section may consume external triggers.
   * Reasoning and Execution never listen to the outside world directly.
   * If an agent has no active Listener, it does NOT receive external input.
   * 
   * Decision logic:
   * - No listener capability or no active triggers -> reject (matchType = 'none')
   * - Listener active and trigger matches -> forward (matchType = trigger type)
   * - Listener active but no match -> reject (matchType = 'none')
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
    
    // Check if agent has listener capability
    const hasListenerCapability = agent.capabilities?.includes('listening') ?? false
    
    // Check if any listener mode is enabled (legacy format)
    const passiveEnabled = listening?.passiveEnabled ?? false
    const activeEnabled = listening?.activeEnabled ?? false
    
    // Also check for unified triggers (new format) - if any exist, listener is active
    const hasUnifiedTriggers = (listening?.unifiedTriggers?.length ?? 0) > 0
    const hasLegacyTriggers = (listening?.triggers?.length ?? 0) > 0
    
    // Listener is active if any trigger system has triggers
    const isListenerActive = passiveEnabled || activeEnabled || hasUnifiedTriggers || hasLegacyTriggers
    
    this.log(`Agent "${agent.name}" - hasListenerCapability: ${hasListenerCapability}, isListenerActive: ${isListenerActive}, hasUnifiedTriggers: ${hasUnifiedTriggers}`)

    // STRICT CHAIN: No listener capability or no active triggers -> agent cannot receive external input.
    // Reasoning and Execution must never listen to the outside world directly.
    if (!hasListenerCapability || !isListenerActive) {
      this.log(`Agent "${agent.name}" REJECTED: no active Listener — strict chain requires Listener -> Reasoning -> Execution`)
      return {
        hasListener: hasListenerCapability,
        isListenerActive: false,
        matchesPassiveTrigger: false,
        matchesActiveTrigger: false,
        matchesExpectedContext: false,
        matchesApplyFor: false,
        matchType: 'none',
        matchDetails: 'No active listener — external input requires a Listener trigger (Listener → Reasoning → Execution)'
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

    // Collect ALL matching triggers (not just the first one)
    const matchedTriggers: string[] = []
    let hasPassiveMatch = false
    let hasActiveMatch = false

    // Check passive triggers
    if (passiveEnabled && listening?.passive?.triggers && inputTriggers.length > 0) {
      for (const trigger of listening.passive.triggers) {
        const triggerName = trigger.tag?.name
        if (triggerName && inputTriggers.some(t => 
          t.toLowerCase() === triggerName.toLowerCase()
        )) {
          this.log(`Agent "${agent.name}" matched passive trigger: #${triggerName}`)
          if (!matchedTriggers.includes(triggerName)) {
            matchedTriggers.push(triggerName)
          }
          hasPassiveMatch = true
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
          if (!matchedTriggers.includes(triggerName)) {
            matchedTriggers.push(triggerName)
          }
          hasActiveMatch = true
        }
      }
    }

    // Track matched keywords for display
    const matchedKeywords: string[] = []
    
    // Check unified triggers (new format) — includes wrchat, direct_tag, etc.
    if (listening?.unifiedTriggers && inputTriggers.length > 0) {
      for (const trigger of listening.unifiedTriggers) {
        const triggerTag = trigger.tag?.replace('#', '') || trigger.tagName || ''
        
        if (triggerTag && inputTriggers.some(t => 
          t.toLowerCase() === triggerTag.toLowerCase()
        )) {
          // Check keyword conditions before accepting the match
          const keywordResult = this.checkTriggerKeywords(trigger, input)
          if (!keywordResult.valid) {
            this.log(`Agent "${agent.name}" trigger #${triggerTag} - keywords NOT matched, skipping`)
            continue
          }
          
          const triggerTypeName = trigger.type === 'wrchat' ? 'WR Chat' : 'unified'
          this.log(`Agent "${agent.name}" matched ${triggerTypeName} trigger: #${triggerTag}`)
          if (!matchedTriggers.includes(triggerTag)) {
            matchedTriggers.push(triggerTag)
          }
          if (keywordResult.matchedKeyword && !matchedKeywords.includes(keywordResult.matchedKeyword)) {
            matchedKeywords.push(keywordResult.matchedKeyword)
          }
          hasActiveMatch = true
        }
      }
    }
    
    // Also check listening.triggers (alternative storage)
    if (listening?.triggers && Array.isArray(listening.triggers) && inputTriggers.length > 0) {
      for (const trigger of listening.triggers) {
        const triggerTag = trigger.tag?.replace('#', '') || trigger.tagName || trigger.name || ''
        
        if (triggerTag && inputTriggers.some(t => 
          t.toLowerCase() === triggerTag.toLowerCase()
        )) {
          // Check keyword conditions before accepting the match
          const keywordResult = this.checkTriggerKeywords(trigger, input)
          if (!keywordResult.valid) {
            this.log(`Agent "${agent.name}" trigger #${triggerTag} - keywords NOT matched, skipping`)
            continue
          }
          
          this.log(`Agent "${agent.name}" matched trigger: #${triggerTag}`)
          if (!matchedTriggers.includes(triggerTag)) {
            matchedTriggers.push(triggerTag)
          }
          if (keywordResult.matchedKeyword && !matchedKeywords.includes(keywordResult.matchedKeyword)) {
            matchedKeywords.push(keywordResult.matchedKeyword)
          }
          hasActiveMatch = true
        }
      }
    }

    // If we found any matching triggers, return the combined result
    if (matchedTriggers.length > 0) {
      const triggerList = matchedTriggers.map(t => `#${t}`).join(', ')
      const keywordInfo = matchedKeywords.length > 0 
        ? ` (keyword: ${matchedKeywords.join(', ')})` 
        : ''
      this.log(`Agent "${agent.name}" matched ${matchedTriggers.length} trigger(s): ${triggerList}${keywordInfo}`)
      return {
        hasListener: true,
        isListenerActive: true,
        matchesPassiveTrigger: hasPassiveMatch,
        matchesActiveTrigger: hasActiveMatch,
        matchesExpectedContext: false,
        matchesApplyFor: true,
        matchedTriggerName: matchedTriggers[0], // First for backward compatibility
        matchedTriggerNames: matchedTriggers, // ALL matched triggers
        matchType: hasPassiveMatch ? 'passive_trigger' : 'active_trigger',
        matchDetails: matchedTriggers.length === 1 
          ? `Event trigger #${matchedTriggers[0]} matched${keywordInfo}`
          : `Event triggers matched: ${triggerList}${keywordInfo}`
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

    // STRICT CHAIN: reasoning.applyFor is NOT checked here.
    // Reasoning must never listen to external input directly.
    // applyFor is an internal filter applied AFTER a Listener match,
    // not an external trigger. Only the Listener layer gates external input.

    // No Listener trigger matched
    this.log(`Agent "${agent.name}" — Listener active but no triggers matched this input`)
    return {
      hasListener: true,
      isListenerActive: true,
      matchesPassiveTrigger: false,
      matchesActiveTrigger: false,
      matchesExpectedContext: false,
      matchesApplyFor: false,
      matchType: 'none',
      matchDetails: 'Listener active but no triggers matched — input not forwarded'
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
  findAgentBoxesForAgent(agent: AgentConfig, agentBoxes: AgentBox[], matchedTriggerName?: string): AgentBox[] {
    const matchedBoxes: AgentBox[] = []
    const agentAny = agent as any

    // Debug: log the raw execution structure to diagnose missing destinations
    console.log(`[InputCoordinator] findAgentBoxesForAgent "${agent.name}":`, {
      executionSectionsCount: (agentAny.executionSections || []).length,
      executionSections: JSON.stringify(agentAny.executionSections || []),
      executionSpecialDests: JSON.stringify(agentAny.execution?.specialDestinations || []),
      executionDestinations: JSON.stringify(agentAny.execution?.destinations || []),
    })

    // Helper: resolve agentBox destinations from a destinations/specialDestinations array
    const resolveDestList = (dests: any[]) => {
      for (const dest of dests) {
        if (dest.kind === 'agentBox') {
          if (dest.agents && dest.agents.length > 0) {
            for (const targetBox of dest.agents) {
              const boxNumMatch = String(targetBox).match(/(\d+)/)
              if (boxNumMatch) {
                const targetBoxNum = parseInt(boxNumMatch[1], 10)
                // Prefer a box whose agentNumber matches this agent — avoids picking a
                // box belonging to a different agent when multiple boxes share the same boxNumber.
                const candidateBoxes = agentBoxes.filter(b => Number(b.boxNumber) === targetBoxNum && b.enabled !== false)
                const box = candidateBoxes.find(b => Number(b.agentNumber) === Number(agent.number))
                  ?? candidateBoxes[0]
                if (box && !matchedBoxes.some(mb => mb.id === box.id)) {
                  this.log(`Agent "${agent.name}" → Explicit destination: Agent Box ${targetBoxNum}`)
                  matchedBoxes.push(box)
                }
              }
            }
          } else {
            this.log(`Agent "${agent.name}" has generic agentBox destination, using number matching`)
          }
        }
      }
    }

    // 1a. Check executionSections[].destinations (new v2.1.0 format)
    // Also check executionSections[].specialDestinations (auto-save draft format)
    const executionSections: any[] = agentAny.executionSections || []
    for (const section of executionSections) {
      resolveDestList(section.destinations || [])
      resolveDestList(section.specialDestinations || [])
    }

    // 1b. Check legacy execution.specialDestinations and execution.destinations
    const specialDestinations = agentAny.execution?.specialDestinations || []
    resolveDestList(specialDestinations)
    const execDestinations = agentAny.execution?.destinations || []
    resolveDestList(execDestinations)
    
    // 2. Check listener.reportTo for explicit destinations
    const reportTo = agent.listening?.reportTo || []
    for (const dest of reportTo) {
      // Parse destinations like "Agent Box 01", "agentBox01", etc.
      const boxNumMatch = String(dest).match(/(?:box|Box)\s*(\d+)/i)
      if (boxNumMatch) {
        const targetBoxNum = parseInt(boxNumMatch[1], 10)
        // Prefer box whose agentNumber matches this agent
        const candidateBoxes = agentBoxes.filter(b => Number(b.boxNumber) === targetBoxNum && b.enabled !== false)
        const box = candidateBoxes.find(b => Number(b.agentNumber) === Number(agent.number))
          ?? candidateBoxes[0]
        if (box && !matchedBoxes.some(mb => mb.id === box.id)) {
          this.log(`Agent "${agent.name}" → ReportTo destination: Agent Box ${targetBoxNum}`)
          matchedBoxes.push(box)
        }
      }
    }
    
    // 3. Fall back to agent.number matching if no explicit destinations found
    if (matchedBoxes.length === 0 && agent.number) {
      const numberMatchedBoxes = agentBoxes.filter(box => {
        const boxAgentNum = Number(box.agentNumber)
        const matches = boxAgentNum === Number(agent.number) && box.enabled !== false
        return matches
      })
      
      if (numberMatchedBoxes.length > 0) {
        this.log(`Agent ${agent.number} (${agent.name}) → Number match: ${numberMatchedBoxes.map(b => `Box ${b.boxNumber}`).join(', ')}`)
        matchedBoxes.push(...numberMatchedBoxes)
      }
    }

    // 4. Fall back to agentId field matching (box.agentId === "agent<N>" vs agent key/id)
    if (matchedBoxes.length === 0) {
      const agentKey = (agent as any).key || agent.id || ''
      const agentIdBoxes = agentBoxes.filter(box => {
        if (!box.enabled) return false
        const boxAgentId: string = (box as any).agentId || ''
        if (!boxAgentId) return false
        // Direct match: box.agentId === agent.key or agent.id
        if (boxAgentId.toLowerCase() === agentKey.toLowerCase()) return true
        // Match via numbers extracted from agentId (e.g. box.agentId="agent1", agent.number=1)
        const boxAgentIdNum = Number(boxAgentId.replace(/\D/g, ''))
        if (!isNaN(boxAgentIdNum) && boxAgentIdNum > 0 && boxAgentIdNum === Number(agent.number)) return true
        return false
      })
      if (agentIdBoxes.length > 0) {
        this.log(`Agent "${agent.name}" → agentId field match: ${agentIdBoxes.map(b => `Box ${b.boxNumber}`).join(', ')}`)
        matchedBoxes.push(...agentIdBoxes)
      }
    }

    // 5. Last resort: if agent has a single-digit number extracted from its trigger tag,
    //    match against the first available box with that same number.
    if (matchedBoxes.length === 0) {
      const agentNum = Number(agent.number)
      if (agentNum > 0) {
        // Try matching box.boxNumber === agentNum (Box 01 ↔ Agent 1)
        const boxNumMatches = agentBoxes.filter(b => Number(b.boxNumber) === agentNum && b.enabled !== false)
        if (boxNumMatches.length > 0) {
          this.log(`Agent ${agentNum} (${agent.name}) → Box number fallback match: ${boxNumMatches.map(b => `Box ${b.boxNumber}`).join(', ')}`)
          matchedBoxes.push(...boxNumMatches)
        }
      }
    }

    // 6. Use number extracted from the matched trigger tag (e.g., "a1" → 1, "invoice2" → 2)
    if (matchedBoxes.length === 0 && matchedTriggerName) {
      const triggerDigits = String(matchedTriggerName).match(/(\d+)/)
      if (triggerDigits) {
        const triggerNum = parseInt(triggerDigits[1], 10)
        // Try agentNumber match first, then boxNumber match
        const triggerMatches = agentBoxes.filter(b => {
          if (b.enabled === false) return false
          if (Number(b.agentNumber) === triggerNum) return true
          if (Number(b.boxNumber) === triggerNum) return true
          return false
        })
        if (triggerMatches.length > 0) {
          this.log(`Agent "${agent.name}" → Trigger tag digit match (#${matchedTriggerName}→${triggerNum}): ${triggerMatches.map(b => `Box ${b.boxNumber}`).join(', ')}`)
          matchedBoxes.push(...triggerMatches)
        }
      }
    }
    
    if (matchedBoxes.length === 0) {
      this.log(`Agent "${agent.name}" has no connected boxes (checked: specialDestinations, reportTo, number matching, agentId, box-number fallback)`)
    }

    console.log(`[InputCoordinator] findAgentBoxesForAgent "${agent.name}" result:`, {
      totalBoxesAvailable: agentBoxes.length,
      allBoxSummary: agentBoxes.map(b => `${b.id}(agentNum=${b.agentNumber},boxNum=${b.boxNumber},source=${(b as any).source})`),
      matchedBoxCount: matchedBoxes.length,
      matchedBoxIds: matchedBoxes.map(b => b.id),
    })
    
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

      // STRICT CHAIN: Only forward if a Listener trigger actually matched.
      // 'none' means no match — agent does not receive input.
      const shouldForward = evaluation.matchType !== 'none'
      
      if (shouldForward) {
        // Find connected agent boxes — pass matched trigger name as additional hint
        const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes, evaluation.matchedTriggerName)
        const firstBox = connectedBoxes[0]

        // Map matchType to matchReason (only Listener-derived matches reach here)
        let matchReason: AgentMatch['matchReason'] = 'trigger'
        if (evaluation.matchType === 'expected_context') {
          matchReason = 'expected_context'
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
          agentBoxModel: firstBox?.model,
          targetBoxIds: connectedBoxes.map(b => b.id)
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

      // Map Listener match type to reason (only Listener-derived matches reach here)
      let matchReason: AgentAllocation['matchReason'] = 'trigger'
      if (evaluation.matchType === 'expected_context') {
        matchReason = 'expected_context'
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
      
      // Collect ALL matching triggers for this agent
      const matchedTriggersForAgent: Array<{tag: string, trigger: any, conditionResults: any}> = []
      
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
        
        // Add to matched triggers for this agent
        matchedTriggersForAgent.push({ tag: triggerTag, trigger, conditionResults })
      }
      
      // If we have any matching triggers for this agent, create a result
      if (matchedTriggersForAgent.length > 0) {
        agentsMatched++
        
        // Use first trigger for config resolution (they share the same agent config)
        const firstMatch = matchedTriggersForAgent[0]
        
        // Resolve LLM from connected Agent Box
        const llmConfig = this.resolveLlmFromAgentBox(agent, agentBoxes)
        
        // Resolve reasoning configuration
        const reasoningConfig = this.resolveReasoningConfig(agent, firstMatch.trigger)
        
        // Resolve execution configuration
        const executionConfig = this.resolveExecutionConfig(agent, firstMatch.trigger, agentBoxes)
        
        // Build list of all matched tags
        const allMatchedTags = matchedTriggersForAgent.map(m => `#${m.tag}`)
        const tagsDisplay = allMatchedTags.join(', ')
        
        // Build the routing result with ALL matched triggers
        const result: EventTagRoutingResult = {
          matched: true,
          agentId: agent.id,
          agentName: agent.name || agent.key || 'Unnamed Agent',
          agentIcon: '🤖', // Default icon
          agentNumber: agent.number,
          trigger: {
            id: firstMatch.trigger.id || `ID#${firstMatch.tag}`,
            type: (firstMatch.trigger.type as TriggerType) || 'direct_tag',
            tag: tagsDisplay, // Show ALL matched tags
            channel: (firstMatch.trigger.channel as EventChannel) || 'chat'
          },
          conditionResults: firstMatch.conditionResults,
          sensorContext: {}, // Will be populated by sensor workflows
          llmConfig,
          reasoningConfig,
          executionConfig,
          matchDetails: matchedTriggersForAgent.length === 1
            ? `Event tag #${firstMatch.tag} matched`
            : `Event tags matched: ${tagsDisplay}`,
          timestamp: Date.now()
        }
        
        results.push(result)
        this.log(`✓ Agent "${agent.name}" matched ${matchedTriggersForAgent.length} trigger(s): ${tagsDisplay}`)
        this.log(`  → LLM: ${llmConfig.provider}/${llmConfig.model}, ReportTo: ${executionConfig.reportTo.map(r => r.label).join(', ')}`)
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
    
    // Check unified triggers format (new) - stored as unifiedTriggers
    if (listening.unifiedTriggers && Array.isArray(listening.unifiedTriggers)) {
      const eventTagTriggers = listening.unifiedTriggers.filter((t: any) => 
        t.type === 'direct_tag' || t.type === 'tag_and_condition'
      )
      triggers.push(...eventTagTriggers)
      this.log(`Found ${eventTagTriggers.length} unified triggers for agent`)
    }
    
    // Also check listening.triggers (alternative storage location)
    if (listening.triggers && Array.isArray(listening.triggers)) {
      const eventTagTriggers = listening.triggers.filter((t: any) => 
        t.type === 'direct_tag' || t.type === 'tag_and_condition'
      )
      triggers.push(...eventTagTriggers)
      this.log(`Found ${eventTagTriggers.length} triggers for agent`)
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
      this.log(`Found ${listening.passive.triggers.length} legacy passive triggers`)
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
      this.log(`Found ${listening.active.triggers.length} legacy active triggers`)
    }
    
    this.log(`Total triggers extracted for agent "${agent.name}":`, triggers.length)
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
    
    this.log(`Evaluating conditions for trigger:`, {
      hasEventTagConditions: eventTagConditions.length,
      hasKeywordsField: !!trigger.keywords,
      keywordsValue: trigger.keywords,
      hasExpectedContext: !!trigger.expectedContext
    })
    
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
            this.log(`body_keywords check:`, { keywords: condition.keywords, searchText: searchText.substring(0, 50), passed, matchedKeyword })
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
    
    // Check legacy trigger.keywords field (comma-separated string) if no body_keywords condition already processed
    const hasBodyKeywordsCondition = conditions.some(c => c.type === 'body_keywords')
    
    if (!hasBodyKeywordsCondition && trigger.keywords && typeof trigger.keywords === 'string' && trigger.keywords.trim()) {
      const keywords = trigger.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const searchText = classifiedInput.rawText.toLowerCase()
        const matchedKeyword = keywords.find((kw: string) => searchText.includes(kw.toLowerCase()))
        const passed = !!matchedKeyword
        this.log(`Legacy keywords check:`, { keywords, searchText: searchText.substring(0, 50), passed, matchedKeyword })
        conditions.push({
          type: 'body_keywords',
          passed,
          details: passed ? `Keyword "${matchedKeyword}" found` : `None of ${keywords.length} keywords found - required for match`
        })
        if (!passed) allPassed = false
      }
    }
    
    // Also check legacy expectedContext if present and no keywords check done yet
    if (!conditions.some(c => c.type === 'body_keywords') && trigger.expectedContext) {
      const keywords = trigger.expectedContext.split(',').map((k: string) => k.trim()).filter(Boolean)
      if (keywords.length > 0) {
        const searchText = classifiedInput.rawText.toLowerCase()
        const matchedKeyword = keywords.find((kw: string) => searchText.includes(kw.toLowerCase()))
        const passed = !!matchedKeyword
        this.log(`ExpectedContext check:`, { keywords, passed })
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
    
    this.log(`Condition evaluation result:`, { allPassed, conditionCount: conditions.length, conditions })
    
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

    // Helper to resolve a destination list into reportTo entries
    const resolveDestListForConfig = (dests: any[]) => {
      for (const dest of dests) {
        if (dest.kind === 'agentBox') {
          if (dest.agents && dest.agents.length > 0) {
            for (const boxRef of dest.agents) {
              const boxNumMatch = String(boxRef).match(/(\d+)/)
              if (boxNumMatch) {
                const boxNum = parseInt(boxNumMatch[1], 10)
                const box = agentBoxes.find(b => Number(b.boxNumber) === boxNum)
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
          } else {
            // Generic agent box - use agent's connected box
            const connectedBoxes = this.findAgentBoxesForAgent(agent, agentBoxes as AgentBox[])
            for (const box of connectedBoxes) {
              if (!reportTo.some(r => r.agentBoxId === box.id)) {
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
        } else if (dest.kind === 'wrChat' || dest.kind === 'commandChat') {
          if (!reportTo.some(r => r.kind === 'wr_chat')) {
            reportTo.push({ kind: 'wr_chat', label: 'WR Chat (Command Chat)', enabled: true })
          }
        } else if (dest.kind === 'inlineChat') {
          if (!reportTo.some(r => r.kind === 'inline_chat')) {
            reportTo.push({ kind: 'inline_chat', label: 'Inline Chat', enabled: true })
          }
        }
      }
    }

    // Check all destination formats: destinations (canonical) + specialDestinations (draft/auto-save)
    resolveDestListForConfig(applicableSection.destinations || [])
    resolveDestListForConfig(applicableSection.specialDestinations || [])
    // Also fall back to main execution section if applicable section had nothing
    if (reportTo.length === 0) {
      resolveDestListForConfig(execution.destinations || [])
      resolveDestListForConfig(execution.specialDestinations || [])
    }
    
    // Check legacy reportTo in listening section
    const listenerReportTo = agent.listening?.reportTo || []
    for (const dest of listenerReportTo) {
      const boxNumMatch = String(dest).match(/(?:box|Box)\s*(\d+)/i)
      if (boxNumMatch) {
        const boxNum = parseInt(boxNumMatch[1], 10)
        const box = agentBoxes.find(b => Number(b.boxNumber) === boxNum)
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
export const inputCoordinator = new InputCoordinator({ debug: true })

