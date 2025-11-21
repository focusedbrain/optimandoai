/**
 * Output Coordinator Service
 * Routes LLM output to the correct Agent Box
 */

import type { InputEventPayload, AgentExecutionResult } from '../types/coordination'

interface AgentConfig {
  executionSection?: {
    targetOutputAgentBoxId?: string
    displayMode?: "chat" | "overlay" | "notification"
    appendMode?: "append" | "replace"
  }
}

export class OutputCoordinator {
  /**
   * Route LLM output to correct Agent Box
   */
  async routeOutput(
    agentNumber: string | number,
    result: AgentExecutionResult,
    input: InputEventPayload
  ): Promise<void> {
    try {
      console.log('[OutputCoordinator] Routing output:', {
        agentNumber,
        success: result.success,
        contentLength: result.content.length,
        sessionId: input.sessionId
      })
      
      if (!result.success) {
        console.warn('[OutputCoordinator] Execution failed, showing error:', result.error)
        // TODO: Show error notification to user
        return
      }
      
      // 1. Load agent configuration to get execution section
      const agentConfig = await this.loadAgentConfig(agentNumber)
      
      // 2. Determine target agent box
      const targetBoxId = await this.resolveTargetAgentBox(agentConfig, input.sessionId, agentNumber)
      
      if (!targetBoxId) {
        console.warn('[OutputCoordinator] No target agent box found, using default display')
        // TODO: Display in command chat or default location
        return
      }
      
      // 3. Get append mode
      const appendMode = agentConfig?.executionSection?.appendMode || 'append'
      
      // 4. Append content to agent box
      await this.appendToAgentBox(targetBoxId, result.content, appendMode)
      
      console.log('[OutputCoordinator] Output routed successfully to box:', targetBoxId)
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to route output:', error)
    }
  }
  
  /**
   * Load agent configuration from SQLite
   */
  private async loadAgentConfig(agentNumber: string | number): Promise<AgentConfig | null> {
    try {
      const agentName = typeof agentNumber === 'number' 
        ? `agent${String(agentNumber).padStart(2, '0')}`
        : agentNumber
      
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
      console.error('[OutputCoordinator] Failed to load agent config:', error)
      return null
    }
  }
  
  /**
   * Resolve target agent box ID
   * Priority:
   * 1. Agent's executionSection.targetOutputAgentBoxId
   * 2. Agent box with same agent number in session
   * 3. First available agent box in session
   */
  private async resolveTargetAgentBox(
    agentConfig: AgentConfig | null,
    sessionId: string,
    agentNumber: string | number
  ): Promise<string | null> {
    try {
      // Check if agent has explicit target
      if (agentConfig?.executionSection?.targetOutputAgentBoxId) {
        console.log('[OutputCoordinator] Using explicit target:', agentConfig.executionSection.targetOutputAgentBoxId)
        return agentConfig.executionSection.targetOutputAgentBoxId
      }
      
      // TODO: Load session data from SQLite to find agent boxes
      // For now, return null and let caller handle default display
      console.log('[OutputCoordinator] TODO: Load session agent boxes from SQLite for session:', sessionId)
      
      // Expected logic:
      // const sessionData = await this.loadSessionData(sessionId)
      // const agentBoxes = sessionData.agentBoxes || []
      // 
      // // Find box with matching agent number
      // const matchingBox = agentBoxes.find((box: any) => box.agent === agentNumber)
      // if (matchingBox) return matchingBox.id
      // 
      // // Fallback to first box
      // if (agentBoxes.length > 0) return agentBoxes[0].id
      
      return null
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to resolve target agent box:', error)
      return null
    }
  }
  
  /**
   * Append content to agent box
   * Updates agent box in session data and persists to SQLite
   */
  private async appendToAgentBox(
    boxId: string,
    content: string,
    mode: "append" | "replace"
  ): Promise<void> {
    try {
      console.log('[OutputCoordinator] Appending to agent box:', {
        boxId,
        mode,
        contentLength: content.length
      })
      
      // TODO: Load session data, update agent box, save back to SQLite
      // TODO: Emit event to refresh UI
      console.log('[OutputCoordinator] TODO: Update agent box in session data and emit UI refresh event')
      
      // Expected logic:
      // 1. Load session that contains this box
      // 2. Find the box in session.agentBoxes
      // 3. Update box.output based on mode (append or replace)
      // 4. Save session back to SQLite
      // 5. Emit event: chrome.runtime.sendMessage({ type: 'AGENT_BOX_UPDATED', boxId, content })
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to append to agent box:', error)
      throw error
    }
  }
}

// Export singleton instance
export const outputCoordinator = new OutputCoordinator()

