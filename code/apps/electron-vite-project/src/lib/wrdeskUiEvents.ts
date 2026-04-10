/**
 * Cross-surface UI events (avoid importing dashboard CSS into header components).
 *
 * **Stable contracts:** Event *string values* are part of the public integration surface.
 * Renaming a constant value without updating every listener will break behavior silently.
 */

import type { AgentRunResult } from '../types/optimizationTypes'

/**
 * Dispatched when the Analysis dashboard wants the header AI chat (HybridSearch) focused —
 * e.g. after the user selects a project field for AI-assisted editing.
 *
 * **Listeners:** `HybridSearch` (adds/removes `window` listener). **Emitters:** e.g.
 * `ProjectOptimizationPanel` via `focusHeaderAiChat()`.
 * **Do not rename** the string value (`wrdesk:focus-ai-chat`) without updating all listeners.
 */
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
