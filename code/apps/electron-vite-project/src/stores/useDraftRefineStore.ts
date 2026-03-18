/**
 * useDraftRefineStore — Connects the draft textarea to the top chat bar.
 * When user clicks the draft textarea, the chat bar enters "draft refine" mode:
 * user instructions refine the draft, and the LLM response replaces the textarea.
 */

import { create } from 'zustand'

interface DraftRefineState {
  connected: boolean
  messageId: string | null
  draftText: string
  onResponse: ((text: string) => void) | null
  connect: (messageId: string, draftText: string, onResponse: (text: string) => void) => void
  updateDraftText: (draftText: string) => void
  disconnect: () => void
  /** Called by HybridSearch when response arrives in draft-refine mode */
  deliverResponse: (text: string) => void
}

export const useDraftRefineStore = create<DraftRefineState>((set, get) => ({
  connected: false,
  messageId: null,
  draftText: '',
  onResponse: null,
  connect: (messageId, draftText, onResponse) => {
    set({
      connected: true,
      messageId,
      draftText,
      onResponse,
    })
  },
  updateDraftText: (draftText: string) => {
    set({ draftText })
  },
  disconnect: () => {
    set({
      connected: false,
      messageId: null,
      draftText: '',
      onResponse: null,
    })
  },
  deliverResponse: (text) => {
    const { onResponse } = get()
    if (onResponse) {
      onResponse(text)
    }
  },
}))
