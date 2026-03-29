import { create } from 'zustand'

/**
 * Text snippets uploaded for Prompt 5 / chat RAG context only.
 * Not sent as BEAP package or email attachments — see composers for send pipelines.
 */
export type AiDraftContextDoc = {
  id: string
  name: string
  text: string
}

type State = {
  documents: AiDraftContextDoc[]
}

type Actions = {
  /** Append documents (generates stable `id` when omitted). */
  addDocuments: (docs: Array<{ name: string; text: string; id?: string }>) => void
  removeDocument: (id: string) => void
  clear: () => void
}

function newId(): string {
  return crypto.randomUUID()
}

export const useAiDraftContextStore = create<State & Actions>((set) => ({
  documents: [],
  addDocuments: (docs) =>
    set((s) => ({
      documents: [
        ...s.documents,
        ...docs.map((d) => ({
          id: d.id ?? newId(),
          name: d.name,
          text: d.text,
        })),
      ],
    })),
  removeDocument: (id) => set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),
  clear: () => set({ documents: [] }),
}))
