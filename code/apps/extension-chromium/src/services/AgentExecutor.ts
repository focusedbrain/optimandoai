/**
 * Agent Executor Service
 * Handles execution of AI agents with LLM integration
 */

import { storageGet } from '../storage/storageWrapper'

interface AgentExecutionRequest {
  agentNumber: string | number
  context: {
    userInput?: string
    pageContent?: string
    selection?: string
    triggerData?: any
  }
  agentBoxId?: string
}

interface AgentExecutionResult {
  success: boolean
  content: string
  error?: string
  tokensUsed?: number
}

interface AgentConfig {
  name: string
  icon: string
  capabilities: string[]
  reasoning?: {
    goals: string
    role: string
    rules: string
    llmProvider?: string
    llmModel?: string
    acceptFrom?: string[]
    reportTo?: string[]
  }
  execution?: {
    specialDestinations?: Array<{
      kind: string
      agents: string[]
    }>
  }
  memory?: {
    sessionRead: boolean
    sessionWrite: boolean
    accountRead: boolean
    accountWrite: boolean
  }
}

interface LLMSettings {
  provider: string
  model: string
}

export class AgentExecutor {
  /**
   * Execute an agent with given context
   */
  async executeAgent(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    try {
      console.log('[AgentExecutor] Starting execution:', request)
      
      // 1. Load agent configuration
      const agentConfig = await this.loadAgentConfig(request.agentNumber)
      
      if (!agentConfig) {
        throw new Error(`Agent ${request.agentNumber} not found`)
      }
      
      // Check if reasoning capability is enabled
      if (!agentConfig.capabilities.includes('reasoning')) {
        throw new Error(`Agent ${request.agentNumber} does not have reasoning capability enabled`)
      }
      
      if (!agentConfig.reasoning) {
        throw new Error(`Agent ${request.agentNumber} has no reasoning configuration`)
      }
      
      // 2. Load agent box LLM settings (or use global/agent default)
      const llmSettings = request.agentBoxId 
        ? await this.loadAgentBoxLLMSettings(request.agentBoxId)
        : await this.loadGlobalLLMSettings(agentConfig)
      
      console.log('[AgentExecutor] Using LLM settings:', llmSettings)
      
      // 3. Build prompt from agent's reasoning section
      const prompt = this.buildPrompt(agentConfig, request.context)
      
      console.log('[AgentExecutor] Generated prompt:', prompt)
      
      // 4. Call LLM
      const llmResponse = await this.callLLM(llmSettings, prompt)
      
      console.log('[AgentExecutor] LLM response received:', llmResponse)
      
      return llmResponse
    } catch (error: any) {
      console.error('[AgentExecutor] Execution failed:', error)
      return {
        success: false,
        content: '',
        error: error.message || 'Unknown error'
      }
    }
  }
  
  /**
   * Load agent configuration from storage
   */
  private async loadAgentConfig(agentNumber: string | number): Promise<AgentConfig | null> {
    return new Promise((resolve) => {
      // Convert agent number to name format
      const agentName = typeof agentNumber === 'number' 
        ? `agent${String(agentNumber).padStart(2, '0')}`
        : agentNumber
      
      const storageKey = `agent_${agentName}_instructions`
      
      storageGet([storageKey], (result) => {
        const configData = result[storageKey]
        if (configData) {
          try {
            const config = typeof configData === 'string' ? JSON.parse(configData) : configData
            resolve(config as AgentConfig)
          } catch (e) {
            console.error('[AgentExecutor] Failed to parse agent config:', e)
            resolve(null)
          }
        } else {
          resolve(null)
        }
      })
    })
  }
  
  /**
   * Load agent box LLM settings from storage
   */
  private async loadAgentBoxLLMSettings(boxId: string): Promise<LLMSettings> {
    return new Promise((resolve) => {
      const storageKey = `agentBox_${boxId}`
      
      storageGet([storageKey], (result) => {
        const boxConfig = result[storageKey]
        if (boxConfig && boxConfig.provider && boxConfig.model) {
          resolve({
            provider: boxConfig.provider,
            model: boxConfig.model
          })
        } else {
          // Fallback to Ollama default
          resolve({
            provider: 'Ollama',
            model: 'mistral:7b'
          })
        }
      })
    })
  }
  
