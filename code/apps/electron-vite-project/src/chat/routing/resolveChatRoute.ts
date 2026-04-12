/**
 * Chat route resolver — pure decision function (no IPC, no store writes).
 *
 * Priority order (first match wins — mirrors HybridSearch.handleSubmit LLM branch):
 * 1. Non-chat modes: caller must not invoke this for search/actions; if mode !== 'chat', return rag-default.
 * 2. Letter multi-version JSON fill: chat + analysis + letter-composer template port + multi-version intent → chatDirect.
 * 3. Project field drafting: isFieldDrafting → chatDirect.
 * 4. Letter compose (single-field / freeform): chat + letter-composer focus → chatDirect.
 * 5. Default: RAG (handshake / context graph chat).
 */

import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { useDraftRefineStore } from '../../stores/useDraftRefineStore'
import { useLetterComposerStore } from '../../stores/useLetterComposerStore'
import { useProjectSetupChatContextStore } from '../../stores/useProjectSetupChatContextStore'

export type ChatRouteKind =
  | 'letter-multi-version'
  | 'letter-compose'
  | 'project-field-drafting'
  | 'rag-default'

export interface ChatRouteDecision {
  kind: ChatRouteKind
  ipc: 'chatDirect' | 'chatWithContextRag'
}

export function resolveChatRoute(params: {
  mode: string
  activeView: string
  isDraftRefineSession: boolean
  trimmedQuery: string
  wantsLetterTemplateMultiVersion: boolean
  isFieldDrafting: boolean
}): ChatRouteDecision {
  void params.trimmedQuery

  // Store snapshots (same sources as HybridSearch). chat focus drives letter routes; other stores
  // are read so routing stays tied to live UI state alongside caller-supplied flags.
  const { chatFocusMode, focusMeta } = useChatFocusStore.getState()
  const _draftSnapshot = useDraftRefineStore.getState()
  const _projectSnapshot = useProjectSetupChatContextStore.getState()
  const _letterSnapshot = useLetterComposerStore.getState()
  // Reference snapshots so store reads are not tree-shaken; mirrors HybridSearch store usage.
  void _draftSnapshot
  void _projectSnapshot
  void _letterSnapshot

  if (params.mode !== 'chat') {
    return { kind: 'rag-default', ipc: 'chatWithContextRag' }
  }

  if (
    !params.isDraftRefineSession &&
    params.wantsLetterTemplateMultiVersion &&
    params.activeView === 'analysis' &&
    chatFocusMode.mode === 'letter-composer' &&
    focusMeta?.letterComposerPort === 'template'
  ) {
    return { kind: 'letter-multi-version', ipc: 'chatDirect' }
  }

  if (params.isFieldDrafting) {
    return { kind: 'project-field-drafting', ipc: 'chatDirect' }
  }

  // Letter top chat: incidental draft-refine connection (per-field buttons) must not block this route.
  if (chatFocusMode.mode === 'letter-composer') {
    return { kind: 'letter-compose', ipc: 'chatDirect' }
  }

  return { kind: 'rag-default', ipc: 'chatWithContextRag' }
}
