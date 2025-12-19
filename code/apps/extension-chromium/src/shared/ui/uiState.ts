/**
 * UI State Types and Transitions
 * 
 * Framework-agnostic state model for the Mode-Ready UI Shell.
 * This module contains pure types and transition functions that can be
 * used with any state management solution (Zustand, Redux, vanilla, etc.)
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Top-level workspace categories
 */
export type Workspace = 'wr-chat' | 'mailguard' | 'overlay'

/**
 * Modes within the WR Chat workspace
 */
export type Mode = 'commands' | 'p2p' | 'p2p_stream' | 'group' | 'admin_policies'

/**
 * Composer input modes
 */
export type ComposerMode = 'text' | 'capsule' | 'audio' | 'video' | 'ai_assist'

/**
 * User role for access control
 */
export type Role = 'user' | 'admin'

/**
 * Complete UI state interface
 */
export interface UIState {
  workspace: Workspace
  mode: Mode
  composerMode: ComposerMode
  role: Role
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default initial state
 * - Workspace: WR Chat
 * - Mode: Commands (default)
 * - Composer: Text input
 * - Role: User (change to 'admin' for testing admin features)
 */
export const initialUIState: UIState = {
  workspace: 'wr-chat',
  mode: 'commands',
  composerMode: 'text',
  role: 'user' // Change to 'admin' for testing admin features
}

// =============================================================================
// Mode Metadata
// =============================================================================

export interface ModeInfo {
  id: Mode
  label: string
  shortLabel: string
  icon: string
  description: string
  isPlaceholder: boolean
  requiresAdmin: boolean
}

export const MODE_INFO: Record<Mode, ModeInfo> = {
  commands: {
    id: 'commands',
    label: 'Commands',
    shortLabel: 'Commands',
    icon: '⚡',
    description: 'Execute commands and run AI models',
    isPlaceholder: false,
    requiresAdmin: false
  },
  p2p: {
    id: 'p2p',
    label: 'P2P Chat',
    shortLabel: 'P2P',
    icon: '💬',
    description: 'Peer-to-peer encrypted messaging',
    isPlaceholder: true,
    requiresAdmin: false
  },
  p2p_stream: {
    id: 'p2p_stream',
    label: 'P2P Stream',
    shortLabel: 'Stream',
    icon: '📹',
    description: 'Video streaming with chat',
    isPlaceholder: true,
    requiresAdmin: false
  },
  group: {
    id: 'group',
    label: 'Group Chat',
    shortLabel: 'Group',
    icon: '👥',
    description: 'Multi-user group messaging',
    isPlaceholder: true,
    requiresAdmin: false
  },
  admin_policies: {
    id: 'admin_policies',
    label: 'Admin – Policies',
    shortLabel: 'Policies',
    icon: '🛡️',
    description: 'Manage security policies',
    isPlaceholder: true,
    requiresAdmin: true
  }
}

export interface WorkspaceInfo {
  id: Workspace
  label: string
  icon: string
  description: string
}

export const WORKSPACE_INFO: Record<Workspace, WorkspaceInfo> = {
  'wr-chat': {
    id: 'wr-chat',
    label: 'WR Chat',
    icon: '💬',
    description: 'Command chat and messaging'
  },
  mailguard: {
    id: 'mailguard',
    label: 'WR MailGuard',
    icon: '🛡️',
    description: 'Secure email viewing'
  },
  overlay: {
    id: 'overlay',
    label: 'Augmented Overlay',
    icon: '🎯',
    description: 'In-page element interaction'
  }
}

// =============================================================================
// Pure Transition Functions
// =============================================================================

/**
 * Switch to a new mode
 * Resets composerMode to 'text' when switching modes
 */
export function switchMode(state: UIState, mode: Mode): UIState {
  // Don't allow switching to admin mode unless user is admin
  if (mode === 'admin_policies' && state.role !== 'admin') {
    return state
  }
  
  return {
    ...state,
    mode,
    composerMode: 'text' // Reset to text when switching modes
  }
}

/**
 * Switch to a new workspace
 * Resets mode to 'commands' when switching to wr-chat
 */
export function switchWorkspace(state: UIState, workspace: Workspace): UIState {
  return {
    ...state,
    workspace,
    mode: workspace === 'wr-chat' ? state.mode : 'commands',
    composerMode: 'text'
  }
}

/**
 * Set the composer input mode
 */
export function setComposerMode(state: UIState, composerMode: ComposerMode): UIState {
  return {
    ...state,
    composerMode
  }
}

/**
 * Set user role (for testing/mocking)
 */
export function setRole(state: UIState, role: Role): UIState {
  // If switching from admin to user, reset admin mode
  if (role === 'user' && state.mode === 'admin_policies') {
    return {
      ...state,
      role,
      mode: 'commands'
    }
  }
  return {
    ...state,
    role
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get display label for current workspace + mode
 */
export function getDisplayLabel(state: UIState): string {
  const workspace = WORKSPACE_INFO[state.workspace]
  if (state.workspace !== 'wr-chat') {
    return workspace.label
  }
  const mode = MODE_INFO[state.mode]
  return `${workspace.label} · ${mode.label}`
}

/**
 * Get short display label (for compact spaces)
 */
export function getShortDisplayLabel(state: UIState): { workspace: string; mode: string } {
  const workspace = WORKSPACE_INFO[state.workspace]
  const mode = MODE_INFO[state.mode]
  return {
    workspace: workspace.label,
    mode: state.workspace === 'wr-chat' ? mode.shortLabel : ''
  }
}

/**
 * Check if current mode is a placeholder (not yet functional)
 */
export function isPlaceholderMode(state: UIState): boolean {
  if (state.workspace !== 'wr-chat') {
    return false // MailGuard and Overlay are functional
  }
  return MODE_INFO[state.mode].isPlaceholder
}

/**
 * Get available modes for the current role
 */
export function getAvailableModes(role: Role): Mode[] {
  return (Object.keys(MODE_INFO) as Mode[]).filter(mode => {
    const info = MODE_INFO[mode]
    return !info.requiresAdmin || role === 'admin'
  })
}


