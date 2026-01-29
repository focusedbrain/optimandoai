// Type definitions for AI Orchestration System
// Optimando AI - Multi-AI-Agenten Workflow Orchestrator

export interface AIAgent {
  id: string
  name: string
  instructions: string
  context: string[]
  memory: AgentMemory
  displaySlot?: string
  isActive: boolean
  capabilities: string[]
  parameters: Record<string, any>
}

export interface AgentMemory {
  shortTerm: string[]
  longTerm: string[]
  episodic: string[]
  semantic: Record<string, any>
}

export interface AgentContext {
  tabId: string
  url: string
  pageTitle: string
  userGoals: string[]
  previousActions: string[]
  environment: Record<string, any>
}

export interface OrchestrationTemplate {
  id: string
  name: string
  description: string
  agents: AIAgent[]
  workflow: WorkflowStep[]
  triggers: string[]
  displayConfig: DisplaySlot[]
  version: string
  author: string
  tags: string[]
}

export interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'condition' | 'loop' | 'parallel' | 'wait'
  agentId?: string
  condition?: string
  nextSteps: string[]
  parameters: Record<string, any>
}

export interface DisplaySlot {
  id: string
  name: string
  position: 'left' | 'right' | 'bottom' | 'modal' | 'inline'
  width?: number
  height?: number
  agentIds: string[]
  displayType: 'text' | 'markdown' | 'html' | 'json' | 'chart'
}

export interface RuntimeInjection {
  templateId: string
  source: 'wrdesk.com' | 'local' | 'user'
  downloadUrl?: string
  qrCode?: string
  validationHash: string
  permissions: string[]
}

export interface OrchestrationConfig {
  activeTemplates: string[]
  globalSettings: {
    autoStart: boolean
    debugMode: boolean
    maxConcurrentAgents: number
    memoryRetention: number
  }
  displaySettings: {
    theme: 'dark' | 'light' | 'auto'
    fontSize: number
    animations: boolean
  }
  apiSettings: {
    endpoint: string
    apiKey?: string
    timeout: number
  }
}
