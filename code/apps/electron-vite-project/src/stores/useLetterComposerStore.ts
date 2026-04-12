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
  name: string // semantic name: "sender", "recipient", "body"
  label: string // display label: "Sender", "Recipient", "Body"
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
  /** Name + postal address (merged; same idea as `recipient`). */
  sender: string
  sender_phone: string
  sender_email: string
  signer_name: string
  /** Data URL or future filesystem path from main process. */
  logoPath: string | null
}

export const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  sender: '',
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
    { name: 'sender', label: 'Sender', type: 'address', mode: 'fixed', staticField: true },
    { name: 'sender_phone', label: 'Phone', type: 'text', mode: 'fixed', staticField: true },
    { name: 'sender_email', label: 'Email', type: 'text', mode: 'fixed', staticField: true },
    { name: 'recipient', label: 'Recipient', type: 'address', mode: 'fixed', staticField: false },
    { name: 'date', label: 'Date', type: 'date', mode: 'fixed', staticField: false },
    { name: 'subject', label: 'Subject', type: 'text', mode: 'flow', staticField: false },
    {
      name: 'salutation',
      label: 'Salutation',
      type: 'text',
      mode: 'flow',
      staticField: false,
      defaultValue: 'Dear Sir or Madam,',
    },
    { name: 'body', label: 'Body', type: 'richtext', mode: 'flow', staticField: false },
    {
      name: 'closing',
      label: 'Closing',
      type: 'text',
      mode: 'flow',
      staticField: false,
      defaultValue: 'Kind regards',
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
  /** Ollama model id used when AI normalization ran (snapshot for viewer hint). */
  extractedWithModel?: string
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
  /** ISO 639-1 letter language for salutation/closing defaults and AI drafting. */
  language: string
  createdAt: string
}

const PERSIST_VERSION = 9

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

function combinedRecipientFieldText(nameValue: string, addressValue: string): string {
  const nv = nameValue.trim()
  const av = addressValue.trim()
  if (nv && av) {
    return av.toLowerCase().includes(nv.toLowerCase()) ? av : `${nv}\n${av}`
  }
  return nv || av
}

/** Per-template ID mapping after merging recipient_name + recipient_address → recipient (persist v6). */
type RecipientFieldMergeMeta = {
  templateId: string
  oldNameId?: string
  oldAddrId?: string
  newRecipientId: string
}

/** PDF-mapped fields may keep display labels but use arbitrary semantic `name` — match by label/slug too. */
function isLegacyRecipientNameField(f: TemplateField): boolean {
  if (f.name === 'recipient') return false
  if (f.name === 'recipient_name') return true
  const slug = slugifyTemplateFieldName(f.label)
  return slug === 'recipient_name' || f.label.trim().toLowerCase() === 'recipient name'
}

function isLegacyRecipientAddressField(f: TemplateField): boolean {
  if (f.name === 'recipient') return false
  if (f.name === 'recipient_address') return true
  const slug = slugifyTemplateFieldName(f.label)
  return slug === 'recipient_address' || f.label.trim().toLowerCase() === 'recipient address'
}

function templateHasLegacyRecipientFields(template: LetterTemplate): boolean {
  return template.fields.some((f) => isLegacyRecipientNameField(f) || isLegacyRecipientAddressField(f))
}

/**
 * Merges legacy `recipient_name` + `recipient_address` into a single `recipient` field for persisted templates.
 * Idempotent: also removes legacy fields when both `recipient` and old names exist (partial upgrade state).
 */
