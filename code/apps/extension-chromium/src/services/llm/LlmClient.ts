/**
 * LLM Client
 * Wrapper for LLM calls via HTTP bridge to Electron app
 */

import type { ChatCompletionRequest, ChatCompletionResponse } from '../types/coordination'

/**
 * Send LLM request to Electron app via HTTP API
 * Used for agent execution that requires LLM processing
 */
export async function sendLlmRequest(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  try {
    console.log('[LlmClient] Sending LLM request:', {
      modelId: request.modelId,
      messageCount: request.messages.length,
      endpoint: 'http://127.0.0.1:51248/api/llm/chat'
    })
    
    const response = await fetch('http://127.0.0.1:51248/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120000) // 120 second timeout (2 minutes)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[LlmClient] HTTP error:', response.status, errorText)
      return {
        success: false,
        content: '',
        error: `HTTP ${response.status}: ${errorText}`
      }
    }
    
    const data = await response.json()
    
    if (!data.ok) {
      console.error('[LlmClient] API error:', data.message)
      return {
        success: false,
        content: '',
        error: data.message || 'LLM API returned an error'
      }
    }
    
    console.log('[LlmClient] LLM response received:', {
      contentLength: data.data?.content?.length,
      tokensUsed: data.data?.tokensUsed
    })
    
    return {
      success: true,
      content: data.data.content || '',
      tokensUsed: data.data.tokensUsed,
      model: data.data.model
    }
  } catch (error: any) {
    console.error('[LlmClient] Request failed:', error)
    
    // Provide helpful error messages
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return {
        success: false,
        content: '',
        error: 'Cannot connect to Electron app. Please ensure OpenGiraffe is running.'
      }
    }
    
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
      return {
        success: false,
        content: '',
        error: 'LLM request timed out. The model might be too large or system is under load.'
      }
    }
    
    return {
      success: false,
      content: '',
      error: error.message || 'Unknown error occurred'
    }
  }
}

/**
 * Check if Electron app with LLM service is available
 */
export async function checkLlmAvailability(): Promise<boolean> {
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

