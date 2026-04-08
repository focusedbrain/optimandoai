import { create } from 'zustand'
import type { ChatFocusMode } from '../types/triggerTypes'

/** Display / LLM strings for optimizer mode (titles are not on ChatFocusMode alone). */
export type ChatFocusMeta = {
  projectTitle?: string
  activeMilestoneTitle?: string
  projectIcon?: string
  /** Snapshot for LLM prefix when project store is unavailable */
  projectDescription?: string
  projectGoals?: string
}

export type EnterOptimizationFocusMeta = {
  projectId: string
  projectTitle: string
  projectIcon?: string
  milestoneTitle?: string
  runId?: string
  projectDescription?: string
  projectGoals?: string
}

export const WRCHAT_APPEND_ASSISTANT_EVENT = 'wrchat-append-assistant'

type ChatFocusState = {
  chatFocusMode: ChatFocusMode
  focusMeta: ChatFocusMeta | null
  /** Shown on OptimizationInfobox line 3 after a run completes. */
  optimizationLastRunAt: string | null
  optimizationSuggestionCount: number | null
  setChatFocusMode: (mode: ChatFocusMode, meta?: ChatFocusMeta | null) => void
  setChatFocusWithIntro: (mode: ChatFocusMode, meta: ChatFocusMeta | null, introText: string) => void
  clearChatFocusMode: () => void
  enterOptimizationFocus: (meta: EnterOptimizationFocusMeta) => void
  exitOptimizationFocus: () => void
  updateOptimizationRunId: (runId: string) => void
  updateLastRunInfo: (info: { completedAt: string; suggestionCount: number }) => void
}

export const useChatFocusStore = create<ChatFocusState>((set) => ({
  chatFocusMode: { mode: 'default' },
  focusMeta: null,
  optimizationLastRunAt: null,
  optimizationSuggestionCount: null,
  /** When `meta` is omitted, keeps existing focusMeta unless switching to default (clears meta). */
  setChatFocusMode: (mode, meta) =>
    set((s) => ({
      chatFocusMode: mode,
      focusMeta: meta !== undefined ? meta : mode.mode === 'default' ? null : s.focusMeta,
    })),
  setChatFocusWithIntro: (mode, meta, introText) => {
    set({ chatFocusMode: mode, focusMeta: meta })
    try {
      window.dispatchEvent(
        new CustomEvent(WRCHAT_APPEND_ASSISTANT_EVENT, { detail: { text: introText } }),
      )
    } catch {
      /* noop */
    }
  },
  clearChatFocusMode: () =>
    set({
      chatFocusMode: { mode: 'default' },
      focusMeta: null,
      optimizationLastRunAt: null,
      optimizationSuggestionCount: null,
    }),
  enterOptimizationFocus: (meta) =>
    set((s) => {
      const startedAt = new Date().toISOString()
      const mode: ChatFocusMode = {
        mode: 'auto-optimizer',
        projectId: meta.projectId,
        projectTitle: meta.projectTitle,
        startedAt,
        projectIcon: meta.projectIcon,
        milestoneTitle: meta.milestoneTitle,
        runId: meta.runId,
      }
      const focusMeta: ChatFocusMeta = {
        projectTitle: meta.projectTitle,
        activeMilestoneTitle: meta.milestoneTitle,
        projectIcon: meta.projectIcon,
        projectDescription: meta.projectDescription,
        projectGoals: meta.projectGoals,
      }
      return {
        ...s,
        chatFocusMode: mode,
        focusMeta,
        optimizationLastRunAt: null,
        optimizationSuggestionCount: null,
      }
    }),
  exitOptimizationFocus: () =>
    set((s) => {
      if (s.chatFocusMode.mode !== 'auto-optimizer') return s
      return {
        ...s,
        chatFocusMode: { mode: 'default' },
        focusMeta: null,
        optimizationLastRunAt: null,
        optimizationSuggestionCount: null,
      }
    }),
  updateOptimizationRunId: (runId) =>
    set((s) => {
      if (s.chatFocusMode.mode !== 'auto-optimizer') return s
      return { ...s, chatFocusMode: { ...s.chatFocusMode, runId } }
    }),
  updateLastRunInfo: (info) =>
    set((s) => ({
      ...s,
      optimizationLastRunAt: info.completedAt,
      optimizationSuggestionCount: info.suggestionCount,
    })),
}))