function migrateTemplatesRecipientFields(templates: LetterTemplate[]): {
  templates: LetterTemplate[]
  merges: RecipientFieldMergeMeta[]
} {
  const merges: RecipientFieldMergeMeta[] = []
  const out = templates.map((template) => {
    if (!templateHasLegacyRecipientFields(template)) {
      return template
    }

    const oldName = template.fields.find(isLegacyRecipientNameField)
    const oldAddr = template.fields.find(isLegacyRecipientAddressField)
    const existingRecipient = template.fields.find((f) => f.name === 'recipient')

    const nameValue = oldName?.value?.trim() || ''
    const addressValue = oldAddr?.value?.trim() || ''
    const combinedLegacy = combinedRecipientFieldText(nameValue, addressValue)

    if (existingRecipient) {
      const cur = (existingRecipient.value ?? '').trim()
      const mergedValue =
        cur && combinedLegacy
          ? combinedRecipientFieldText(cur, combinedLegacy)
          : cur || combinedLegacy

      merges.push({
        templateId: template.id,
        oldNameId: oldName?.id,
        oldAddrId: oldAddr?.id,
        newRecipientId: existingRecipient.id,
      })

      const newFields = template.fields
        .filter((f) => !isLegacyRecipientNameField(f) && !isLegacyRecipientAddressField(f))
        .map((f) =>
          f.id === existingRecipient.id ? { ...f, value: mergedValue } : f,
        )

      return {
        ...template,
        fields: newFields,
        updatedAt: new Date().toISOString(),
      }
    }

    const newRecipientId = oldName?.id || oldAddr?.id || crypto.randomUUID()
    merges.push({
      templateId: template.id,
      oldNameId: oldName?.id,
      oldAddrId: oldAddr?.id,
      newRecipientId,
    })

    const base = oldAddr ?? oldName
    const def =
      (oldAddr?.defaultValue?.trim() || oldName?.defaultValue?.trim() || '').trim() || ''
    const newRecipientField: TemplateField = {
      id: newRecipientId,
      name: 'recipient',
      label: 'Recipient',
      type: 'address',
      mode: 'fixed',
      page: base?.page ?? 0,
      x: base?.x ?? 0,
      y: base?.y ?? 0,
      w: base?.w ?? 0,
      h: base?.h ?? 0,
      value: combinedLegacy,
      defaultValue: def,
      anchorText: (oldAddr?.anchorText || oldName?.anchorText || '').trim(),
      placeholder: 'Recipient name and address',
    }

    const oldIndex = template.fields.findIndex(
      (f) => isLegacyRecipientNameField(f) || isLegacyRecipientAddressField(f),
    )
    const newFields = template.fields.filter(
      (f) => !isLegacyRecipientNameField(f) && !isLegacyRecipientAddressField(f),
    )
    const insertIndex = oldIndex >= 0 ? Math.min(oldIndex, newFields.length) : newFields.length
    newFields.splice(insertIndex, 0, newRecipientField)
    return {
      ...template,
      fields: newFields,
      updatedAt: new Date().toISOString(),
    }
  })
  return { templates: out, merges }
}

/** Rewrites compose session field id keys after recipient field merge (values are keyed by field id). */
function migrateComposeSessionsRecipientFieldIds(
  sessions: ComposeSession[],
  merges: RecipientFieldMergeMeta[],
): ComposeSession[] {
  const byTemplate = new Map<string, RecipientFieldMergeMeta>()
  for (const m of merges) {
    byTemplate.set(m.templateId, m)
  }
  return sessions.map((session) => {
    const meta = byTemplate.get(session.templateId)
    if (!meta) return session
    const { oldNameId, oldAddrId, newRecipientId } = meta
    const remap = (fv: Record<string, string>): Record<string, string> => {
      const nameVal = oldNameId ? fv[oldNameId] ?? '' : ''
      const addrVal = oldAddrId ? fv[oldAddrId] ?? '' : ''
      const existingNew = fv[newRecipientId] ?? ''
      const next: Record<string, string> = { ...fv }
      if (oldNameId) delete next[oldNameId]
      if (oldAddrId && oldAddrId !== oldNameId) delete next[oldAddrId]
      let combined = combinedRecipientFieldText(nameVal, addrVal)
      if (!combined.trim() && existingNew.trim()) {
        combined = existingNew
      }
      next[newRecipientId] = combined
      return next
    }
    return {
      ...session,
      fieldValues: remap(session.fieldValues ?? {}),
      versions: (session.versions ?? []).map(remap),
    }
  })
}

/** Per-template ID mapping after merging sender_name + sender_address → sender (persist v9). */
type SenderFieldMergeMeta = {
  templateId: string
  oldNameId?: string
  oldAddrId?: string
  newSenderId: string
}

function isLegacySenderNameField(f: TemplateField): boolean {
  return f.name === 'sender_name'
}

function isLegacySenderAddressField(f: TemplateField): boolean {
  return f.name === 'sender_address'
}

function templateHasLegacySenderFields(template: LetterTemplate): boolean {
  return template.fields.some((f) => isLegacySenderNameField(f) || isLegacySenderAddressField(f))
}

