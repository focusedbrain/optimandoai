/**
 * Input Coordinator Service
 * Routes input events to matching agents
 */

import type { InputEventPayload, ListenerSectionConfig } from '../types/coordination'
import { agentExecutor } from './AgentExecutor'
import { outputCoordinator } from './OutputCoordinator'

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
   */
  async handleInputEvent(input: InputEventPayload): Promise<void> {
    try {
      console.log('[InputCoordinator] Handling input event:', {
        sessionId: input.sessionId,
        source: input.source,
        textLength: input.text?.length,
        inputType: input.inputType
      })
      
      // 1. Find all agents with enabled listeners
      const matchingAgents = await this.findMatchingAgents(input)
      
      if (matchingAgents.length === 0) {
        console.warn('[InputCoordinator] No matching agents found, using default')
        const defaultAgent = await this.getDefaultAgent()
        if (defaultAgent) {
          matchingAgents.push(defaultAgent)
        } else {
          console.error('[InputCoordinator] No default agent available')
          return
        }
      }
      
      console.log('[InputCoordinator] Found matching agents:', matchingAgents.map(a => a.name))
      
      // 2. Execute each matched agent
      for (const agent of matchingAgents) {
        try {
          // Extract agent number from name (e.g., "agent01" -> 1)
          const agentNumber = this.extractAgentNumber(agent.name)
          if (!agentNumber) {
            console.warn('[InputCoordinator] Could not extract agent number from:', agent.name)
            continue
          }
          
          // Execute agent via AgentExecutor
          const result = await agentExecutor.runAgentExecution(agentNumber, input)
          
          // Route output via OutputCoordinator
          await outputCoordinator.routeOutput(agentNumber, result, input)
        } catch (error: any) {
          console.error('[InputCoordinator] Failed to execute agent:', agent.name, error)
        }
      }
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to handle input event:', error)
    }
  }
  
  /**
   * Find all agents that match the input event
   */
  private async findMatchingAgents(input: InputEventPayload): Promise<AgentConfig[]> {
    try {
      // TODO: Load all agents from SQLite for session
      console.log('[InputCoordinator] TODO: Load all agents from SQLite for session:', input.sessionId)
      
      // Expected logic:
      // const agents = await this.loadAllAgents(input.sessionId)
      // return agents.filter(agent => this.matchesPattern(agent, input))
      
      // For now, return empty array to trigger default agent fallback
      return []
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to find matching agents:', error)
      return []
    }
  }
  
  /**
   * Check if agent matches input pattern
   */
  private matchesPattern(agent: AgentConfig, input: InputEventPayload): boolean {
    // Skip system agents
    if (agent.isSystemAgent) {
      return false
    }
    
    // Check if listener is enabled
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
   * Get default agent when no matches found
   * Returns the first agent with reasoning capability
   */
  private async getDefaultAgent(): Promise<AgentConfig | null> {
    try {
      console.log('[InputCoordinator] TODO: Load default agent (first agent with reasoning capability)')
      
      // Expected logic:
      // const agents = await this.loadAllAgents()
      // return agents.find(a => !a.isSystemAgent && a.capabilities.includes('reasoning'))
      
      // For now, try to load agent01 as default
      return await this.loadAgentConfig('agent01')
    } catch (error: any) {
      console.error('[InputCoordinator] Failed to get default agent:', error)
      return null
    }
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

