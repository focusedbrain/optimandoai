/**
 * Letter Composer — templates (PDF mapping schema) + scanned letters + compose sessions.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// --- Field types ---

export type FieldMode = 'fixed' | 'flow'
export type FieldType = 'text' | 'date' | 'multiline' | 'address' | 'richtext'

export interface TemplateField {
  id: string
  name: string // semantic name: "sender_address", "recipient_address", "body"
  label: string // display label: "Sender Address", "Recipient Address", "Body"
  type: FieldType
  mode: FieldMode // 'fixed' = positioned zone, 'flow' = variable-length region
  // Position on the PDF preview (relative to page, 0-1 normalized coordinates)
  page: number // which page (0-indexed)
  x: number // left edge (0-1)
  y: number // top edge (0-1)
  w: number // width (0-1)
  h: number // height (0-1)
  // Content
  value: string // current fill value
  defaultValue: string // placeholder or default text from original document
  anchorText: string // text from the original document at this position (for DOCX injection)
  /** Exact `{{name}}` token when using placeholder-based templates (optional duplicate of anchorText). */
  placeholder?: string
}

export interface LetterTemplate {
  id: string
  name: string
  sourceFileName: string // original uploaded filename
  sourceFilePath: string // path on disk
  pdfPreviewPath: string // path to the generated PDF
  pdfPageImages: string[] // data URLs of rendered PDF pages (for the mapping UI)
  pageCount: number
  fields: TemplateField[]
  mappingComplete: boolean // user has finished mapping fields
  createdAt: string
  updatedAt: string
  /** Path A — layout key for generated letterhead (Prompt 3): din5008a, classic, … */
  builtinLayout?: string | null
  /** Optional logo file path or embedded data URL (built-in / profile). */
  logoPath?: string | null
}

/** Saved sender profile for Quick Start wizard pre-fill (persisted). */
export interface CompanyProfile {
  sender_name: string
  sender_address: string
  sender_phone: string
  sender_email: string
  signer_name: string
  /** Data URL or future filesystem path from main process. */
  logoPath: string | null
}

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  sender_name: '',
  sender_address: '',
  sender_phone: '',
  sender_email: '',
  signer_name: '',
  logoPath: null,
}

// --- Built-in library (Path A — Quick Start) ---

export type BuiltinLayout = 'din5008a' | 'din5008b' | 'classic' | 'modern' | 'minimal'

export interface BuiltinTemplateField {
  name: string
  label: string
  type: FieldType
  mode: FieldMode
  /** When true, filled once in setup and reused for every letter. */
  staticField: boolean
  defaultValue?: string
}

export interface BuiltinTemplate {
  id: string
  name: string
  description: string
  layout: BuiltinLayout
  fields: BuiltinTemplateField[]
}

/** Shared field set for all built-in layouts (layout differs only in preview / future DOCX). */
function builtinLetterFields(): BuiltinTemplateField[] {
  return [
    { name: 'company_logo', label: 'Company Logo', type: 'text', mode: 'fixed', staticField: true },
    { name: 'sender_name', label: 'Sender Name', type: 'text', mode: 'fixed', staticField: true },
    { name: 'sender_address', label: 'Sender Address', type: 'address', mode: 'fixed', staticField: true },
    { name: 'sender_phone', label: 'Phone', type: 'text', mode: 'fixed', staticField: true },
    { name: 'sender_email', label: 'Email', type: 'text', mode: 'fixed', staticField: true },
    { name: 'recipient_name', label: 'Recipient Name', type: 'text', mode: 'fixed', staticField: false },
    { name: 'recipient_address', label: 'Recipient Address', type: 'address', mode: 'fixed', staticField: false },
    { name: 'date', label: 'Date', type: 'date', mode: 'fixed', staticField: false },
    { name: 'subject', label: 'Subject', type: 'text', mode: 'flow', staticField: false },
    {
      name: 'salutation',
      label: 'Salutation',
      type: 'text',
      mode: 'flow',
      staticField: false,
      defaultValue: 'Sehr geehrte Damen und Herren,',
    },
    { name: 'body', label: 'Body', type: 'richtext', mode: 'flow', staticField: false },
    {
      name: 'closing',
      label: 'Closing',
      type: 'text',
      mode: 'flow',
      staticField: false,
      defaultValue: 'Mit freundlichen Grüßen',
    },
    { name: 'signer_name', label: 'Signer', type: 'text', mode: 'fixed', staticField: true },
  ]
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'din5008a',
    name: 'DIN 5008 Form A',
    description: 'German business standard — high address window',
    layout: 'din5008a',
    fields: builtinLetterFields(),
  },
  {
    id: 'din5008b',
    name: 'DIN 5008 Form B',
    description: 'German business standard — low address window',
    layout: 'din5008b',
    fields: builtinLetterFields(),
  },
  {
    id: 'classic',
    name: 'Classic Business',
    description: 'Traditional layout — centered header, formal style',
    layout: 'classic',
    fields: builtinLetterFields(),
  },
  {
    id: 'modern',
    name: 'Modern Clean',
    description: 'Minimalist layout — sidebar contact info',
    layout: 'modern',
    fields: builtinLetterFields(),
  },
]