/**
 * Merges legacy `sender_name` + `sender_address` into a single `sender` field.
 * Idempotent when `sender` already exists alongside legacy fields.
 */
function migrateTemplatesSenderFields(templates: LetterTemplate[]): {
  templates: LetterTemplate[]
  merges: SenderFieldMergeMeta[]
} {
  const merges: SenderFieldMergeMeta[] = []
  const out = templates.map((template) => {
    if (!templateHasLegacySenderFields(template)) {
      return template
    }

    const oldName = template.fields.find(isLegacySenderNameField)
    const oldAddr = template.fields.find(isLegacySenderAddressField)
    const existingSender = template.fields.find((f) => f.name === 'sender')

    const nameValue = oldName?.value?.trim() || ''
    const addressValue = oldAddr?.value?.trim() || ''
    const combinedLegacy = combinedRecipientFieldText(nameValue, addressValue)

    if (existingSender) {
      const cur = (existingSender.value ?? '').trim()
      const mergedValue =
        cur && combinedLegacy
          ? combinedRecipientFieldText(cur, combinedLegacy)
          : cur || combinedLegacy

      merges.push({
        templateId: template.id,
        oldNameId: oldName?.id,
        oldAddrId: oldAddr?.id,
        newSenderId: existingSender.id,
      })

      const newFields = template.fields
        .filter((f) => !isLegacySenderNameField(f) && !isLegacySenderAddressField(f))
        .map((f) => (f.id === existingSender.id ? { ...f, value: mergedValue } : f))

      return {
        ...template,
        fields: newFields,
        updatedAt: new Date().toISOString(),
      }
    }

    const newSenderId = oldName?.id || oldAddr?.id || crypto.randomUUID()
    merges.push({
      templateId: template.id,
      oldNameId: oldName?.id,
      oldAddrId: oldAddr?.id,
      newSenderId,
    })

    const base = oldAddr ?? oldName
    const def =
      (oldAddr?.defaultValue?.trim() || oldName?.defaultValue?.trim() || '').trim() || ''
    const newSenderField: TemplateField = {
      id: newSenderId,
      name: 'sender',
      label: 'Sender',
      type: 'address',
      mode: 'fixed',
      page: base?.page ?? 0,
      x: base?.x ?? 0,
      y: base?.y ?? 0,
      w: base?.w ?? 0,
      h: base?.h ?? 0,
      value: combinedLegacy,
      defaultValue: def,
      anchorText: (oldAddr?.anchorText || oldName?.anchorText || '').trim(),
      placeholder: 'Sender name and address',
    }

    const oldIndex = template.fields.findIndex(
      (f) => isLegacySenderNameField(f) || isLegacySenderAddressField(f),
    )
    const newFields = template.fields.filter(
      (f) => !isLegacySenderNameField(f) && !isLegacySenderAddressField(f),
    )
    const insertIndex = oldIndex >= 0 ? Math.min(oldIndex, newFields.length) : newFields.length
    newFields.splice(insertIndex, 0, newSenderField)
    return {
      ...template,
      fields: newFields,
      updatedAt: new Date().toISOString(),
    }
  })
  return { templates: out, merges }
}

function migrateComposeSessionsSenderFieldIds(
  sessions: ComposeSession[],
  merges: SenderFieldMergeMeta[],
): ComposeSession[] {
  const byTemplate = new Map<string, SenderFieldMergeMeta>()
  for (const m of merges) {
    byTemplate.set(m.templateId, m)
  }
  return sessions.map((session) => {
    const meta = byTemplate.get(session.templateId)
    if (!meta) return session
    const { oldNameId, oldAddrId, newSenderId } = meta
    const remap = (fv: Record<string, string>): Record<string, string> => {
      const nameVal = oldNameId ? fv[oldNameId] ?? '' : ''
      const addrVal = oldAddrId ? fv[oldAddrId] ?? '' : ''
      const existingNew = fv[newSenderId] ?? ''
      const next: Record<string, string> = { ...fv }
      if (oldNameId) delete next[oldNameId]
      if (oldAddrId && oldAddrId !== oldNameId) delete next[oldAddrId]
      let combined = combinedRecipientFieldText(nameVal, addrVal)
      if (!combined.trim() && existingNew.trim()) {
        combined = existingNew
      }
      next[newSenderId] = combined
      return next
    }
    return {
      ...session,
      fieldValues: remap(session.fieldValues ?? {}),
      versions: (session.versions ?? []).map(remap),
    }
  })
}

