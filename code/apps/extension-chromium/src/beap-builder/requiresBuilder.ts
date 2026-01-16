/**
 * requiresBeapBuilder - Shared Helper
 * 
 * Single shared helper used by WR Chat, Group Sessions, and BEAP Drafts
 * to determine if the BEAP Builder must open.
 * 
 * RULE: Builder opens when ANY envelope-relevant content is present.
 * 
 * @version 1.0.0
 */

import type {
  BuilderRequiredResult,
  BuilderRequiredReason,
  CapsuleAttachment,
  CapsuleSessionRef,
  NetworkConstraints
} from './canonical-types'

// =============================================================================
// Context for Builder Decision
// =============================================================================

/**
 * Input context for requiresBeapBuilder check
 */
export interface BuilderDecisionContext {
  /** Attachments added */
  attachments: CapsuleAttachment[] | { id: string }[]
  
  /** Sessions selected */
  selectedSessions: CapsuleSessionRef[] | { sessionId: string }[]
  
  /** Data/automation request text */
  dataRequest: string
  
  /** Ingress constraints requested */
  ingressConstraints: string[] | null
  
  /** Egress constraints requested */
  egressConstraints: string[] | null
  
  /** User explicitly invoked builder */
  userInvoked: boolean
}

// =============================================================================
// Main Helper
// =============================================================================

/**
 * Determine if the BEAP Builder must open
 * 
 * Returns true if ANY of the following is present:
 * - attachments.length > 0
 * - selectedSessions.length > 0
 * - dataOrAutomationRequest is non-empty
 * - ingress/egress constraints requested
 * - user explicitly invoked builder
 * 
 * This helper MUST be reused everywhere.
 */
export function requiresBeapBuilder(context: BuilderDecisionContext): BuilderRequiredResult {
  const reasons: BuilderRequiredReason[] = []
  
  // Check attachments
  if (context.attachments && context.attachments.length > 0) {
    reasons.push('has_attachments')
  }
  
  // Check sessions
  if (context.selectedSessions && context.selectedSessions.length > 0) {
    reasons.push('has_sessions')
  }
  
  // Check data/automation request
  if (context.dataRequest && context.dataRequest.trim().length > 0) {
    reasons.push('has_data_request')
  }
  
  // Check ingress constraints
  if (context.ingressConstraints && context.ingressConstraints.length > 0) {
    reasons.push('has_ingress_constraints')
  }
  
  // Check egress constraints
  if (context.egressConstraints && context.egressConstraints.length > 0) {
    reasons.push('has_egress_constraints')
  }
  
  // Check user invocation
  if (context.userInvoked) {
    reasons.push('user_invoked')
  }
  
  const required = reasons.length > 0
  
  return {
    required,
    reasons,
    canBeSilent: !required
  }
}

// =============================================================================
// Simplified Check (for common case)
// =============================================================================

/**
 * Quick check: can this message be sent silently?
 * 
 * @param text - Message text
 * @param attachments - Any attachments
 * @param sessions - Any selected sessions
 * @param dataRequest - Any data/automation request
 * @returns true if silent send is allowed
 */
export function canSendSilently(
  text: string,
  attachments: any[] = [],
  sessions: any[] = [],
  dataRequest: string = ''
): boolean {
  // Silent is only allowed for text-only messages
  // with no attachments, sessions, or data requests
  return (
    text.trim().length > 0 &&
    attachments.length === 0 &&
    sessions.length === 0 &&
    dataRequest.trim().length === 0
  )
}

/**
 * Get reasons why builder is required (for display)
 */
export function getBuilderRequiredReasons(context: BuilderDecisionContext): string[] {
  const result = requiresBeapBuilder(context)
  
  const reasonLabels: Record<BuilderRequiredReason, string> = {
    has_attachments: 'Attachments require envelope declaration',
    has_sessions: 'Automation sessions require envelope capability',
    has_data_request: 'Data requests require explicit consent boundary',
    has_ingress_constraints: 'Ingress constraints must be envelope-declared',
    has_egress_constraints: 'Egress constraints must be envelope-declared',
    user_invoked: 'Manually opened BEAP Builder'
  }
  
  return result.reasons.map(r => reasonLabels[r])
}

