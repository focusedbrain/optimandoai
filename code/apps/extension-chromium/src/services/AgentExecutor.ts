/**
 * Agent Execution Service
 * Handles execution of AI agents with LLM integration
 * Loads agent configurations from SQLite (default database)
 */

import type { ListenerSectionConfig, ExecutionSectionConfig, InputEventPayload, AgentExecutionResult as CoordAgentExecutionResult } from '../types/coordination'
import { sendLlmRequest } from './llm/LlmClient'

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
  listenerSection?: ListenerSectionConfig
  executionSection?: ExecutionSectionConfig
  isSystemAgent?: boolean
  systemAgentType?: "input_coordinator" | "output_coordinator"
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
   * Execute an agent with given input event
   * Used by InputCoordinator to run matched agents
   */
  async runAgentExecution(agentNumber: string | number, input: InputEventPayload): Promise<CoordAgentExecutionResult> {
    try {
      console.log('[AgentExecutionService] Running agent execution:', {
        agentNumber,
        source: input.source,
        text: input.text?.substring(0, 100)
      })
      
      // 1. Load agent configuration
      const agentConfig = await this.loadAgentConfig(agentNumber)
      
      if (!agentConfig) {
        throw new Error(`Agent ${agentNumber} not found`)
      }
      
      // Check if reasoning capability is enabled
      if (!agentConfig.capabilities.includes('reasoning')) {
        throw new Error(`Agent ${agentNumber} does not have reasoning capability enabled`)
      }
      
      if (!agentConfig.reasoning) {
        throw new Error(`Agent ${agentNumber} has no reasoning configuration`)
      }
      
      // 2. Load LLM settings from agent config
      const llmSettings = await this.loadGlobalLLMSettings(agentConfig)
      
      console.log('[AgentExecutionService] Using LLM settings:', llmSettings)
      
      // 3. Build prompt from agent's reasoning section + input
      const prompt = this.buildPromptFromInput(agentConfig, input)
      
      console.log('[AgentExecutionService] Generated prompt:', {
        systemLength: prompt.system.length,
        userLength: prompt.user.length
      })
      
      // 4. Map provider+model to Ollama format if needed
      const ollamaModel = this.getOllamaModelName(llmSettings.provider, llmSettings.model)
      
      console.log('[AgentExecutionService] Calling LLM with model:', ollamaModel)
      
      // 5. Call LLM via LlmClient with optimized settings for low-end hardware
      const llmResponse = await sendLlmRequest({
        modelId: ollamaModel,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        temperature: 0.3,  // Lower = faster, more focused
        maxTokens: 500     // Drastically reduced for speed (was 2000)
      })
      
      if (!llmResponse.success) {
        console.error('[AgentExecutionService] LLM call failed:', llmResponse.error)
        throw new Error(llmResponse.error || 'LLM call failed')
      }
      
      console.log('[AgentExecutionService] LLM response received:', {
        contentLength: llmResponse.content.length,
        tokensUsed: llmResponse.tokensUsed
      })
      
      return {
        success: true,
        content: llmResponse.content,
        tokensUsed: llmResponse.tokensUsed,
        agentNumber
      }
    } catch (error: any) {
      console.error('[AgentExecutionService] Execution failed:', error)
      return {
        success: false,
        content: '',
        error: error.message || 'Unknown error',
        agentNumber
      }
    }
  }
  
  /**
   * Build prompt from agent config and input event
   */
  private buildPromptFromInput(agentConfig: AgentConfig, input: InputEventPayload): { system: string, user: string } {
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
    
    // Add input metadata as context
    if (input.metadata) {
      systemParts.push(`\n\nContext:\n${JSON.stringify(input.metadata, null, 2)}`)
    }
    
    const systemMessage = systemParts.join('\n')
    
    // User message is the actual input text
    const userMessage = input.text || 'Process the provided context and respond according to your goals and role.'
    
    return {
      system: systemMessage,
      user: userMessage
    }
  }
  
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
   * Load agent configuration from SQLite (default database)
   */
  private async loadAgentConfig(agentNumber: string | number): Promise<AgentConfig | null> {
    try {
      // Convert agent number to name format
      const agentName = typeof agentNumber === 'number' 
        ? `agent${String(agentNumber).padStart(2, '0')}`
        : agentNumber
      
      const storageKey = `agent_${agentName}_instructions`
      
      console.log('[AgentExecutor] Loading agent config from SQLite:', storageKey)
      
      // Load from SQLite via Electron app HTTP API
      const response = await fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(storageKey)}`, {
        signal: AbortSignal.timeout(5000)
      })
      
      if (!response.ok) {
        console.warn('[AgentExecutor] Failed to load agent config from SQLite:', response.statusText)
        return null
      }
      
      const result = await response.json()
      
      if (!result.success || !result.data) {
        console.warn('[AgentExecutor] No agent config found in SQLite for key:', storageKey)
        return null
      }
      
      const configData = result.data
      const config = typeof configData === 'string' ? JSON.parse(configData) : configData
      
      console.log('[AgentExecutor] Loaded agent config:', {
        agent: agentName,
        hasReasoning: !!config.reasoning,
        capabilities: config.capabilities
      })
      
      return config as AgentConfig
    } catch (error: any) {
      console.error('[AgentExecutor] Failed to load agent config:', error)
      return null
    }
  }
  
  /**
   * Load agent box LLM settings from SQLite
   */
  private async loadAgentBoxLLMSettings(boxId: string): Promise<LLMSettings> {
    try {
      console.log('[AgentExecutor] Loading agent box LLM settings from SQLite:', boxId)
      
      // Agent boxes are stored in session data in SQLite
      // We need to find the session that contains this box
      const keysResponse = await fetch('http://127.0.0.1:51248/api/orchestrator/keys', {
        signal: AbortSignal.timeout(5000)
      })
      
      if (!keysResponse.ok) {
        console.warn('[AgentExecutor] Failed to get session keys from SQLite')
        return { provider: 'Ollama', model: 'mistral:7b' }
      }
      
      const keysResult = await keysResponse.json()
      const sessionKeys = keysResult.data || []
      
      // Search through sessions for the agent box
      for (const key of sessionKeys) {
        const sessionResponse = await fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(5000)
        })
        
        if (!sessionResponse.ok) continue
        
        const sessionResult = await sessionResponse.json()
        if (!sessionResult.success || !sessionResult.data) continue
        
        const sessionData = typeof sessionResult.data === 'string' 
          ? JSON.parse(sessionResult.data) 
          : sessionResult.data
        
        // Check if this session has our agent box
        if (sessionData.agentBoxes && Array.isArray(sessionData.agentBoxes)) {
          const box = sessionData.agentBoxes.find((b: any) => b.id === boxId)
          if (box && box.provider && box.model) {
            console.log('[AgentExecutor] Found agent box settings:', {
              provider: box.provider,
              model: box.model
            })
            return {
              provider: box.provider,
              model: box.model
            }
          }
        }
      }
      
      console.warn('[AgentExecutor] Agent box not found in SQLite, using default')
      return { provider: 'Ollama', model: 'mistral:7b' }
    } catch (error: any) {
      console.error('[AgentExecutor] Failed to load agent box settings:', error)
      return { provider: 'Ollama', model: 'mistral:7b' }
    }
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
    
    // Check for global settings in SQLite
    try {
      const response = await fetch('http://127.0.0.1:51248/api/orchestrator/get?key=globalLLMSettings', {
        signal: AbortSignal.timeout(5000)
      })
      
      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          const settings = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
          if (settings.provider && settings.model) {
            return {
              provider: settings.provider,
              model: settings.model
            }
          }
        }
      }
    } catch (error: any) {
      console.warn('[AgentExecutor] Failed to load global LLM settings:', error)
    }
    
    // Default to Ollama with Mistral 7B
    return {
      provider: 'Ollama',
      model: 'mistral:7b'
    }
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
    
    // Determine runtime based on provider
    // Mistral, Meta, Microsoft → Use Ollama locally
    // OpenAI, Anthropic, Google, xAI → Use their respective APIs
    
    if (provider === 'mistral' || provider === 'meta' || provider === 'microsoft') {
      // Use Ollama for local models
      return await this.callOllamaViaElectron(settings.provider, settings.model, prompt)
    } else if (provider === 'openai' || provider === 'anthropic' || provider === 'google' || provider === 'xai') {
      // For cloud providers, throw error for now (will be implemented later)
      throw new Error(`Provider "${settings.provider}" API integration is not yet implemented. Only local models (Mistral, Meta, Microsoft) are currently supported via Ollama.`)
    } else {
      throw new Error(`Unknown provider: "${settings.provider}". Please select a valid provider (Mistral, Meta, Microsoft, OpenAI, Anthropic, Google, xAI).`)
    }
  }
  
  /**
   * Call Ollama via Electron app's HTTP API
   * Used for local models from Mistral, Meta, and Microsoft
   */
  private async callOllamaViaElectron(provider: string, model: string, prompt: { system: string, user: string }): Promise<AgentExecutionResult> {
    try {
      // Check if Electron app is running
      const isElectronRunning = await this.checkElectronConnection()
      if (!isElectronRunning) {
        throw new Error('Cannot connect to Electron app. Please ensure the OpenGiraffe desktop app is running.')
      }
      
      // Check if Ollama is running
      const isOllamaReady = await this.checkOllamaRunning()
      if (!isOllamaReady) {
        throw new Error('Ollama is not running. Please start Ollama or check LLM settings in the Backend Configuration.')
      }
      
      // Map provider + model to Ollama model name
      const ollamaModel = this.getOllamaModelName(provider, model)
      
      console.log('[AgentExecutor] Calling Ollama via Electron API:', {
        provider,
        model,
        ollamaModel,
        endpoint: 'http://127.0.0.1:51248/api/llm/chat'
      })
      
      const response = await fetch('http://127.0.0.1:51248/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: ollamaModel,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        }),
        signal: AbortSignal.timeout(60000) // 60 second timeout
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
      
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        throw new Error('LLM request timed out. The model might be too large or the system is under heavy load.')
      }
      
      throw error
    }
  }
  
  /**
   * Map provider + model to Ollama model name
   * E.g. Mistral + 7b → mistral:7b
   */
  private getOllamaModelName(provider: string, model: string): string {
    const p = provider.toLowerCase()
    const m = model.toLowerCase()
    
    // Mistral models
    if (p === 'mistral') {
      if (m === '7b') return 'mistral:7b'
      if (m === '14b') return 'mistral:14b'
      return `mistral:${m}`
    }
    
    // Meta models (Llama)
    if (p === 'meta') {
      if (m === 'llama-3-8b') return 'llama3:8b'
      if (m === 'llama-3-70b') return 'llama3:70b'
      return `llama3:${m}`
    }
    
    // Microsoft models (Phi)
    if (p === 'microsoft') {
      if (m === 'phi-3-mini') return 'phi3:mini'
      if (m === 'phi-3-medium') return 'phi3:medium'
      return `phi3:${m}`
    }
    
    // Fallback: use provider:model format
    return `${p}:${m}`
  }
  
  /**
   * Check if Electron app is running and reachable
   */
  private async checkElectronConnection(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:51248/api/llm/status', {
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch {
      return false
    }
  }
  
  /**
   * Check if Ollama is running and ready
   */
  private async checkOllamaRunning(): Promise<boolean> {
    try {
      const response = await fetch('http://127.0.0.1:51248/api/llm/status', {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) {
        const data = await response.json()
        return data.ok && data.data?.ollamaRunning === true
      }
      return false
    } catch {
      return false
    }
  }
}

// Export singleton instance
export const agentExecutor = new AgentExecutor()