function migrateCompanyProfileSenderKeys(raw: unknown): CompanyProfile {
  const legacy = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const sender_phone = String(legacy.sender_phone ?? '')
  const sender_email = String(legacy.sender_email ?? '')
  const signer_name = String(legacy.signer_name ?? '')
  const logoRaw = legacy.logoPath
  const logoPath = logoRaw === null || typeof logoRaw === 'string' ? logoRaw : null

  let sender = String(legacy.sender ?? '').trim()
  if ('sender_name' in legacy || 'sender_address' in legacy) {
    const sn = String(legacy.sender_name ?? '').trim()
    const sa = String(legacy.sender_address ?? '').trim()
    const legacyCombined = sn && sa ? combinedRecipientFieldText(sn, sa) : sn || sa
    sender =
      sender && legacyCombined
        ? combinedRecipientFieldText(sender, legacyCombined)
        : sender || legacyCombined
  }

  return {
    sender,
    sender_phone,
    sender_email,
    signer_name,
    logoPath,
  }
}

/** Semantic keys used by applyVaultDataToTemplate — matches builtin + common PDF mapping variants. */
const VAULT_APPLY_FIELD_CANDIDATES: Record<string, string[]> = {
  sender: [
    'sender',
    'sender_name',
    'sender_address',
    'sender name',
    'sendername',
    'name',
    'organization',
    'company',
    'address',
  ],
  sender_email: ['sender_email', 'sender email', 'senderemail', 'email', 'e-mail', 'e_mail'],
  sender_phone: ['sender_phone', 'sender phone', 'senderphone', 'phone', 'telephone', 'tel', 'mobile'],
  signer_name: ['signer_name', 'signer', 'signer name', 'signername', 'authorized signer', 'ceo_name'],
}

function templateFieldMatchesVaultCandidate(field: TemplateField, candidate: string): boolean {
  const c = candidate.trim().toLowerCase()
  const n = field.name.trim().toLowerCase()
  const label = field.label?.trim().toLowerCase() ?? ''
  const slugFromCandidate = slugifyTemplateFieldName(candidate)
  const slugFromName = slugifyTemplateFieldName(field.name)
  const slugFromLabel = field.label ? slugifyTemplateFieldName(field.label) : ''
  if (n === c || n === slugFromCandidate) return true
  if (label === c || label === candidate.trim().toLowerCase()) return true
  if (slugFromName === slugFromCandidate || slugFromLabel === slugFromCandidate) return true
  return false
}

function findTemplateFieldForVaultApply(fields: TemplateField[], logicalKey: string): TemplateField | undefined {
  const candidates = VAULT_APPLY_FIELD_CANDIDATES[logicalKey] ?? [logicalKey]
  for (const f of fields) {
    for (const cand of candidates) {
      if (templateFieldMatchesVaultCandidate(f, cand)) return f
    }
  }
  return undefined
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
    language: 'en',
    createdAt: new Date().toISOString(),
  }
}

// --- Store ---

/** Cached vault item fields for letter prompt injection (not persisted). */
export type LetterVaultData = {
  name?: string
  address?: string
  email?: string
  phone?: string
  signerName?: string
  companyName?: string
}

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

  /** Which vault category to use for sender data injection */
  letterVaultSource: 'company' | 'personal' | 'none'
  /** Cached vault item data after successful fetch (cleared on lock/switch) */
  letterVaultData: LetterVaultData | null
  /** Whether vault data is currently loading */
  letterVaultLoading: boolean
  /** Error message from vault access attempt */
  letterVaultError: string | null
  /** Available vault items for selected category (id + title only; not persisted) */
  letterVaultItems: Array<{ id: string; title: string }>
  /** Currently selected vault item ID (second dropdown; not persisted) */
  letterVaultSelectedItemId: string | null
  /** Fetched and mapped data for the selected item — preview before apply (not persisted) */
  letterVaultPreview: LetterVaultData | null
  /** Whether preview data has been applied to template fields (not persisted) */
  letterVaultApplied: boolean
  /** Vault data waiting to be applied to the setup wizard. Consumed once by LetterTemplatePort. Not persisted. */
  pendingVaultApplyForSetup: Record<string, string> | null
  setLetterVaultSource: (source: 'company' | 'personal' | 'none') => void
  setLetterVaultData: (data: LetterVaultData | null) => void
  setLetterVaultLoading: (loading: boolean) => void
  setLetterVaultError: (error: string | null) => void
  clearLetterVaultData: () => void
  setLetterVaultItems: (items: Array<{ id: string; title: string }>) => void
  setLetterVaultSelectedItemId: (id: string | null) => void
  setLetterVaultPreview: (data: LetterVaultData | null) => void
  setLetterVaultApplied: (applied: boolean) => void
  setPendingVaultApplyForSetup: (data: Record<string, string> | null) => void
  applyVaultDataToTemplate: () => void
}

