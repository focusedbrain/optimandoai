import { create } from 'zustand'
import type { ChatFocusMode } from '../types/triggerTypes'

/** Display / LLM strings for optimizer mode (titles are not on ChatFocusMode alone). */
export type ChatFocusMeta = {
  projectTitle?: string
  activeMilestoneTitle?: string
  projectIcon?: string
}

export const WRCHAT_APPEND_ASSISTANT_EVENT = 'wrchat-append-assistant'

type ChatFocusState = {
  chatFocusMode: ChatFocusMode
  focusMeta: ChatFocusMeta | null
  setChatFocusMode: (mode: ChatFocusMode, meta?: ChatFocusMeta | null) => void
  setChatFocusWithIntro: (mode: ChatFocusMode, meta: ChatFocusMeta | null, introText: string) => void
  clearChatFocusMode: () => void
}

export const useChatFocusStore = create<ChatFocusState>((set) => ({
  chatFocusMode: { mode: 'default' },
  focusMeta: null,
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
  clearChatFocusMode: () => set({ chatFocusMode: { mode: 'default' }, focusMeta: null }),
}))
