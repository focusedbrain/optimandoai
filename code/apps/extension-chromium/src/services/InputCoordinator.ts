/**
 * Input Coordinator Service
 * Routes input events to matching agents
 */

import type { InputEventPayload, ListenerSectionConfig } from '../types/coordination'
import { agentExecutor } from './AgentExecutor'
import { outputCoordinator } from './OutputCoordinator'
import { sendLlmRequest } from './llm/LlmClient'

interface AgentConfig {
  name: string
  capabilities: string[]
  listenerSection?: ListenerSectionConfig
  isSystemAgent?: boolean
  systemAgentType?: string
}

export class InputCoordinator {
  /**
   * Handle input event and route to matching agents
   * Returns aggregated results for display
   */
  async handleInputEvent(input: InputEventPayload): Promise<string | null> {
    try {
      console.log('[InputCoordinator] Handling input event:', {
        sessionId: input.sessionId,
        source: input.source,
        textLength: input.text?.length,
        inputType: input.inputType
      })
      
      // 1. Find all agents with enabled listeners that match
      const matchingAgents = await this.findMatchingAgents(input)
      
      if (matchingAgents.length > 0) {
        console.log('[InputCoordinator] Found matching agents with listeners:', matchingAgents.map(a => a.name))
        return await this.executeAgents(matchingAgents, input)
      }
      
      // 2. No matches - check for agents without listener sections (reasoning/execution only)
      console.log('[InputCoordinator] No matching listeners, checking for agents without listener sections')
      const alwaysOnAgents = await this.findAgentsWithoutListeners()
      
      if (alwaysOnAgents.length > 0) {
        console.log('[InputCoordinator] Found agents without listeners (always-on):', alwaysOnAgents.map(a => a.name))
        return await this.executeAgents(alwaysOnAgents, input)
      }
      
      // 3. No agents at all - use direct LLM response (standard model response, no agent rules)
      console.log('[InputCoordinator] No agents available - using direct LLM response')
      return await this.directLlmResponse(input)
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to handle input event:', error)
      throw error
    }
  }
  
  /**
   * Direct LLM response without agent instructions
   * Used when no agents are configured - gives standard model response
   */
  private async directLlmResponse(input: InputEventPayload): Promise<string> {
    try {
      console.log('[InputCoordinator] Calling LLM directly without agent instructions')
      
      const response = await sendLlmRequest({
        modelId: 'mistral:7b',
        messages: [
          { role: 'user', content: input.text || 'Hello' }
        ],
        temperature: 0.3,  // Lower = faster
        maxTokens: 500     // Limit for speed
      })
      
      if (response.success) {
        return response.content
      } else {
        return `Error: ${response.error}`
      }
    } catch (error: any) {
      console.error('[InputCoordinator] Direct LLM call failed:', error)
      return `Error: ${error.message}`
    }
  }
  
  /**
   * Execute a list of agents with the input
   * Returns the combined response for chat display
   */
  private async executeAgents(agents: AgentConfig[], input: InputEventPayload): Promise<string> {
    const responses: string[] = []
    
    for (const agent of agents) {
      try {
        // Extract agent number from name (e.g., "agent01" -> 1)
        const agentNumber = this.extractAgentNumber(agent.name)
        if (!agentNumber) {
          console.warn('[InputCoordinator] Could not extract agent number from:', agent.name)
          continue
        }
        
        // Execute agent via AgentExecutor
        const result = await agentExecutor.runAgentExecution(agentNumber, input)
        
        if (result.success && result.content) {
          // Add to responses for chat display
          responses.push(result.content)
        }
        
        // Route output via OutputCoordinator (for agent box display)
        await outputCoordinator.routeOutput(agentNumber, result, input)
      } catch (error: any) {
        console.error('[InputCoordinator] Failed to execute agent:', agent.name, error)
      }
    }
    
    // Return combined responses or default message
    if (responses.length > 0) {
      return responses.join('\n\n---\n\n')
    }
    
    return 'Agent executed but no response generated.'
  }
  
