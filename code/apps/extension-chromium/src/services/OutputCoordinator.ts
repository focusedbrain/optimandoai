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
   * Always routes output - if no target specified, uses default (same agent's box)
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
      
      // 1. Load agent configuration to get execution section (if configured)
      const agentConfig = await this.loadAgentConfig(agentNumber)
      
      // 2. Determine target agent box
      // If no explicit target configured, defaults to same agent's box
      const targetBoxId = await this.resolveTargetAgentBox(agentConfig, input.sessionId, agentNumber)
      
      if (!targetBoxId) {
        console.warn('[OutputCoordinator] No target agent box found - TODO: implement agent box loading from session')
        // TODO: Display in command chat or default location
        // For now, response is already shown in chat via InputCoordinator
        return
      }
      
      // 3. Get append mode (default to append if not specified)
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
   * 1. Agent's executionSection.targetOutputAgentBoxId (if explicitly set)
   * 2. Agent box with same agent number in session (default behavior)
   * 3. First available agent box in session (fallback)
   * 
   * Note: Even if executionSection is not configured, we still route to default (same agent's box)
   */
  private async resolveTargetAgentBox(
    agentConfig: AgentConfig | null,
    sessionId: string,
    agentNumber: string | number
  ): Promise<string | null> {
    try {
      // Check if agent has explicit target (user wants non-default behavior)
      if (agentConfig?.executionSection?.targetOutputAgentBoxId) {
        console.log('[OutputCoordinator] Using explicit target:', agentConfig.executionSection.targetOutputAgentBoxId)
        return agentConfig.executionSection.targetOutputAgentBoxId
      }
      
      // No explicit target - use default behavior (same agent's box)
      console.log('[OutputCoordinator] No explicit target, using default (same agent box)')
      
      // Load session data from SQLite to find agent boxes
      const sessionData = await this.loadSessionData(sessionId)
      if (!sessionData || !sessionData.agentBoxes) {
        console.warn('[OutputCoordinator] No session data or agent boxes found')
        return null
      }
      
      const agentBoxes = sessionData.agentBoxes || []
      
      // Normalize agent number to string (e.g., "01", "02")
      const agentNumStr = typeof agentNumber === 'number' 
        ? String(agentNumber).padStart(2, '0') 
        : String(agentNumber).replace('agent', '')
      
      // Priority 1: Find box with matching agent number (default)
      const matchingBox = agentBoxes.find((box: any) => {
        const boxAgentNum = box.agent?.replace('agent', '')
        console.log('[OutputCoordinator] Checking box:', { boxId: box.id, boxAgent: box.agent, boxAgentNum, targetAgentNum: agentNumStr })
        return boxAgentNum === agentNumStr
      })
      
      if (matchingBox) {
        console.log('[OutputCoordinator] Found matching box for agent:', matchingBox.id)
        return matchingBox.id
      }
      
      // Priority 2: First available box (fallback)
      if (agentBoxes.length > 0) {
        console.log('[OutputCoordinator] No matching box, using first available:', agentBoxes[0].id)
        return agentBoxes[0].id
      }
      
      console.warn('[OutputCoordinator] No agent boxes available in session')
      return null
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to resolve target agent box:', error)
      return null
    }
  }
  
  /**
   * Load session data from SQLite via Electron HTTP API
   */
  private async loadSessionData(sessionId: string): Promise<any> {
    try {
      const response = await fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.timeout(5000)
      })
      
      if (!response.ok) {
        console.error('[OutputCoordinator] Failed to load session, status:', response.status)
        return null
      }
      
      const result = await response.json()
      if (!result.success || !result.data) {
        console.warn('[OutputCoordinator] No session data returned')
        return null
      }
      
      const sessionData = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
      console.log('[OutputCoordinator] Loaded session data:', { 
        sessionId, 
        agentBoxCount: sessionData.agentBoxes?.length || 0 
      })
      return sessionData
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to load session data:', error)
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
      
      // Send message to background script to update agent box
      // The background script or content script will handle:
      // 1. Loading the session
      // 2. Finding the agent box
      // 3. Updating the output
      // 4. Saving back to SQLite
      // 5. Refreshing the UI
      
      chrome.runtime.sendMessage({
        type: 'AGENT_BOX_OUTPUT_UPDATE',
        boxId,
        content,
        mode
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[OutputCoordinator] Failed to send agent box update:', chrome.runtime.lastError)
          return
        }
        
        if (response?.success) {
          console.log('[OutputCoordinator] Agent box updated successfully')
        } else {
          console.error('[OutputCoordinator] Agent box update failed:', response?.error)
        }
      })
    } catch (error: any) {
      console.error('[OutputCoordinator] Failed to append to agent box:', error)
      throw error
    }
  }
}

// Export singleton instance
export const outputCoordinator = new OutputCoordinator()

