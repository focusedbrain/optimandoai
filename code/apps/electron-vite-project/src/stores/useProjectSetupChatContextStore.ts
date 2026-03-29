import { create } from 'zustand'

/**
 * Renderer-only drafts bridged into the header AI (HybridSearch) on the Analysis view.
 * Not project persistence — no IPC, no automatic write-back.
 */

export type ProjectSetupChatSnippet = {
  id: string
  label: string
  text: string
}

export type ProjectSetupChatContextState = {
  /** When true and fields have content, HybridSearch prepends structured setup context (Analysis + non–draft-refine only). */
  includeInChat: boolean
  projectNameDraft: string
  goalsDraft: string
  milestonesDraft: string
  /** Freeform setup / constraints / context the user wants the model to see */
  setupTextDraft: string
  snippets: ProjectSetupChatSnippet[]
}

type Actions = {
  setIncludeInChat: (v: boolean) => void
  setProjectNameDraft: (v: string) => void
  setGoalsDraft: (v: string) => void
  setMilestonesDraft: (v: string) => void
  setSetupTextDraft: (v: string) => void
  addSnippet: (s: { label: string; text: string }) => void
  removeSnippet: (id: string) => void
  updateSnippet: (id: string, patch: Partial<Pick<ProjectSetupChatSnippet, 'label' | 'text'>>) => void
  clearSnippets: () => void
}

function newId(): string {
  return crypto.randomUUID()
}

const initial: ProjectSetupChatContextState = {
  includeInChat: false,
  projectNameDraft: '',
  goalsDraft: '',
  milestonesDraft: '',
  setupTextDraft: '',
  snippets: [],
}

export const useProjectSetupChatContextStore = create<ProjectSetupChatContextState & Actions>((set) => ({
  ...initial,
  setIncludeInChat: (includeInChat) => set({ includeInChat }),
  setProjectNameDraft: (projectNameDraft) => set({ projectNameDraft }),
  setGoalsDraft: (goalsDraft) => set({ goalsDraft }),
  setMilestonesDraft: (milestonesDraft) => set({ milestonesDraft }),
  setSetupTextDraft: (setupTextDraft) => set({ setupTextDraft }),
  addSnippet: (s) =>
    set((state) => ({
      snippets: [...state.snippets, { id: newId(), label: s.label.trim(), text: s.text }],
    })),
  removeSnippet: (id) => set((s) => ({ snippets: s.snippets.filter((x) => x.id !== id) })),
  updateSnippet: (id, patch) =>
    set((s) => ({
      snippets: s.snippets.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  clearSnippets: () => set({ snippets: [] }),
}))

/** True if any draft or snippet has non-whitespace content */
export function projectSetupChatHasBridgeableContent(s: ProjectSetupChatContextState): boolean {
  if (s.projectNameDraft.trim()) return true
  if (s.goalsDraft.trim()) return true
  if (s.milestonesDraft.trim()) return true
  if (s.setupTextDraft.trim()) return true
  return s.snippets.some((x) => x.label.trim() || x.text.trim())
}