export type TemplateSetupStep = 'chooser' | 'company-details'

// --- Scanned letter types ---

export interface LetterPage {
  pageNumber: number
  imageDataUrl?: string
  text: string
}

export interface ScannedLetter {
  id: string
  name: string
  sourceFileName: string
  sourceFilePath: string
  pages: LetterPage[]
  fullText: string
  /** AI-extracted key/value (empty until extraction runs). */
  extractedFields: Record<string, string>
  /** Per-field confidence 0–1 (empty until extraction runs). */
  confidence: Record<string, number>
  createdAt: string
}

/** Scan-only letters may omit AI fields; they default to empty objects. */
export type ScannedLetterInput = Omit<ScannedLetter, 'extractedFields' | 'confidence'> &
  Partial<Pick<ScannedLetter, 'extractedFields' | 'confidence'>>

// --- Compose session (for active letter being written) ---

export interface ComposeSession {
  id: string
  templateId: string
  fieldValues: Record<string, string> // fieldId → current value
  replyToLetterId: string | null // if responding to a scanned letter
  versions: Array<Record<string, string>> // AI-generated version snapshots
  activeVersionIndex: number
  createdAt: string
}

const PERSIST_VERSION = 3

/** Public helper for mapping UI — derive semantic `name` from a display label. */
export function slugifyTemplateFieldName(label: string): string {
  const t = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  return t || 'field'
}

function slugifySemanticName(label: string): string {
  return slugifyTemplateFieldName(label)
}

function migrateTemplateFieldV1(f: Record<string, unknown>): TemplateField {
  const id = typeof f.id === 'string' ? f.id : String(f.id ?? crypto.randomUUID())
  const nameRaw = typeof f.name === 'string' ? f.name : 'Field'
  const typeRaw = f.type
  const type: FieldType =
    typeRaw === 'date' || typeRaw === 'multiline' || typeRaw === 'address' || typeRaw === 'richtext'
      ? typeRaw
      : 'text'
  const legacyPlaceholderKey = typeof f.placeholder === 'string' ? f.placeholder : ''
  const isToken = legacyPlaceholderKey.startsWith('{{')
  return {
    id,
    name: slugifySemanticName(nameRaw),
    label: nameRaw,
    type,
    mode: 'fixed',
    page: 0,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    value: typeof f.value === 'string' ? f.value : String(f.value ?? ''),
    defaultValue:
      typeof f.defaultValue === 'string'
        ? f.defaultValue
        : isToken
          ? ''
          : legacyPlaceholderKey,
    anchorText: typeof f.anchorText === 'string' ? f.anchorText : '',
    placeholder: isToken ? legacyPlaceholderKey : undefined,
  }
}

function migrateLetterTemplateV1(t: Record<string, unknown>): LetterTemplate {
  if (typeof t.pdfPreviewPath === 'string' && 'mappingComplete' in t) {
    return t as unknown as LetterTemplate
  }
  const fieldsRaw = Array.isArray(t.fields) ? t.fields : []
  const fields = fieldsRaw.map((f) => migrateTemplateFieldV1(f as Record<string, unknown>))
  return {
    id: String(t.id ?? crypto.randomUUID()),
    name: String(t.name ?? 'Template'),
    sourceFileName: String(t.sourceFileName ?? ''),
    sourceFilePath: String(t.sourceFilePath ?? ''),
    pdfPreviewPath: '',
    pdfPageImages: [],
    pageCount: typeof t.pageCount === 'number' && t.pageCount > 0 ? t.pageCount : 1,
    fields,
    mappingComplete: false,
    createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
    updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString(),
  }
}

function resolveComposeSessionIdForTemplate(
  sessions: ComposeSession[],
  activeComposeSessionId: string | null,
  templateId: string,
): string | null {
  if (activeComposeSessionId) {
    const byActive = sessions.find((c) => c.id === activeComposeSessionId && c.templateId === templateId)
    if (byActive) return byActive.id
  }
  return sessions.find((c) => c.templateId === templateId)?.id ?? null
}

