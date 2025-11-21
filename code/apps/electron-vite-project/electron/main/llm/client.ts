/**
 * LLM Client Service
 * Provider-agnostic abstraction layer for chat completions
 * Supports multiple providers (Ollama, OpenAI, Anthropic, etc.)
 */

import type { ChatCompletionRequest, ChatCompletionResponse, LlmConfig } from './types'

/**
 * Abstract LLM client interface
 */
export interface ILlmClient {
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse>
  isReady(): Promise<boolean>
}

/**
 * Ollama-specific client implementation
 */
export class OllamaLlmClient implements ILlmClient {
  constructor(private config: LlmConfig) {}
  
  /**
   * Send chat completion request to Ollama
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const modelId = request.modelId || this.config.modelId
    
    console.log('[OLLAMA CLIENT] Sending chat request:', {
      model: modelId,
      messages: request.messages.length,
      temperature: request.temperature
    })
    
    try {
      const response = await fetch(`${this.config.endpointUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: request.messages,
          stream: false, // Non-streaming for now
          options: {
            temperature: request.temperature ?? 0.7,
            num_predict: request.maxTokens ?? 2048
          }
        })
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[OLLAMA CLIENT] Request failed:', response.statusText, errorText)
        throw new Error(`Ollama request failed: ${response.statusText}`)
      }
      
      const data = await response.json()
      
      console.log('[OLLAMA CLIENT] Response received:', {
        tokens: data.eval_count,
        done: data.done
      })
      
      return {
        content: data.message?.content || '',
        tokensUsed: data.eval_count,
        model: modelId,
        raw: data
      }
    } catch (error: any) {
      console.error('[OLLAMA CLIENT] Error:', error)
      throw new Error(`Failed to communicate with Ollama: ${error.message}`)
    }
  }
  
  /**
   * Check if Ollama server is ready to accept requests
   */
  async isReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpointUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000)
      })
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Main LLM client service
 * Manages the active client instance based on configuration
 */
export class LlmClientService {
  private client: ILlmClient | null = null
  
  /**
   * Set the active LLM client based on configuration
   */
  setClient(config: LlmConfig): void {
    console.log('[LLM CLIENT] Setting client:', config.provider, config.modelId)
    
    if (config.provider === 'ollama') {
      this.client = new OllamaLlmClient(config)
    } else {
      // Future: OpenAI, Anthropic, Gemini clients
      throw new Error(`Provider not yet implemented: ${config.provider}`)
    }
  }
  
  /**
   * Send a chat completion request
   */
  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.client) {
      throw new Error('LLM client not initialized. Call setClient() first.')
    }
    return this.client.chat(request)
  }
  
  /**
   * Check if the client is ready to accept requests
   */
  async isReady(): Promise<boolean> {
    if (!this.client) return false
    return this.client.isReady()
  }
}

// Singleton instance
export const llmClientService = new LlmClientService()

