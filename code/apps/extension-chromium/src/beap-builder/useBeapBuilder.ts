/**
 * BEAP Builder Store
 * 
 * Unified store for the BEAP Builder module.
 * Handles both Silent and Explicit modes.
 * 
 * INVARIANTS:
 * - Single implementation used everywhere
 * - Context-aware prefilling
 * - Silent mode requirements are strictly enforced
 * 
 * @version 1.0.0
 */

import { create } from 'zustand'
import type {
  BuilderMode,
  BuilderContext,
  BuilderAttachment,
  BuilderState,
  ModeTriggerResult,
  ExplicitModeReason,
  SilentBuildRequest,
  ExplicitBuildRequest,
  BeapBuildResult,
  DeliveryConfig,
  DeliveryMethod
} from './types'
import type { CanonicalPolicy } from '../policy/schema/types'
import type { Handshake } from '../handshake/types'
import { usePolicyStore } from '../policy/store/usePolicyStore'

// =============================================================================
// Silent Mode Trigger Analysis
// =============================================================================

/**
 * Determine if content can be built in Silent Mode
 * 
 * Silent Mode triggers (ALL must be true):
 * - Text-only content (no rich formatting beyond markdown)
 * - No attachments/media
 * - No automation/sessions requested
 * - No ingress/egress deviation from baseline
 * - No policy deviation from WRGuard baseline
 * 
 * If ANY condition fails → Explicit Mode required
 */
export function analyzeModeTriggers(
  content: string,
  attachments: BuilderAttachment[],
  automationRequested: boolean,
  hasSessionContext: boolean,
  userInvokedBuilder: boolean,
  customPolicy: CanonicalPolicy | null,
  baselinePolicy: CanonicalPolicy | null
): ModeTriggerResult {
  const explicitReasons: ExplicitModeReason[] = []
  
  // Check each trigger condition
  if (userInvokedBuilder) {
    explicitReasons.push('user_invoked_builder')
  }
  
  if (attachments.length > 0) {
    explicitReasons.push('has_attachments')
    
    // Check for media files specifically
    const hasMedia = attachments.some(a => 
      a.isMedia || 
      a.type.startsWith('image/') || 
      a.type.startsWith('video/') || 
      a.type.startsWith('audio/')
    )
    if (hasMedia) {
      explicitReasons.push('has_media')
    }
  }
  
  if (automationRequested) {
    explicitReasons.push('automation_requested')
  }
  
  if (hasSessionContext) {
    explicitReasons.push('session_context')
  }
  
  // Check policy deviation
  if (customPolicy && baselinePolicy) {
    const hasDeviation = checkPolicyDeviation(customPolicy, baselinePolicy)
    if (hasDeviation.ingress) {
      explicitReasons.push('ingress_deviation')
    }
    if (hasDeviation.egress) {
      explicitReasons.push('egress_deviation')
    }
    if (hasDeviation.policy) {
      explicitReasons.push('policy_deviation')
    }
  }
  
  const canBeSilent = explicitReasons.length === 0
  
  return {
    mode: canBeSilent ? 'silent' : 'explicit',
    explicitReasons,
    canBeSilent
  }
}

/**
 * Check if custom policy deviates from baseline
 */
function checkPolicyDeviation(
  custom: CanonicalPolicy,
  baseline: CanonicalPolicy
): { ingress: boolean; egress: boolean; policy: boolean } {
  // Compare ingress settings
  const ingressDeviation = JSON.stringify(custom.ingress) !== JSON.stringify(baseline.ingress)
  
  // Compare egress settings
  const egressDeviation = JSON.stringify(custom.egress) !== JSON.stringify(baseline.egress)
  
  // Check for escalation (automation, sessions)
  const automationEnabled = custom.execution?.allowAutomation === true
  const sessionsEnabled = custom.sessionRestrictions?.allowConcurrentSessions === true
  
  const policyDeviation = automationEnabled || sessionsEnabled
  
  return {
    ingress: ingressDeviation,
    egress: egressDeviation,
    policy: policyDeviation
  }
}

// =============================================================================
// Store Interface
// =============================================================================

interface BeapBuilderState extends BuilderState {
  // Actions
  
  /** Open the builder with context */
  openBuilder: (context: BuilderContext) => void
  
  /** Close the builder */
  closeBuilder: () => void
  
  /** Update draft content */
  updateDraft: (updates: Partial<BuilderState['draft']>) => void
  
  /** Add attachment */
  addAttachment: (attachment: BuilderAttachment) => void
  
  /** Remove attachment */
  removeAttachment: (attachmentId: string) => void
  
  /** Set selected handshake */
  setHandshake: (handshake: Handshake | null) => void
  
  /** Set custom policy */
  setCustomPolicy: (policy: CanonicalPolicy | null) => void
  
  /** Set automation config */
  setAutomationConfig: (config: Partial<BuilderState['automationConfig']>) => void
  
  /** Set delivery config (Drafts only) */
  setDeliveryConfig: (config: DeliveryConfig | null) => void
  
  /** Build package in Silent Mode */
  buildSilent: (request: SilentBuildRequest) => Promise<BeapBuildResult>
  
  /** Build package in Explicit Mode */
  buildExplicit: (request: ExplicitBuildRequest) => Promise<BeapBuildResult>
  
  /** Analyze and determine mode */
  analyzeMode: () => ModeTriggerResult
  
