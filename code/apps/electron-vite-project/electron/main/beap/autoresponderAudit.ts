/**
 * Autoresponder Audit Logger
 *
 * Persists autoresponder decisions for the full chain:
 * Message → Evaluation → Decision → (Import → Execution → Reply)
 */

import type { AutoresponderEvaluation } from './autoresponderEvaluator'

// In-memory for now; migrate to SQLite table in production
const auditLog: AutoresponderEvaluation[] = []

export function logAutoresponderDecision(evaluation: AutoresponderEvaluation) {
  auditLog.push(evaluation)
  console.log(
    `[Autoresponder] ${evaluation.decision}: ${evaluation.reason}`,
    `(message: ${evaluation.messageId}, sessions: ${evaluation.sessionRefs.length})`,
  )
}

export function getAutoresponderAuditLog(): AutoresponderEvaluation[] {
  return [...auditLog]
}

export function getAuditForMessage(messageId: string): AutoresponderEvaluation | undefined {
  return auditLog.find((e) => e.messageId === messageId)
}
