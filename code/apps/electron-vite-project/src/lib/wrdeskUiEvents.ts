/** Cross-surface UI events (avoid importing dashboard CSS into header components). */

import type { AgentRunResult } from '../types/optimizationTypes'

export const WRDESK_FOCUS_AI_CHAT_EVENT = 'wrdesk:focus-ai-chat'

/** Auto-optimization: open WR Chat and activate each orchestrator session. */
export const WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS = 'wrdesk:auto-optimization-activate-sessions'

/** Detail for {@link WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS}. */
export type WrdeskAutoOptimActivateDetail = { sessionIds: string[]; runId: string }

/** Toast for optimization guard failures (App.tsx listens). */
export const WRDESK_OPTIMIZATION_GUARD_TOAST = 'wrdesk:optimization-guard-toast'

/** Optimization run completed — WR Chat renders results (PopupChatView listens). */
export const WRDESK_OPTIMIZATION_RUN_RESULTS = 'wrdesk:optimization-run-results'

export type WrdeskOptimizationRunResultsDetail = {
  runId: string
  projectId: string
  projectTitle: string
  completedAt: string
  results: AgentRunResult[]
}
