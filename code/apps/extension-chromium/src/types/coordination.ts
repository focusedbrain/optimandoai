/**
 * Coordination Types
 * Shared types for Agent Input/Output coordination system
 */

/**
 * Listener section configuration for agents
 * Controls how agents receive and filter input
 */
export interface ListenerSectionConfig {
  enabled: boolean
  patterns?: string[]
  inputSources?: ("command" | "dom")[]
  inputTypes?: string[]
  priority?: number
}

/**
 * Execution section configuration for agents
 * Controls where and how agent output is displayed
 */
export interface ExecutionSectionConfig {
  targetOutputAgentBoxId?: string
  displayMode?: "chat" | "overlay" | "notification"
  appendMode?: "append" | "replace"
}

/**
 * Input event payload
 * Normalized input from command chat or DOM events
 */
export interface InputEventPayload {
  sessionId: string
  source: "command" | "dom"
  text?: string
  inputType?: string
  metadata?: any
}

/**
 * System agent configuration marker
 * Marks special system agents (input/output coordinators)
 */
export interface SystemAgentConfig {
  isSystemAgent: true
  systemAgentType: "input_coordinator" | "output_coordinator"
}

/**
 * Agent execution result from LLM
 */
export interface AgentExecutionResult {
  success: boolean
  content: string
  error?: string
  tokensUsed?: number
  agentNumber: string | number
}

/**
 * Chat completion request for LLM
 */
export interface ChatCompletionRequest {
  modelId?: string
  messages: Array<{
    role: "system" | "user" | "assistant"
    content: string
  }>
  maxTokens?: number
  temperature?: number
}

/**
 * Chat completion response from LLM
 */
export interface ChatCompletionResponse {
  success: boolean
  content: string
  tokensUsed?: number
  model?: string
  error?: string
}