export const useLetterComposerStore = create<LetterComposerState>()(
  persist(
    (set, get) => ({
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
          composeSessions: s.composeSessions.map((c) =>
            c.replyToLetterId === id ? { ...c, replyToLetterId: null } : c,
          ),
        })),
      setActiveLetter: (id) => set({ activeLetterId: id, activeLetterPage: 0 }),
      setActiveLetterPage: (page) => set({ activeLetterPage: page }),

      focusedPort: null,
      setFocusedPort: (port) => set({ focusedPort: port }),
      focusedTemplateFieldId: null,
      /** Selecting a template field implies the template port for WR Chat; port buttons can still set letter/null explicitly. */
      setFocusedTemplateField: (fieldId) =>
        set((s) => ({
          focusedTemplateFieldId: fieldId,
          ...(fieldId != null ? { focusedPort: 'template' as const } : {}),
        })),

      selectedBuiltinTemplate: null,
      setSelectedBuiltinTemplate: (tmpl) => set({ selectedBuiltinTemplate: tmpl }),
      templateSetupStep: 'chooser',
      setTemplateSetupStep: (step) => set({ templateSetupStep: step }),

      companyProfile: { ...DEFAULT_COMPANY_PROFILE },
      setCompanyProfile: (patch) =>
        set((s) => ({
          companyProfile: { ...s.companyProfile, ...patch },
        })),

      letterVaultSource: 'none',
      letterVaultData: null,
      letterVaultLoading: false,
      letterVaultError: null,
      letterVaultItems: [],
      letterVaultSelectedItemId: null,
      letterVaultPreview: null,
      letterVaultApplied: false,
      pendingVaultApplyForSetup: null,
      setLetterVaultSource: (source) =>
        set({
          letterVaultSource: source,
          letterVaultData: null,
          letterVaultError: null,
          letterVaultLoading: false,
          letterVaultItems: [],
          letterVaultSelectedItemId: null,
          letterVaultPreview: null,
          letterVaultApplied: false,
          pendingVaultApplyForSetup: null,
        }),
      setLetterVaultData: (data) => set({ letterVaultData: data, letterVaultLoading: false }),
      setLetterVaultLoading: (loading) => set({ letterVaultLoading: loading }),
      setLetterVaultError: (error) => set({ letterVaultError: error, letterVaultLoading: false }),
      clearLetterVaultData: () => set({ letterVaultData: null, letterVaultError: null }),
      setLetterVaultItems: (items) => set({ letterVaultItems: items }),
      setLetterVaultSelectedItemId: (id) =>
        set({
          letterVaultSelectedItemId: id,
          letterVaultPreview: null,
          letterVaultApplied: false,
          pendingVaultApplyForSetup: null,
        }),
      setLetterVaultPreview: (data) => set({ letterVaultPreview: data }),
      setLetterVaultApplied: (applied) => set({ letterVaultApplied: applied }),
      setPendingVaultApplyForSetup: (data) => set({ pendingVaultApplyForSetup: data }),
      applyVaultDataToTemplate: () => {
        const state = get()
        const preview = state.letterVaultPreview
        if (!preview) return

        const mapping: Record<string, string> = {}
        const senderName = preview.name?.trim() || ''
        const senderAddr = preview.address?.trim() || ''
        const senderCombined =
          senderName && senderAddr
            ? senderAddr.toLowerCase().includes(senderName.toLowerCase())
              ? senderAddr
              : `${senderName}\n${senderAddr}`
            : senderName || senderAddr
        if (senderCombined) mapping.sender = senderCombined
        if (preview.email?.trim()) mapping.sender_email = preview.email.trim()
        if (preview.phone?.trim()) mapping.sender_phone = preview.phone.trim()
        if (preview.signerName?.trim()) mapping.signer_name = preview.signerName.trim()

        const template =
          (state.activeTemplateId
            ? state.templates.find((t) => t.id === state.activeTemplateId)
            : undefined) ??
          (state.templates.length === 1 ? state.templates[0] : undefined)

        if (template) {
          const { updateTemplateField } = get()
          for (const [logicalKey, value] of Object.entries(mapping)) {
            const field = findTemplateFieldForVaultApply(template.fields, logicalKey)
            if (field) {
              updateTemplateField(template.id, field.id, value)
            }
          }
        }

        set({
          letterVaultApplied: true,
          pendingVaultApplyForSetup: mapping,
        })
      },
    }),
    {
      name: 'wr-desk-letter-composer',
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted, fromVersion) => {
        let p: Record<string, unknown> = { ...(persisted as Record<string, unknown>) }

        if (fromVersion < 2) {
          const templates = Array.isArray(p.templates)
            ? (p.templates as Record<string, unknown>[]).map(migrateLetterTemplateV1)
            : []
          p = {
            ...p,
            templates,
            composeSessions: [],
            activeComposeSessionId: null,
          }
        }
        if (fromVersion < 3) {
          p = {
            ...p,
            companyProfile: { ...DEFAULT_COMPANY_PROFILE },
          }
        }
        if (fromVersion < 4) {
          const sessions = Array.isArray(p.composeSessions)
            ? (p.composeSessions as Record<string, unknown>[])
            : []
          p = {
            ...p,
            composeSessions: sessions.map((c) => ({
              ...c,
              language: typeof c.language === 'string' && c.language.length > 0 ? c.language : 'en',
            })),
          }
        }
        if (fromVersion < 5) {
          const src = (p as { letterVaultSource?: unknown }).letterVaultSource
          const letterVaultSource =
            src === 'company' || src === 'personal' || src === 'none' ? src : 'none'
          p = {
            ...p,
            letterVaultSource,
          }
        }
        if (fromVersion < 8) {
          const templates = Array.isArray(p.templates) ? (p.templates as LetterTemplate[]) : []
          const composeSessions = Array.isArray(p.composeSessions)
            ? (p.composeSessions as ComposeSession[])
            : []
          const { templates: nextTemplates, merges } = migrateTemplatesRecipientFields(templates)
          const nextSessions = migrateComposeSessionsRecipientFieldIds(composeSessions, merges)
          p = {
            ...p,
            templates: nextTemplates,
            composeSessions: nextSessions,
          }
        }
        if (fromVersion < 9) {
          const templates = Array.isArray(p.templates) ? (p.templates as LetterTemplate[]) : []
          const composeSessions = Array.isArray(p.composeSessions)
            ? (p.composeSessions as ComposeSession[])
            : []
          const { templates: nextTemplates, merges } = migrateTemplatesSenderFields(templates)
          const nextSessions = migrateComposeSessionsSenderFieldIds(composeSessions, merges)
          p = {
            ...p,
            templates: nextTemplates,
            composeSessions: nextSessions,
            companyProfile: migrateCompanyProfileSenderKeys(p.companyProfile),
          }
        }

        return p
      },
      /** Catches legacy fields after rehydration (label-based + semantic names). */
      onRehydrateStorage: () => (state) => {
        if (!state) return
        let templates = state.templates ?? []
        let composeSessions = state.composeSessions ?? []
        let companyProfile = state.companyProfile

        const hasLegacyRecipient = templates.some((t) => templateHasLegacyRecipientFields(t))
        if (hasLegacyRecipient) {
          const { templates: nt, merges } = migrateTemplatesRecipientFields(templates)
          templates = nt
          composeSessions = migrateComposeSessionsRecipientFieldIds(composeSessions, merges)
        }

        const hasLegacySender = templates.some((t) => templateHasLegacySenderFields(t))
        if (hasLegacySender) {
          const { templates: nt, merges } = migrateTemplatesSenderFields(templates)
          templates = nt
          composeSessions = migrateComposeSessionsSenderFieldIds(composeSessions, merges)
        }

        if (companyProfile && typeof companyProfile === 'object') {
          const cp = companyProfile as unknown as Record<string, unknown>
          if ('sender_name' in cp || 'sender_address' in cp) {
            companyProfile = migrateCompanyProfileSenderKeys(companyProfile)
          }
        }

        if (hasLegacyRecipient || hasLegacySender || companyProfile !== state.companyProfile) {
          queueMicrotask(() => {
            useLetterComposerStore.setState({ templates, composeSessions, companyProfile })
          })
        }
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
        letterVaultSource: s.letterVaultSource,
      }),
    },
  ),
)