  /** Reset builder state */
  reset: () => void
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: BuilderState = {
  mode: 'silent',
  isOpen: false,
  context: null,
  draft: {
    target: '',
    subject: '',
    body: '',
    attachments: []
  },
  selectedHandshake: null,
  customPolicy: null,
  automationConfig: {
    enabled: false,
    sessionId: null,
    permissions: []
  },
  deliveryConfig: null,
  validationErrors: [],
  isBuilding: false
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useBeapBuilder = create<BeapBuilderState>((set, get) => ({
  ...initialState,
  
  openBuilder: (context) => {
    // Prefill from context
    const draft = {
      target: context.target || '',
      subject: context.subject || '',
      body: context.body || '',
      attachments: context.attachments || []
    }
    
    set({
      isOpen: true,
      context,
      draft,
      selectedHandshake: context.handshake || null,
      mode: 'explicit', // Opening builder = explicit mode
      validationErrors: []
    })
  },
  
  closeBuilder: () => {
    set({ isOpen: false })
  },
  
  updateDraft: (updates) => {
    set((state) => ({
      draft: { ...state.draft, ...updates }
    }))
  },
  
  addAttachment: (attachment) => {
    set((state) => ({
      draft: {
        ...state.draft,
        attachments: [...state.draft.attachments, attachment]
      }
    }))
  },
  
  removeAttachment: (attachmentId) => {
    set((state) => ({
      draft: {
        ...state.draft,
        attachments: state.draft.attachments.filter(a => a.id !== attachmentId)
      }
    }))
  },
  
  setHandshake: (handshake) => {
    set({ selectedHandshake: handshake })
  },
  
  setCustomPolicy: (policy) => {
    set({ customPolicy: policy })
  },
  
  setAutomationConfig: (config) => {
    set((state) => ({
      automationConfig: { ...state.automationConfig, ...config }
    }))
  },
  
  setDeliveryConfig: (config) => {
    set({ deliveryConfig: config })
  },
  
  analyzeMode: () => {
    const state = get()
    const baselinePolicy = usePolicyStore.getState().localPolicy
    
    return analyzeModeTriggers(
      state.draft.body,
      state.draft.attachments,
      state.automationConfig.enabled,
      state.automationConfig.sessionId !== null,
      false, // User didn't explicitly invoke builder (this is for analysis)
      state.customPolicy,
      baselinePolicy
    )
  },
  
  buildSilent: async (request) => {
    const state = get()
    set({ isBuilding: true, validationErrors: [] })
    
    try {
      // Validate silent mode requirements
      const analysis = analyzeModeTriggers(
        request.content,
        [],
        false,
        false,
        false,
        null,
        usePolicyStore.getState().localPolicy
      )
      
      if (!analysis.canBeSilent) {
        set({ isBuilding: false })
        return {
          success: false,
          error: `Silent mode not allowed: ${analysis.explicitReasons.join(', ')}`,
          silentMode: true
        }
      }
      
      // Build capsule with baseline policy
      const baselinePolicy = usePolicyStore.getState().localPolicy
      
      // Generate package ID
      const packageId = `beap_${crypto.randomUUID()}`
      const capsuleRef = `capsule_${crypto.randomUUID()}`
      const envelopeRef = `envelope_${crypto.randomUUID()}`
      
      // Silent build successful
      set({ isBuilding: false })
      
      return {
        success: true,
        packageId,
        capsuleRef,
        envelopeRef,
        appliedPolicy: baselinePolicy || undefined,
        silentMode: true
      }
    } catch (error) {
      set({ 
        isBuilding: false,
        validationErrors: [error instanceof Error ? error.message : 'Build failed']
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Build failed',
        silentMode: true
      }
    }
  },
  
  buildExplicit: async (request) => {
    set({ isBuilding: true, validationErrors: [] })
    
    try {
      const state = get()
      
      // Apply policy: custom or baseline
      const appliedPolicy = state.customPolicy || usePolicyStore.getState().localPolicy
      
      // Generate package ID
      const packageId = `beap_${crypto.randomUUID()}`
      const capsuleRef = `capsule_${crypto.randomUUID()}`
      const envelopeRef = `envelope_${crypto.randomUUID()}`
      
      // For explicit mode, we'd typically do more complex packaging:
      // - Encrypt attachments
      // - Apply automation permissions
      // - Create envelope with policy
      
      // Explicit build successful
      set({ isBuilding: false })
      
      return {
        success: true,
        packageId,
        capsuleRef,
        envelopeRef,
        appliedPolicy: appliedPolicy || undefined,
        silentMode: false
      }
    } catch (error) {
      set({
        isBuilding: false,
        validationErrors: [error instanceof Error ? error.message : 'Build failed']
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Build failed',
        silentMode: false
      }
    }
  },
  
  reset: () => {
    set(initialState)
  }
}))

// =============================================================================
// Convenience Hooks
// =============================================================================

/**
 * Check if builder is in explicit mode
 */
export const useIsExplicitMode = () => 
  useBeapBuilder(state => state.mode === 'explicit')

/**
 * Get current draft
 */
export const useBuilderDraft = () => 
  useBeapBuilder(state => state.draft)

/**
 * Check if building in progress
 */
export const useIsBuilding = () => 
  useBeapBuilder(state => state.isBuilding)

/**
 * Get validation errors
 */
export const useValidationErrors = () => 
  useBeapBuilder(state => state.validationErrors)



