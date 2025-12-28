/**
 * UI Store (Zustand)
 * 
 * Reactive state management for the Mode-Ready UI Shell.
 * Wraps the framework-agnostic state model from uiState.ts.
 */

import { create } from 'zustand'
import {
  UIState,
  Mode,
  Workspace,
  ComposerMode,
  Role,
  initialUIState,
  switchMode,
  switchWorkspace,
  setComposerMode,
  setRole,
  getDisplayLabel,
  getShortDisplayLabel,
  isPlaceholderMode,
  getAvailableModes
} from '../shared/ui/uiState'

// =============================================================================
// Store Interface
// =============================================================================

interface UIStoreState extends UIState {
  // Actions
  setMode: (mode: Mode) => void
  setWorkspace: (workspace: Workspace) => void
  setComposerMode: (composerMode: ComposerMode) => void
  setRole: (role: Role) => void
  reset: () => void
  
  // Derived getters (for convenience)
  getDisplayLabel: () => string
  getShortDisplayLabel: () => { workspace: string; mode: string }
  isPlaceholder: () => boolean
  getAvailableModes: () => Mode[]
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useUIStore = create<UIStoreState>((set, get) => ({
  // Initial state
  ...initialUIState,
  
  // Actions
  setMode: (mode: Mode) => {
    set(state => switchMode(state, mode))
  },
  
  setWorkspace: (workspace: Workspace) => {
    set(state => switchWorkspace(state, workspace))
  },
  
  setComposerMode: (composerMode: ComposerMode) => {
    set(state => setComposerMode(state, composerMode))
  },
  
  setRole: (role: Role) => {
    set(state => setRole(state, role))
  },
  
  reset: () => {
    set(initialUIState)
  },
  
  // Derived getters
  getDisplayLabel: () => getDisplayLabel(get()),
  
  getShortDisplayLabel: () => getShortDisplayLabel(get()),
  
  isPlaceholder: () => isPlaceholderMode(get()),
  
  getAvailableModes: () => getAvailableModes(get().role)
}))

// =============================================================================
// Selector Hooks (for optimized re-renders)
// =============================================================================

/**
 * Select only the workspace
 */
export const useWorkspace = () => useUIStore(state => state.workspace)

/**
 * Select only the mode
 */
export const useMode = () => useUIStore(state => state.mode)

/**
 * Select only the composer mode
 */
export const useComposerMode = () => useUIStore(state => state.composerMode)

/**
 * Select only the role
 */
export const useRole = () => useUIStore(state => state.role)

/**
 * Select workspace and mode together (for mode selector)
 */
export const useWorkspaceAndMode = () => useUIStore(state => ({
  workspace: state.workspace,
  mode: state.mode
}))

/**
 * Check if we're in a placeholder mode
 */
export const useIsPlaceholder = () => useUIStore(state => isPlaceholderMode(state))

// =============================================================================
// Debug Helper (for development)
// =============================================================================

/**
 * Toggle admin role for testing (development only)
 */
export function toggleAdminRole() {
  const currentRole = useUIStore.getState().role
  useUIStore.getState().setRole(currentRole === 'admin' ? 'user' : 'admin')
}

// Expose to window for debugging in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__uiStore = useUIStore;
  (window as any).__toggleAdmin = toggleAdminRole
}