useLetterComposerStore.persist.onFinishHydration(() => {
  const state = useLetterComposerStore.getState()
  let { templates, composeSessions, companyProfile } = state
  let changed = false

  if (templates.some((t) => templateHasLegacyRecipientFields(t))) {
    const { templates: nt, merges } = migrateTemplatesRecipientFields(templates)
    templates = nt
    composeSessions = migrateComposeSessionsRecipientFieldIds(composeSessions ?? [], merges)
    changed = true
  }

  if (templates.some((t) => templateHasLegacySenderFields(t))) {
    const { templates: nt, merges } = migrateTemplatesSenderFields(templates)
    templates = nt
    composeSessions = migrateComposeSessionsSenderFieldIds(composeSessions ?? [], merges)
    changed = true
  }

  const cp = companyProfile as unknown as Record<string, unknown> | null
  if (cp && ('sender_name' in cp || 'sender_address' in cp)) {
    companyProfile = migrateCompanyProfileSenderKeys(companyProfile)
    changed = true
  }

  if (changed) {
    useLetterComposerStore.setState({ templates, composeSessions, companyProfile })
  }
})

// Post-migration guard (runtime): catch any remaining legacy sender fields after rehydration.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    const { templates, companyProfile } = useLetterComposerStore.getState()
    let changed = false

    const migrated = templates.map((t) => {
      const hasLegacy = t.fields?.some((f) => f.name === 'sender_name' || f.name === 'sender_address')
      if (!hasLegacy) return t
      changed = true

      const fn = t.fields.find((f) => f.name === 'sender_name')
      const fa = t.fields.find((f) => f.name === 'sender_address')
      const nv = fn?.value?.trim() || ''
      const av = fa?.value?.trim() || ''
      const val = nv && av ? `${nv}\n${av}` : nv || av

      const existingSender = t.fields.find((f) => f.name === 'sender')
      if (existingSender) {
        const cur = (existingSender.value ?? '').trim()
        const mergedValue =
          cur && val ? combinedRecipientFieldText(cur, val) : cur || val
        const newFields = t.fields
          .filter((f) => f.name !== 'sender_name' && f.name !== 'sender_address')
          .map((f) => (f.id === existingSender.id ? { ...f, value: mergedValue } : f))
        return { ...t, fields: newFields, updatedAt: new Date().toISOString() }
      }

      const base = fa ?? fn
      const nf: TemplateField = {
        id: fn?.id || fa?.id || crypto.randomUUID(),
        name: 'sender',
        label: 'Sender',
        type: 'address',
        mode: 'fixed',
        page: base?.page ?? 0,
        x: base?.x ?? 0,
        y: base?.y ?? 0,
        w: base?.w ?? 0,
        h: base?.h ?? 0,
        value: val,
        defaultValue: '',
        anchorText: (fa?.anchorText || fn?.anchorText || '').trim(),
      }
      const idx = t.fields.findIndex((f) => f.name === 'sender_name' || f.name === 'sender_address')
      const clean = t.fields.filter((f) => f.name !== 'sender_name' && f.name !== 'sender_address')
      clean.splice(Math.min(idx >= 0 ? idx : clean.length, clean.length), 0, nf)
      return { ...t, fields: clean, updatedAt: new Date().toISOString() }
    })

    let nextCompanyProfile = companyProfile
    const cpLegacy = companyProfile as unknown as Record<string, unknown>
    if ('sender_name' in cpLegacy || 'sender_address' in cpLegacy) {
      changed = true
      nextCompanyProfile = migrateCompanyProfileSenderKeys(companyProfile)
    }

    if (changed) {
      useLetterComposerStore.setState({ templates: migrated, companyProfile: nextCompanyProfile })
      console.log('[MIGRATION] Sender fields migrated')
    }
  }, 500)
}
