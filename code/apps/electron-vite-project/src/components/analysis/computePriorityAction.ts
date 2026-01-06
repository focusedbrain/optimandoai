/**
 * Priority Action Computation
 * 
 * Deterministic pure function to compute the highest priority action
 * across all analysis phases.
 * 
 * Priority tiers (highest first):
 * P0 - User action required NOW (consent/policy gate)
 * P1 - Verification/integrity critical (PoAE review, mismatches)
 * P2 - Operational attention (live execution monitoring)
 * P3 - Informational (completed verification, no action)
 */

import type { AnalysisPhase } from './canvasState'

// =============================================================================
// Types
// =============================================================================

export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3'

export type ActionStatus = 'action-required' | 'review' | 'monitor' | 'info'

export interface PrimaryCTA {
  label: string
  targetTab: AnalysisPhase
  deepLink?: {
    ruleId?: string
    eventId?: string
    drawerTab?: 'evidence' | 'risks'
  }
}

export interface PriorityAction {
  tier: PriorityTier
  status: ActionStatus
  title: string
  message: string
  primaryCta: PrimaryCTA
  secondaryCta?: PrimaryCTA
  // Supporting facts for display
  facts: {
    failedGates?: number
    pendingConsents?: number
    mismatchCount?: number
    activeRisks?: number
    liveEventCount?: number
    poaeReady?: boolean
    completedStatus?: 'success' | 'failed'
  }
}

// =============================================================================
// Mock Data Snapshots (same as component mock data)
// =============================================================================

export interface PreExecutionSnapshot {
  failedGates: number
  pendingConsents: number
  mismatchCount: number
  riskLevel: 'low' | 'medium' | 'high'
  blockingIssues: number
}

export interface LiveExecutionSnapshot {
  isStreaming: boolean
  eventCount: number
  unresolvedConsents: number
  activeWarnings: number
  criticalRisks: number
}

export interface PostExecutionSnapshot {
  hasExecution: boolean
  status: 'completed' | 'failed' | 'pending'
  poaeReady: boolean
  verificationComplete: boolean
}

export interface DashboardState {
  preExecution: PreExecutionSnapshot
  liveExecution: LiveExecutionSnapshot
  postExecution: PostExecutionSnapshot
}

// =============================================================================
// Mock Data Generator (deterministic)
// =============================================================================

/**
 * Generate mock dashboard state based on existing mock data structures
 * This mirrors the mock data in PreExecutionAnalysis, LiveExecutionAnalysis, etc.
 */
export function getMockDashboardState(): DashboardState {
  return {
    preExecution: {
      failedGates: 0,        // All gates passed - policy-driven with guardrails
      pendingConsents: 0,    // No pending consents
      mismatchCount: 1,      // One annotation for transparency
      riskLevel: 'low',      // Nominal operation
      blockingIssues: 0      // No blocking issues
    },
    liveExecution: {
      isStreaming: true,     // Active processing
      eventCount: 7,         // Events processed
      unresolvedConsents: 0, // No pending consents
      activeWarnings: 0,     // No warnings
      criticalRisks: 0       // System operating normally
    },
    postExecution: {
      hasExecution: true,
      status: 'completed',
      poaeReady: true,       // PoAE ready for review
      verificationComplete: true
    }
  }
}

// =============================================================================
// Priority Action Computation (Pure Function)
// =============================================================================

/**
 * Compute the highest priority action from dashboard state
 * 
 * Priority order:
 * 1. P0: Pending consents or failed policy gates (action required)
 * 2. P1: PoAE artefacts ready for review, or critical mismatches
 * 3. P2: Active live execution requiring monitoring
 * 4. P3: Informational - completed verification
 */