  /**
   * Find all agents that match the input event
   * Only returns agents with enabled listener sections that match patterns
   */
  private async findMatchingAgents(input: InputEventPayload): Promise<AgentConfig[]> {
    try {
      // TODO: Load all agents from SQLite for session
      console.log('[InputCoordinator] TODO: Load all agents from SQLite for session:', input.sessionId)
      
      // Expected logic:
      // const agents = await this.loadAllAgents(input.sessionId)
      // return agents.filter(agent => {
      //   // Must have enabled listener section
      //   if (!agent.listenerSection?.enabled) return false
      //   // Must match pattern
      //   return this.matchesPattern(agent, input)
      // })
      
      // For now, return empty array (no matches)
      return []
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to find matching agents:', error)
      return []
    }
  }
  
  /**
   * Find agents without listener sections (always-on agents)
   * These are agents with Reasoning + Execution sections enabled
   */
  private async findAgentsWithoutListeners(): Promise<AgentConfig[]> {
    try {
      console.log('[InputCoordinator] Loading agents with Reasoning+Execution enabled (no listener section)')
      
      const alwaysOnAgents: AgentConfig[] = []
      
      for (let i = 1; i <= 10; i++) {
        const agentName = `agent${String(i).padStart(2, '0')}`
        const agent = await this.loadAgentConfig(agentName)
        
        if (!agent || agent.isSystemAgent) continue
        
        // Check if Reasoning and Execution sections are active
        const hasReasoning = agent.capabilities?.includes('reasoning')
        const hasExecution = agent.capabilities?.includes('execution')
        
        // Check if listener section is disabled or not configured
        const listenerDisabled = !agent.listenerSection || !agent.listenerSection.enabled
        
        if (hasReasoning && hasExecution && listenerDisabled) {
          console.log('[InputCoordinator] Found always-on agent (Reasoning+Execution):', agentName, {
            hasReasoning,
            hasExecution,
            listenerDisabled
          })
          alwaysOnAgents.push(agent)
        }
      }
      
      console.log('[InputCoordinator] Total always-on agents found:', alwaysOnAgents.length)
      return alwaysOnAgents
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to find agents without listeners:', error)
      return []
    }
  }
  
  /**
   * Check if agent matches input pattern
   * Only called for agents with enabled listener sections
   */
  private matchesPattern(agent: AgentConfig, input: InputEventPayload): boolean {
    // Skip system agents
    if (agent.isSystemAgent) {
      return false
    }
    
    // Must have enabled listener section (redundant check for safety)
    if (!agent.listenerSection?.enabled) {
      return false
    }
    
    const listener = agent.listenerSection
    
    // Check input source match
    if (listener.inputSources && listener.inputSources.length > 0) {
      if (!listener.inputSources.includes(input.source)) {
        return false
      }
    }
    
    // Check input type match
    if (listener.inputTypes && listener.inputTypes.length > 0 && input.inputType) {
      if (!listener.inputTypes.includes(input.inputType)) {
        return false
      }
    }
    
    // Check pattern match (simple string contains for now)
    if (listener.patterns && listener.patterns.length > 0 && input.text) {
      const textLower = input.text.toLowerCase()
      const hasMatch = listener.patterns.some(pattern => 
        textLower.includes(pattern.toLowerCase())
      )
      if (!hasMatch) {
        return false
      }
    }
    
    return true
  }
  
  /**
   * Load agent configuration from SQLite
   */
  private async loadAgentConfig(agentName: string): Promise<AgentConfig | null> {
    try {
      const storageKey = `agent_${agentName}_instructions`
      
      const response = await fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(storageKey)}`, {
        signal: AbortSignal.timeout(5000)
      })
      
      if (!response.ok) return null
      
      const result = await response.json()
      if (!result.success || !result.data) return null
      
      const config = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
      return config as AgentConfig
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to load agent config:', error)
      return null
    }
  }
  
  /**
   * Extract agent number from agent name
   * E.g., "agent01" -> 1, "Agent 02 - Summary" -> 2
   */
  private extractAgentNumber(name: string): number | null {
    // Try to find "agentXX" pattern
    const match = name.match(/agent(\d+)/i)
    if (match) {
      return parseInt(match[1], 10)
    }
    
    // Try to find "Agent XX" pattern
    const match2 = name.match(/agent\s+(\d+)/i)
    if (match2) {
      return parseInt(match2[1], 10)
    }
    
    return null
  }
}

// Export singleton instance
export const inputCoordinator = new InputCoordinator()