export function createLetterComposeSession(templateId: string): ComposeSession {
  return {
    id: crypto.randomUUID(),
    templateId,
    fieldValues: {},
    replyToLetterId: null,
    versions: [],
    activeVersionIndex: -1,
    createdAt: new Date().toISOString(),
  }
}

// --- Store ---

interface LetterComposerState {
  templates: LetterTemplate[]
  activeTemplateId: string | null
  addTemplate: (template: LetterTemplate) => void
  updateTemplate: (id: string, patch: Partial<LetterTemplate>) => void
  removeTemplate: (id: string) => void
  setActiveTemplate: (id: string | null) => void
  updateTemplateField: (templateId: string, fieldId: string, value: string) => void
  addTemplateField: (templateId: string, field: TemplateField) => void
  removeTemplateField: (templateId: string, fieldId: string) => void
  patchTemplateField: (templateId: string, fieldId: string, patch: Partial<TemplateField>) => void
  setTemplateMappingComplete: (templateId: string, complete: boolean) => void
  /** @deprecated Prefer setComposeSessionVersions — applies AI snapshots to the compose session for this template (and syncs template field values). */
  setTemplateVersions: (
    templateId: string,
    versions: Array<Record<string, string>>,
    activeIndex?: number,
  ) => void
  /** @deprecated Prefer setActiveComposeVersionIndex */
  setActiveTemplateVersionIndex: (templateId: string, index: number) => void

  composeSessions: ComposeSession[]
  activeComposeSessionId: string | null
  addComposeSession: (session: ComposeSession) => void
  updateComposeSession: (id: string, patch: Partial<ComposeSession>) => void
  removeComposeSession: (id: string) => void
  setActiveComposeSession: (id: string | null) => void
  updateComposeSessionField: (sessionId: string, fieldId: string, value: string) => void
  setComposeSessionVersions: (
    sessionId: string,
    versions: Array<Record<string, string>>,
    activeIndex?: number,
  ) => void
  setActiveComposeVersionIndex: (sessionId: string, index: number) => void

  letters: ScannedLetter[]
  activeLetterId: string | null
  activeLetterPage: number
  addLetter: (letter: ScannedLetterInput) => void
  updateLetter: (
    id: string,
    patch: Partial<Pick<ScannedLetter, 'extractedFields' | 'confidence'>>,
  ) => void
  removeLetter: (id: string) => void
  setActiveLetter: (id: string | null) => void
  setActiveLetterPage: (page: number) => void

  focusedPort: 'template' | 'letter' | null
  setFocusedPort: (port: 'template' | 'letter' | null) => void
  focusedTemplateFieldId: string | null
  setFocusedTemplateField: (fieldId: string | null) => void

  /** Path A — built-in template picked from library (not persisted). */
  selectedBuiltinTemplate: BuiltinTemplate | null
  setSelectedBuiltinTemplate: (tmpl: BuiltinTemplate | null) => void
  templateSetupStep: TemplateSetupStep
  setTemplateSetupStep: (step: TemplateSetupStep) => void

  companyProfile: CompanyProfile
  setCompanyProfile: (profile: Partial<CompanyProfile>) => void
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
        set((s) => {
          const removedSessionIds = new Set(
            s.composeSessions.filter((c) => c.templateId === id).map((c) => c.id),
          )
          const clearedActive = s.activeTemplateId === id
          return {
            templates: s.templates.filter((t) => t.id !== id),
            activeTemplateId: clearedActive ? null : s.activeTemplateId,
            composeSessions: s.composeSessions.filter((c) => c.templateId !== id),
            activeComposeSessionId:
              s.activeComposeSessionId && removedSessionIds.has(s.activeComposeSessionId)
                ? null
                : s.activeComposeSessionId,
            ...(clearedActive
              ? { selectedBuiltinTemplate: null, templateSetupStep: 'chooser' as TemplateSetupStep }
              : {}),
          }
        }),
      setActiveTemplate: (id) =>
        set({
          activeTemplateId: id,
          selectedBuiltinTemplate: null,
          templateSetupStep: 'chooser',
        }),

