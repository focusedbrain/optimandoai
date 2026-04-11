/**
 * Letter Composer — templates + scanned letters (metadata persisted; large blobs rehydrated later).
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// --- Template types ---

export interface TemplateField {
  id: string
  name: string // e.g. "Recipient Name", "Date", "Subject Line", "Body"
  placeholder: string // marker in the template, e.g. "{{recipient_name}}"
  type: 'text' | 'date' | 'multiline' | 'address'
  value: string // current fill value
  aiGenerated: boolean
}

export interface LetterTemplate {
  id: string
  name: string
  sourceFileName: string // original uploaded filename
  sourceFilePath: string // path on disk (Electron userData)
  renderedHtml: string // mammoth-converted HTML for display
  fields: TemplateField[]
  versions: Array<Record<string, string>> // version snapshots: fieldId → value
  activeVersionIndex: number
  createdAt: string
  updatedAt: string
}

// --- Letter (scanned incoming) types ---

export interface LetterPage {
  pageNumber: number
  imageDataUrl?: string // rasterized page as data URL (for display)
  text: string // extracted text (OCR or pdfjs)
}

export interface ScannedLetter {
  id: string
  name: string
  sourceFileName: string
  sourceFilePath: string
  pages: LetterPage[]
  fullText: string // concatenated page texts for AI context
  createdAt: string
}

// --- Store ---

interface LetterComposerState {
  // Templates
  templates: LetterTemplate[]
  activeTemplateId: string | null
  addTemplate: (template: LetterTemplate) => void
  updateTemplate: (id: string, patch: Partial<LetterTemplate>) => void
  removeTemplate: (id: string) => void
  setActiveTemplate: (id: string | null) => void
  updateTemplateField: (templateId: string, fieldId: string, value: string) => void
  /** Replace AI-generated version snapshots (e.g. 3 variants) and show `activeIndex`. */
  setTemplateVersions: (templateId: string, versions: Array<Record<string, string>>, activeIndex?: number) => void
  setActiveTemplateVersionIndex: (templateId: string, index: number) => void

  // Scanned letters
  letters: ScannedLetter[]
  activeLetterId: string | null
  activeLetterPage: number // currently viewed page index
  addLetter: (letter: ScannedLetter) => void
  removeLetter: (id: string) => void
  setActiveLetter: (id: string | null) => void
  setActiveLetterPage: (page: number) => void

  // Active port selection for WR Chat focus
  focusedPort: 'template' | 'letter' | null
  setFocusedPort: (port: 'template' | 'letter' | null) => void
  /** Template field last focused in the form — guides AI “Use” write-back. */
  focusedTemplateFieldId: string | null
  setFocusedTemplateField: (fieldId: string | null) => void
}

export const useLetterComposerStore = create<LetterComposerState>()(
  persist(
    (set) => ({
      templates: [],
      activeTemplateId: null,
      addTemplate: (template) => set((s) => ({ templates: [...s.templates, template] })),
      updateTemplate: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t,
          ),
        })),
      removeTemplate: (id) =>
        set((s) => ({
          templates: s.templates.filter((t) => t.id !== id),
          activeTemplateId: s.activeTemplateId === id ? null : s.activeTemplateId,
        })),
      setActiveTemplate: (id) => set({ activeTemplateId: id }),

      updateTemplateField: (templateId, fieldId, value) =>
        set((s) => ({
          templates: s.templates.map((t) => {
            if (t.id !== templateId) return t
            const fields = t.fields.map((f) => (f.id === fieldId ? { ...f, value } : f))
            const vix = t.activeVersionIndex
            let versions = t.versions
            if (vix >= 0 && vix < t.versions.length) {
              versions = [...t.versions]
              versions[vix] = { ...versions[vix], [fieldId]: value }
            }
            return {
              ...t,
              updatedAt: new Date().toISOString(),
              fields,
              versions,
            }
          }),
        })),

      setTemplateVersions: (templateId, versions, activeIndex = 0) =>
        set((s) => ({
          templates: s.templates.map((t) => {
            if (t.id !== templateId) return t
            const v = versions.slice(0, 8)
            if (v.length === 0) {
              return {
                ...t,
                versions: [],
                activeVersionIndex: -1,
                updatedAt: new Date().toISOString(),
              }
            }
            const idx = Math.min(Math.max(0, activeIndex), v.length - 1)
            const snap = v[idx]
            const fields = t.fields.map((f) => ({
              ...f,
              value: snap[f.id] ?? '',
              aiGenerated: true,
            }))
            return {
              ...t,
              versions: v,
              activeVersionIndex: idx,
              fields,
              updatedAt: new Date().toISOString(),
            }
          }),
        })),

      setActiveTemplateVersionIndex: (templateId, index) =>
        set((s) => ({
          templates: s.templates.map((t) => {
            if (t.id !== templateId) return t
            if (index < 0 || index >= t.versions.length) {
              return { ...t, activeVersionIndex: -1, updatedAt: new Date().toISOString() }
            }
            const snap = t.versions[index]
            const fields = t.fields.map((f) => ({
              ...f,
              value: snap[f.id] ?? '',
            }))
            return {
              ...t,
              activeVersionIndex: index,
              fields,
              updatedAt: new Date().toISOString(),
            }
          }),
        })),

      letters: [],
      activeLetterId: null,
      activeLetterPage: 0,
      addLetter: (letter) =>
        set((s) => ({
          letters: [...s.letters, letter],
          activeLetterId: letter.id,
          activeLetterPage: 0,
        })),
      removeLetter: (id) =>
        set((s) => ({
          letters: s.letters.filter((l) => l.id !== id),
          activeLetterId: s.activeLetterId === id ? null : s.activeLetterId,
        })),
      setActiveLetter: (id) => set({ activeLetterId: id, activeLetterPage: 0 }),
      setActiveLetterPage: (page) => set({ activeLetterPage: page }),

      focusedPort: null,
      setFocusedPort: (port) => set({ focusedPort: port }),
      focusedTemplateFieldId: null,
      setFocusedTemplateField: (fieldId) => set({ focusedTemplateFieldId: fieldId }),
    }),
    {
      name: 'wr-desk-letter-composer',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        templates: s.templates.map((t) => ({
          ...t,
          // Don't persist large rendered HTML or page images in localStorage
          // They'll be regenerated from source files on load
          renderedHtml: '',
        })),
        activeTemplateId: s.activeTemplateId,
        // Don't persist scanned letters in localStorage (too large)
        // They'll be re-processed from source files
      }),
    },
  ),
)