  /**
   * Load global LLM settings or use agent's default
   */
  private async loadGlobalLLMSettings(agentConfig: AgentConfig): Promise<LLMSettings> {
    // Check if agent has LLM settings in reasoning section
    if (agentConfig.reasoning?.llmProvider && agentConfig.reasoning?.llmModel) {
      return {
        provider: agentConfig.reasoning.llmProvider,
        model: agentConfig.reasoning.llmModel
      }
    }
    
    // Check for global settings
    return new Promise((resolve) => {
      storageGet(['globalLLMSettings'], (result) => {
        const settings = result.globalLLMSettings
        if (settings && settings.provider && settings.model) {
          resolve({
            provider: settings.provider,
            model: settings.model
          })
        } else {
          // Default to Ollama with Mistral 7B
          resolve({
            provider: 'Ollama',
            model: 'mistral:7b'
          })
        }
      })
    })
  }
  
  /**
   * Build prompt from agent config and context
   */
  private buildPrompt(agentConfig: AgentConfig, context: any): { system: string, user: string } {
    const reasoning = agentConfig.reasoning!
    
    // Build system message from agent's reasoning configuration
    const systemParts: string[] = []
    
    if (reasoning.role) {
      systemParts.push(`Role: ${reasoning.role}`)
    }
    
    if (reasoning.goals) {
      systemParts.push(`\nGoals:\n${reasoning.goals}`)
    }
    
    if (reasoning.rules) {
      systemParts.push(`\nRules and Constraints:\n${reasoning.rules}`)
    }
    
    // Add context information
    const contextParts: string[] = []
    
    if (context.pageContent) {
      contextParts.push(`Page Content:\n${context.pageContent}`)
    }
    
    if (context.selection) {
      contextParts.push(`User Selection:\n${context.selection}`)
    }
    
    if (contextParts.length > 0) {
      systemParts.push(`\n\nAvailable Context:\n${contextParts.join('\n\n')}`)
    }
    
    const systemMessage = systemParts.join('\n')
    
    // User message is the actual input or trigger
    const userMessage = context.userInput || context.triggerData || 'Process the provided context and respond according to your goals and role.'
    
    return {
      system: systemMessage,
      user: userMessage
    }
  }
  
  /**
   * Call LLM with given settings and prompt
   */
  private async callLLM(settings: LLMSettings, prompt: { system: string, user: string }): Promise<AgentExecutionResult> {
    const provider = (settings.provider || '').toLowerCase()
    
    // Handle Ollama (local LLM)
    if (provider === 'ollama' || !settings.provider) {
      return await this.callOllamaViaElectron(settings.model, prompt)
    }
    
    // For other providers (OpenAI, Claude, etc.), throw error for now
    // These will be implemented later
    throw new Error(`Provider "${settings.provider}" is not yet implemented. Please use Ollama for local LLM support.`)
  }
  
  /**
   * Call Ollama via Electron app's HTTP API
   */
  private async callOllamaViaElectron(model: string, prompt: { system: string, user: string }): Promise<AgentExecutionResult> {
    try {
      console.log('[AgentExecutor] Calling Ollama via Electron API:', {
        model: model || 'mistral:7b',
        endpoint: 'http://127.0.0.1:51248/api/llm/chat'
      })
      
      const response = await fetch('http://127.0.0.1:51248/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model || 'mistral:7b',
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`)
      }
      
      const data = await response.json()
      
      if (!data.ok) {
        throw new Error(data.message || 'Ollama API returned an error')
      }
      
      return {
        success: true,
        content: data.data.content || '',
        tokensUsed: data.data.tokensUsed
      }
    } catch (error: any) {
      console.error('[AgentExecutor] Ollama call failed:', error)
      
      // Provide helpful error messages
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new Error('Cannot connect to Electron app. Please ensure the OpenGiraffe desktop app is running.')
      }
      
      throw error
    }
  }
}

// Export singleton instance
export const agentExecutor = new AgentExecutor()