      updateTemplateField: (templateId, fieldId, value) =>
        set((s) => {
          const sessionId = resolveComposeSessionIdForTemplate(
            s.composeSessions,
            s.activeComposeSessionId,
            templateId,
          )
          return {
            templates: s.templates.map((t) => {
              if (t.id !== templateId) return t
              const fields = t.fields.map((f) => (f.id === fieldId ? { ...f, value } : f))
              return {
                ...t,
                updatedAt: new Date().toISOString(),
                fields,
              }
            }),
            composeSessions: sessionId
              ? s.composeSessions.map((c) => {
                  if (c.id !== sessionId) return c
                  const fieldValues = { ...c.fieldValues, [fieldId]: value }
                  const vix = c.activeVersionIndex
                  let versions = c.versions
                  if (vix >= 0 && vix < c.versions.length) {
                    versions = [...c.versions]
                    versions[vix] = { ...versions[vix], [fieldId]: value }
                  }
                  return { ...c, fieldValues, versions }
                })
              : s.composeSessions,
          }
        }),

      addTemplateField: (templateId, field) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === templateId
              ? { ...t, fields: [...t.fields, field], updatedAt: new Date().toISOString() }
              : t,
          ),
        })),

      removeTemplateField: (templateId, fieldId) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === templateId
              ? {
                  ...t,
                  fields: t.fields.filter((f) => f.id !== fieldId),
                  updatedAt: new Date().toISOString(),
                }
              : t,
          ),
        })),

      patchTemplateField: (templateId, fieldId, patch) =>
        set((s) => ({
          templates: s.templates.map((t) => {
            if (t.id !== templateId) return t
            return {
              ...t,
              fields: t.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
              updatedAt: new Date().toISOString(),
            }
          }),
        })),

      setTemplateVersions: (templateId, versions, activeIndex = 0) =>
        set((s) => {
          let composeSessions = s.composeSessions
          let sessionId = resolveComposeSessionIdForTemplate(
            composeSessions,
            s.activeComposeSessionId,
            templateId,
          )
          if (!sessionId) {
            const created = createLetterComposeSession(templateId)
            composeSessions = [...composeSessions, created]
            sessionId = created.id
          }
          const v = versions.slice(0, 8)
          const templates = s.templates.map((t) => {
            if (t.id !== templateId) return t
            if (v.length === 0) {
              return {
                ...t,
                updatedAt: new Date().toISOString(),
                fields: t.fields.map((f) => ({ ...f, value: '' })),
              }
            }
            const idx = Math.min(Math.max(0, activeIndex), v.length - 1)
            const snap = v[idx]
            const fields = t.fields.map((f) => ({ ...f, value: snap[f.id] ?? '' }))
            return { ...t, updatedAt: new Date().toISOString(), fields }
          })
          const composeSessionsNext = composeSessions.map((c) => {
            if (c.id !== sessionId) return c
            if (v.length === 0) {
              return { ...c, versions: [], activeVersionIndex: -1, fieldValues: {} }
            }
            const idx = Math.min(Math.max(0, activeIndex), v.length - 1)
            const snap = v[idx]
            return {
              ...c,
              versions: v,
              activeVersionIndex: idx,
              fieldValues: { ...snap },
            }
          })
          return {
            templates,
            composeSessions: composeSessionsNext,
            activeComposeSessionId: sessionId,
          }
        }),

      setActiveTemplateVersionIndex: (templateId, index) =>
        set((s) => {
          const sessionId = resolveComposeSessionIdForTemplate(
            s.composeSessions,
            s.activeComposeSessionId,
            templateId,
          )
          if (!sessionId) return s
          const sess = s.composeSessions.find((c) => c.id === sessionId)
          if (!sess) return s
          if (index < 0 || index >= sess.versions.length) {
            return {
              composeSessions: s.composeSessions.map((c) =>
                c.id === sessionId ? { ...c, activeVersionIndex: -1 } : c,
              ),
              templates: s.templates.map((t) => {
                if (t.id !== templateId) return t
                return { ...t, updatedAt: new Date().toISOString() }
              }),
            }
          }
          const snap = sess.versions[index]
          return {
            composeSessions: s.composeSessions.map((c) => {
              if (c.id !== sessionId) return c
              return { ...c, activeVersionIndex: index, fieldValues: { ...snap } }
            }),
            templates: s.templates.map((t) => {
              if (t.id !== templateId) return t
              const fields = t.fields.map((f) => ({ ...f, value: snap[f.id] ?? '' }))
              return { ...t, updatedAt: new Date().toISOString(), fields }
            }),
          }
        }),

      setTemplateMappingComplete: (templateId, complete) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === templateId ? { ...t, mappingComplete: complete, updatedAt: new Date().toISOString() } : t,
          ),
        })),

      composeSessions: [],
      activeComposeSessionId: null,
      addComposeSession: (session) =>
        set((s) => ({
          composeSessions: [...s.composeSessions, session],
          activeComposeSessionId: session.id,
        })),
      updateComposeSession: (id, patch) =>
        set((s) => ({
          composeSessions: s.composeSessions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeComposeSession: (id) =>
        set((s) => ({
          composeSessions: s.composeSessions.filter((c) => c.id !== id),
          activeComposeSessionId: s.activeComposeSessionId === id ? null : s.activeComposeSessionId,
        })),
      setActiveComposeSession: (id) => set({ activeComposeSessionId: id }),

      updateComposeSessionField: (sessionId, fieldId, value) =>
        set((s) => ({
          composeSessions: s.composeSessions.map((c) => {
            if (c.id !== sessionId) return c
            const fieldValues = { ...c.fieldValues, [fieldId]: value }
            const vix = c.activeVersionIndex
            let versions = c.versions
            if (vix >= 0 && vix < c.versions.length) {
              versions = [...c.versions]
              versions[vix] = { ...versions[vix], [fieldId]: value }
            }
            return { ...c, fieldValues, versions }
          }),
        })),

      setComposeSessionVersions: (sessionId, versions, activeIndex = 0) =>
        set((s) => ({
          composeSessions: s.composeSessions.map((c) => {
            if (c.id !== sessionId) return c
            const v = versions.slice(0, 8)
            if (v.length === 0) {
              return { ...c, versions: [], activeVersionIndex: -1, fieldValues: {} }
            }
            const idx = Math.min(Math.max(0, activeIndex), v.length - 1)
            const snap = v[idx]
            return {
              ...c,
              versions: v,
              activeVersionIndex: idx,
              fieldValues: { ...snap },
            }
          }),
        })),

      setActiveComposeVersionIndex: (sessionId, index) =>
        set((s) => ({
          composeSessions: s.composeSessions.map((c) => {
            if (c.id !== sessionId) return c
            if (index < 0 || index >= c.versions.length) {
              return { ...c, activeVersionIndex: -1 }
            }
            const snap = c.versions[index]
            return {
              ...c,
              activeVersionIndex: index,
              fieldValues: { ...snap },
            }
          }),
        })),

      letters: [],
      activeLetterId: null,
      activeLetterPage: 0,
      addLetter: (letter) => {
        const full: ScannedLetter = {
          ...letter,
          extractedFields: letter.extractedFields ?? {},
          confidence: letter.confidence ?? {},
        }
        return set((s) => ({
          letters: [...s.letters, full],
          activeLetterId: full.id,
          activeLetterPage: 0,
        }))
      },
      updateLetter: (id, patch) =>
        set((s) => ({
          letters: s.letters.map((l) => {
            if (l.id !== id) return l
            const next: ScannedLetter = { ...l }
            if (patch.extractedFields) {
              next.extractedFields = { ...l.extractedFields, ...patch.extractedFields }
            }
            if (patch.confidence) {
              next.confidence = { ...l.confidence, ...patch.confidence }
            }
            return next
          }),
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

      selectedBuiltinTemplate: null,
      setSelectedBuiltinTemplate: (tmpl) => set({ selectedBuiltinTemplate: tmpl }),
      templateSetupStep: 'chooser',
      setTemplateSetupStep: (step) => set({ templateSetupStep: step }),

      companyProfile: { ...DEFAULT_COMPANY_PROFILE },
      setCompanyProfile: (patch) =>
        set((s) => ({
          companyProfile: { ...s.companyProfile, ...patch },
        })),
    }),
    {
      name: 'wr-desk-letter-composer',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, fromVersion) => {
        const p = persisted as Record<string, unknown>
        if (fromVersion < 2) {
          const templates = Array.isArray(p.templates)
            ? (p.templates as Record<string, unknown>[]).map(migrateLetterTemplateV1)
            : []
          return {
            ...p,
            templates,
            composeSessions: [],
            activeComposeSessionId: null,
          }
        }
        if (fromVersion < 3) {
          return {
            ...(p as object),
            companyProfile: { ...DEFAULT_COMPANY_PROFILE },
          }
        }
        return persisted
      },
      partialize: (s) => ({
        templates: s.templates.map((t) => ({
          ...t,
          pdfPageImages: [],
        })),
        activeTemplateId: s.activeTemplateId,
        composeSessions: s.composeSessions,
        activeComposeSessionId: s.activeComposeSessionId,
        companyProfile: s.companyProfile,
      }),
    },
  ),
)
