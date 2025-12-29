/**
 * Mode Capabilities and Gating Logic
 * 
 * Defines which UI features are enabled/disabled based on current mode.
 * This module provides pure functions for determining UI state.
 */

import { Mode, ComposerMode, Role, UIState } from './uiState'

// =============================================================================
// Composer Button Configuration
// =============================================================================

export interface ComposerButtonConfig {
  id: ComposerMode
  icon: string
  label: string
  title: string
}

export const COMPOSER_BUTTONS: ComposerButtonConfig[] = [
  { id: 'text', icon: '✏️', label: 'Text', title: 'Text input' },
  { id: 'capsule', icon: '📦', label: 'Capsule', title: 'Capsule Builder' },
  { id: 'audio', icon: '🎙️', label: 'Audio', title: 'Audio input' },
  { id: 'video', icon: '📹', label: 'Video', title: 'Video input' },
  { id: 'ai_assist', icon: '✨', label: 'AI', title: 'AI Assist' }
]

// =============================================================================
// Mode-Based Capabilities
// =============================================================================

/**
 * Get which composer buttons are enabled for a given mode
 */
export function getEnabledComposerButtons(mode: Mode): Set<ComposerMode> {
  switch (mode) {
    case 'commands':
      // Commands: Text, Capsule, AI Assist enabled; Audio/Video disabled
      return new Set(['text', 'capsule', 'ai_assist'])
    
    case 'p2p':
    case 'group':
      // P2P/Group: Text, Capsule, AI Assist enabled; Audio/Video visible but disabled
      return new Set(['text', 'capsule', 'ai_assist'])
    
    case 'p2p_stream':
      // Stream: All enabled (placeholder for future)
      return new Set(['text', 'capsule', 'audio', 'video', 'ai_assist'])
    
    case 'admin_policies':
      // Admin: Composer hidden, return empty set
      return new Set()
    
    default:
      return new Set(['text'])
  }
}

/**
 * Check if a specific composer button is enabled
 */
export function isComposerButtonEnabled(mode: Mode, button: ComposerMode): boolean {
  return getEnabledComposerButtons(mode).has(button)
}

/**
 * Get the primary action button label based on mode
 */
export function getPrimaryButtonLabel(mode: Mode): string {
  switch (mode) {
    case 'commands':
      return 'Run'
    case 'p2p':
    case 'group':
    case 'p2p_stream':
      return 'Send'
    case 'admin_policies':
      return 'Apply'
    default:
      return 'Send'
  }
}

/**
 * Should the model indicator be shown in/near the primary button?
 * Only for Commands mode
 */
export function shouldShowModelInButton(mode: Mode): boolean {
  return mode === 'commands'
}

/**
 * Should the model selector be available?
 * In Commands mode: in button area
 * In other modes: only inside AI Assist popover
 */
export function getModelSelectorLocation(mode: Mode): 'button' | 'ai_assist_only' | 'hidden' {
  switch (mode) {
    case 'commands':
      return 'button'
    case 'p2p':
    case 'group':
    case 'p2p_stream':
      return 'ai_assist_only'
    case 'admin_policies':
      return 'hidden'
    default:
      return 'ai_assist_only'
  }
}

/**
 * Should the composer be visible at all?
 */
export function isComposerVisible(mode: Mode): boolean {
  return mode !== 'admin_policies'
}

/**
 * Should the admin mode option be visible in the mode selector?
 */
export function isAdminModeVisible(role: Role): boolean {
  return role === 'admin'
}

/**
 * Check if the current state allows a specific action
 */
export function canPerformAction(state: UIState, action: 'send' | 'run' | 'ai_assist'): boolean {
  const { mode, composerMode, workspace } = state
  
  // Non-chat workspaces have their own logic
  if (workspace !== 'wr-chat') {
    return true
  }
  
  switch (action) {
    case 'send':
      return mode !== 'admin_policies' && mode !== 'commands'
    case 'run':
      return mode === 'commands'
    case 'ai_assist':
      return composerMode === 'ai_assist' && isComposerButtonEnabled(mode, 'ai_assist')
    default:
      return false
  }
}

// =============================================================================
// Layout Configuration
// =============================================================================

export type LayoutType = 'chat' | 'stream' | 'admin'

/**
 * Get the layout type for a given mode
 */
export function getLayoutType(mode: Mode): LayoutType {
  switch (mode) {
    case 'p2p_stream':
      return 'stream'
    case 'admin_policies':
      return 'admin'
    default:
      return 'chat'
  }
}

/**
 * Should the chat message list be visible?
 */
export function isChatListVisible(mode: Mode): boolean {
  return getLayoutType(mode) !== 'admin'
}

/**
 * Should the video grid placeholder be visible?
 */
export function isVideoGridVisible(mode: Mode): boolean {
  return mode === 'p2p_stream'
}

// =============================================================================
// AI Assist Configuration
// =============================================================================

export interface AIAssistAction {
  id: string
  label: string
  description: string
}

export const AI_ASSIST_ACTIONS: AIAssistAction[] = [
  { id: 'improve', label: 'Improve', description: 'Enhance clarity and quality' },
  { id: 'rewrite', label: 'Rewrite', description: 'Rewrite with different tone' },
  { id: 'generate', label: 'Generate', description: 'Generate new content' }
]

export interface MockModel {
  id: string
  name: string
  description: string
}

export const MOCK_MODELS: MockModel[] = [
  { id: 'gemma', name: 'Gemma', description: 'Lightweight and fast' },
  { id: 'mistral', name: 'Mistral', description: 'Balanced performance' },
  { id: 'llama', name: 'Llama', description: 'High quality output' }
]

/**
 * Generate a mock AI response (placeholder)
 */
export function generateMockAIResponse(action: string, input: string): string {
  const prefix = {
    improve: '✨ Improved: ',
    rewrite: '📝 Rewritten: ',
    generate: '🤖 Generated: '
  }[action] || ''
  
  if (!input.trim()) {
    return `${prefix}Please enter some text first.`
  }
  
  // Simple mock transformation
  switch (action) {
    case 'improve':
      return `${prefix}${input.charAt(0).toUpperCase()}${input.slice(1)}. This has been enhanced for clarity.`
    case 'rewrite':
      return `${prefix}Here's an alternative way to express this: "${input}"`
    case 'generate':
      return `${prefix}Based on your input, here's a suggestion: ${input}. Consider expanding on this idea.`
    default:
      return input
  }
}