export function computePriorityAction(state: DashboardState): PriorityAction {
  const { preExecution, liveExecution, postExecution } = state

  // ==========================================================================
  // P0: User action required NOW
  // ==========================================================================
  
  // Check for pending consents in live execution
  if (liveExecution.unresolvedConsents > 0) {
    return {
      tier: 'P0',
      status: 'action-required',
      title: 'Approval Request',
      message: `${liveExecution.unresolvedConsents} approval request${liveExecution.unresolvedConsents > 1 ? 's' : ''} awaiting your decision to continue processing.`,
      primaryCta: {
        label: 'Review & Approve',
        targetTab: 'live',
        deepLink: { drawerTab: 'evidence' }
      },
      secondaryCta: {
        label: 'View Events',
        targetTab: 'live'
      },
      facts: {
        pendingConsents: liveExecution.unresolvedConsents,
        liveEventCount: liveExecution.eventCount
      }
    }
  }

  // Check for policy gates requiring review
  if (preExecution.failedGates > 0) {
    return {
      tier: 'P0',
      status: 'action-required',
      title: 'Policy Review Required',
      message: `${preExecution.failedGates} policy gate${preExecution.failedGates > 1 ? 's' : ''} require${preExecution.failedGates === 1 ? 's' : ''} your review before proceeding.`,
      primaryCta: {
        label: 'Review Policies',
        targetTab: 'pre-execution'
      },
      secondaryCta: {
        label: 'View Details',
        targetTab: 'pre-execution',
        deepLink: { drawerTab: 'risks' }
      },
      facts: {
        failedGates: preExecution.failedGates,
        pendingConsents: preExecution.pendingConsents,
        mismatchCount: preExecution.mismatchCount
      }
    }
  }

  // Check for pending consents in pre-execution
  if (preExecution.pendingConsents > 0) {
    return {
      tier: 'P0',
      status: 'action-required',
      title: 'Consent Pending',
      message: `${preExecution.pendingConsents} consent requirement${preExecution.pendingConsents > 1 ? 's' : ''} awaiting approval before execution can proceed.`,
      primaryCta: {
        label: 'Give Consent',
        targetTab: 'pre-execution'
      },
      facts: {
        pendingConsents: preExecution.pendingConsents,
        failedGates: preExecution.failedGates
      }
    }
  }

  // ==========================================================================
  // P1: Verification / integrity critical
  // ==========================================================================

  // PoAE artefacts ready for review
  if (postExecution.poaeReady && !postExecution.verificationComplete) {
    return {
      tier: 'P1',
      status: 'review',
      title: 'PoAE™ Artefact Ready',
      message: 'Proof of Autonomous Execution artefact has been generated and requires review or export.',
      primaryCta: {
        label: 'Review PoAE',
        targetTab: 'post-execution'
      },
      secondaryCta: {
        label: 'Export Evidence',
        targetTab: 'post-execution'
      },
      facts: {
        poaeReady: true,
        completedStatus: postExecution.status === 'completed' ? 'success' : 'failed'
      }
    }
  }

  // Annotations in pre-execution alignment
  if (preExecution.mismatchCount > 0 && preExecution.riskLevel === 'high') {
    return {
      tier: 'P1',
      status: 'review',
      title: 'Template Annotations Available',
      message: `${preExecution.mismatchCount} annotation${preExecution.mismatchCount > 1 ? 's' : ''} highlight${preExecution.mismatchCount === 1 ? 's' : ''} passages in the automation template that may need attention.`,
      primaryCta: {
        label: 'View Annotations',
        targetTab: 'pre-execution',
        deepLink: { drawerTab: 'risks' }
      },
      facts: {
        mismatchCount: preExecution.mismatchCount,
        activeRisks: preExecution.blockingIssues
      }
    }
  }

  // Flagged items in live execution
  if (liveExecution.criticalRisks > 0) {
    return {
      tier: 'P1',
      status: 'review',
      title: 'Flagged Items for Review',
      message: `${liveExecution.criticalRisks} item${liveExecution.criticalRisks > 1 ? 's' : ''} flagged during live execution for your attention.`,
      primaryCta: {
        label: 'Review Items',
        targetTab: 'live',
        deepLink: { drawerTab: 'risks' }
      },
      facts: {
        activeRisks: liveExecution.criticalRisks,
        liveEventCount: liveExecution.eventCount
      }
    }
  }

  // ==========================================================================
  // P2: Operational attention
  // ==========================================================================

  // Active live execution
  if (liveExecution.isStreaming && liveExecution.eventCount > 0) {
    return {
      tier: 'P2',
      status: 'monitor',
      title: 'Processing Active',
      message: `Automation running smoothly with ${liveExecution.eventCount} event${liveExecution.eventCount > 1 ? 's' : ''} processed. All guardrails active.`,
      primaryCta: {
        label: 'View Details',
        targetTab: 'live'
      },
      facts: {
        liveEventCount: liveExecution.eventCount,
        activeRisks: liveExecution.activeWarnings
      }
    }
  }

  // ==========================================================================
  // P3: Informational
  // ==========================================================================

  // Completed execution
  if (postExecution.hasExecution && postExecution.status === 'completed') {
    return {
      tier: 'P3',
      status: 'info',
      title: 'Execution Completed',
      message: 'Most recent execution completed successfully. Review the verification summary for details.',
      primaryCta: {
        label: 'View Summary',
        targetTab: 'post-execution'
      },
      facts: {
        completedStatus: 'success',
        poaeReady: postExecution.poaeReady
      }
    }
  }

  // Default: No specific action
  return {
    tier: 'P3',
    status: 'info',
    title: 'Ready for Analysis',
    message: 'No active executions or pending actions. Start a new analysis session to begin.',
    primaryCta: {
      label: 'Start Pre-Execution',
      targetTab: 'pre-execution'
    },
    facts: {}
  }
}

// =============================================================================
// Status Badge Helpers
// =============================================================================

export function getStatusLabel(status: ActionStatus): string {
  switch (status) {
    case 'action-required': return 'ACTION REQUIRED'
    case 'review': return 'REVIEW NEEDED'
    case 'monitor': return 'MONITORING'
    case 'info': return 'INFORMATION'
  }
}

export function getStatusColor(status: ActionStatus): string {
  switch (status) {
    case 'action-required': return 'critical'
    case 'review': return 'high'
    case 'monitor': return 'medium'
    case 'info': return 'info'
  }
}

