/**
 * BEAP Autoresponder Evaluator
 *
 * Evaluates incoming native BEAP messages to determine if automated
 * session import + response is authorized.
 *
 * Decision chain:
 * 1. Message has session attachment? → No: skip
 * 2. Handshake has automation policy? → No: manual consent required
 * 3. Policy allows auto-import for this session type? → No: manual consent
 * 4. Processing events authorize actuating? → No: deny automation
 * 5. All checks pass → auto-import + (future) auto-reply
 *
 * Every decision is logged to the autoresponder audit trail.
 */

export type AutoresponderDecision =
  | 'no-session' // Message has no session attachment
  | 'manual-consent' // Policy requires manual consent
  | 'policy-consent' // Policy allows auto-import
  | 'denied' // Policy denies automation
  | 'error' // Evaluation failed

export interface AutoresponderEvaluation {
  messageId: string
  handshakeId: string | null
  decision: AutoresponderDecision
  reason: string
  sessionRefs: any[]
  timestamp: number
  // Future: executionResult, replyMessageId
}

export function evaluateAutoresponder(params: {
  messageId: string
  handshakeId: string | null
  depackagedJson: string | null
  // Future: handshake policy, processing events
}): AutoresponderEvaluation {
  const { messageId, handshakeId, depackagedJson } = params
  const timestamp = Date.now()

  // Step 1: Check for session attachments
  let sessionRefs: any[] = []
  if (depackagedJson) {
    try {
      const parsed = JSON.parse(depackagedJson)
      sessionRefs = parsed.sessionRefs || []
    } catch {
      // Invalid JSON — no sessions
    }
  }

  if (sessionRefs.length === 0) {
    return {
      messageId,
      handshakeId,
      decision: 'no-session',
      reason: 'Message contains no session attachments',
      sessionRefs: [],
      timestamp,
    }
  }

  if (!handshakeId) {
    return {
      messageId,
      handshakeId,
      decision: 'denied',
      reason: 'Session import requires an established handshake',
      sessionRefs,
      timestamp,
    }
  }

  // Step 2–4: Policy evaluation
  // PLACEHOLDER: When policy engine is wired, evaluate here
  // For now: always require manual consent
  return {
    messageId,
    handshakeId,
    decision: 'manual-consent',
    reason: 'Default: manual consent required (policy evaluation not yet wired)',
    sessionRefs,
    timestamp,
  }
}
