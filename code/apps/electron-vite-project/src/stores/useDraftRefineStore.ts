/**
 * useDraftRefineStore — Connects the draft textarea to the top chat bar.
 * When user clicks the draft textarea, the chat bar enters "draft refine" mode:
 * user instructions refine the draft, and the LLM response replaces the textarea.
 */

import { create } from 'zustand'

export type DraftRefineTarget = 'email' | 'capsule-public' | 'capsule-encrypted'

interface DraftRefineState {
  connected: boolean
  messageId: string | null
  messageSubject: string | null
  draftText: string
  /** Which textarea is wired to chat refinement (native BEAP has two capsule fields). */
  refineTarget: DraftRefineTarget
  /** AI refinement result — shown in preview; user clicks accept to apply */
  refinedDraftText: string | null
  onResponse: ((text: string) => void) | null
  connect: (
    messageId: string | null,
    messageSubject: string | null,
    draftText: string,
    onResponse: (text: string) => void,
    refineTarget?: DraftRefineTarget,
  ) => void
  updateDraftText: (draftText: string) => void
  disconnect: () => void
  /** Called by HybridSearch when AI response arrives — stores as refinedDraftText, NOT auto-applied */
  deliverResponse: (text: string) => void
  /** Called when user clicks accept icon — applies refinedDraftText and clears it */
  acceptRefinement: () => void
}

export const useDraftRefineStore = create<DraftRefineState>((set, get) => ({
  connected: false,
  messageId: null,
  messageSubject: null,
  draftText: '',
  refineTarget: 'email',
  refinedDraftText: null,
  onResponse: null,
  connect: (messageId, messageSubject, draftText, onResponse, refineTarget = 'email') => {
    set({
      connected: true,
      messageId,
      messageSubject,
      draftText,
      refineTarget,
      onResponse,
      refinedDraftText: null,
    })
  },
  updateDraftText: (draftText: string) => {
    set({ draftText })
  },
  disconnect: () => {
    set({
      connected: false,
      messageId: null,
      messageSubject: null,
      draftText: '',
      refineTarget: 'email',
      refinedDraftText: null,
      onResponse: null,
    })
  },
  deliverResponse: (text) => {
    set({ refinedDraftText: text })
  },
  acceptRefinement: () => {
    const { refinedDraftText, onResponse } = get()
    if (refinedDraftText && onResponse) {
      onResponse(refinedDraftText)
      set({ refinedDraftText: null })
    }
  },
}))
