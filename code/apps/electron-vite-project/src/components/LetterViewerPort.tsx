import type { DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useLetterComposerStore,
  type LetterPage,
  type ScannedLetter,
  type TemplateField,
} from '../stores/useLetterComposerStore'
import { PortSelectButton } from './LetterComposerPortSelectButton'

function isImageFileName(name: string): boolean {
  const low = name.toLowerCase()
  return (
    low.endsWith('.png') ||
    low.endsWith('.jpg') ||
    low.endsWith('.jpeg') ||
    low.endsWith('.tif') ||
    low.endsWith('.tiff') ||
    low.endsWith('.webp')
  )
}

const MULTILINE_KEYS = new Set([
  'sender',
  'sender_address',
  'recipient',
  'body_summary',
  'file_reference',
])

/** Keys shown under References & Contact (reference_number moved here from Letter details). */
const REFERENCE_CONTACT_KEYS = [
  'customer_number',
  'booking_account',
  'invoice_number',
  'contract_number',
  'order_number',
  'file_reference',
  'contact_person',
  'reference_number',
] as const

const REFERENCE_CONTACT_LABELS: Record<(typeof REFERENCE_CONTACT_KEYS)[number], string> = {
  customer_number: 'Customer No.',
  booking_account: 'Booking account',
  invoice_number: 'Invoice No.',
  contract_number: 'Contract No.',
  order_number: 'Order No.',
  file_reference: 'File reference',
  contact_person: 'Contact person',
  reference_number: 'Reference',
}

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.9) return 'high'
  if (c >= 0.7) return 'medium'
  return 'low'
}

/** Display-only merge for sender/recipient name + address (dedupe when model duplicated both). */
function buildCombinedNameAddressBlock(name?: string, address?: string): string {
  const n = (name ?? '').trim()
  const a = (address ?? '').trim()
  if (!n && !a) return ''
  if (!n) return a
  if (!a) return n
  const addressLower = a.toLowerCase()
  const nameLower = n.toLowerCase()
  if (addressLower.startsWith(nameLower) || addressLower.includes(nameLower)) {
    return a
  }
  if (nameLower.includes(addressLower)) {
    return n
  }
  return `${n}\n${a}`
}

function averageConfidence(a: number, b: number): number {
  return (a + b) / 2
}

/** Name + address lines for the reply letter’s recipient block (from the original letter’s sender). */
function combineSenderLinesForReplyRecipient(name: string, address: string): string {
  const n = name.trim()
  const a = address.trim()
  if (!n && !a) return ''
  if (n && a) {
    if (a.toLowerCase().includes(n.toLowerCase())) return a
    return `${n}\n${a}`
  }
  return n || a
}

function findPrimaryRecipientField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name === 'recipient')
}

function applyReplyRecipientToTemplate(
  store: {
    updateTemplateField: (templateId: string, fieldId: string, value: string) => void
  },
  templateId: string,
  templateFields: TemplateField[],
  combined: string,
): boolean {
  const primary = findPrimaryRecipientField(templateFields)
  if (primary) {
    store.updateTemplateField(templateId, primary.id, combined)
    return true
  }
  const legacyName = templateFields.find((f) => f.name === 'recipient_name')
  const legacyAddr = templateFields.find((f) => f.name === 'recipient_address')
  if (legacyName && legacyAddr) {
    const lines = combined.split('\n')
    const first = lines[0]?.trim() ?? ''
    const rest = lines.slice(1).join('\n').trim()
    store.updateTemplateField(templateId, legacyName.id, first)
    store.updateTemplateField(templateId, legacyAddr.id, rest || first)
    return true
  }
  const fallback = legacyName ?? legacyAddr
  if (fallback) {
    store.updateTemplateField(templateId, fallback.id, combined)
    return true
  }
  return false
}

function findSubjectField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase().includes('subject'))
}

function findReferenceField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('reference')
  })
}

function findDateField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase() === 'date' || f.type === 'date')
}

function isSenderContactSubfield(n: string): boolean {
  return (
    n.includes('phone') ||
    n.includes('email') ||
    n.includes('fax') ||
    n.includes('website') ||
    n.includes('iban') ||
    n.includes('bic')
  )
}

function findSenderNameField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return (
      n === 'sender' ||
      n === 'sender_name' ||
      (n.includes('sender') &&
        !n.includes('address') &&
        !n.includes('recipient') &&
        !isSenderContactSubfield(n))
    )
  })
}

function findSenderAddressField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return (
      n === 'sender' ||
      n.includes('sender_address') ||
      (n.includes('sender') && n.includes('address'))
    )
  })
}

/** Prefer merged `sender`; then legacy `sender_name` / `sender_address` template fields. */
function resolveSenderTemplateField(fields: TemplateField[]): TemplateField | undefined {
  const merged = fields.find((f) => f.name === 'sender')
  if (merged) return merged
  return findSenderNameField(fields) ?? findSenderAddressField(fields)
}

function findRecipientEmailField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('recipient') && n.includes('email')
  })
}

function findRecipientPhoneField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('recipient') && (n.includes('phone') || n.includes('tel'))
  })
}

function findSalutationField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase().includes('salutation'))
}

function findBodyField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n === 'body' || n.includes('body') || f.type === 'richtext'
  })
}

/** Maps extraction keys to template semantic names (reply = correspondent swap). */
function mapExtractedToTemplateField(extractedKey: string, mode: 'reply' | 'direct'): string | null {
  if (mode === 'direct') {
    return extractedKey
  }
  const replyMap: Record<string, string> = {
    sender_name: 'recipient',
    sender_address: 'recipient',
    recipient_name: 'sender',
    recipient_address: 'sender',
    subject: 'subject',
    reference_number: 'reference',
    customer_number: 'customer_number',
    booking_account: 'booking_account',
    invoice_number: 'invoice_number',
    contract_number: 'contract_number',
    order_number: 'order_number',
    file_reference: 'file_reference',
    contact_person: 'contact_person',
    date: 'date',
    sender_email: 'recipient_email',
    sender_phone: 'recipient_phone',
    salutation: 'salutation',
    body_summary: 'body',
  }
  return replyMap[extractedKey] ?? null
}

function resolveTemplateFieldForSemanticName(
  fields: TemplateField[],
  semanticName: string,
): TemplateField | undefined {
  const exact = fields.find((f) => f.name === semanticName)
  if (exact) return exact

  switch (semanticName) {
    case 'recipient':
      return (
        findPrimaryRecipientField(fields) ??
        fields.find((f) => f.name === 'recipient_address') ??
        fields.find((f) => f.name === 'recipient_name')
      )
    case 'sender':
    case 'sender_name':
    case 'sender_address':
      return resolveSenderTemplateField(fields)
    case 'subject':
      return findSubjectField(fields)
    case 'reference':
      return findReferenceField(fields)
    case 'date':
      return findDateField(fields)
    case 'recipient_email':
      return findRecipientEmailField(fields)
    case 'recipient_phone':
      return findRecipientPhoneField(fields)
    case 'salutation':
      return findSalutationField(fields)
    case 'body':
      return findBodyField(fields)
    default:
      return undefined
  }
}

function hasExtractedContent(ef: Record<string, string>): boolean {
  return Object.values(ef).some((v) => (v ?? '').trim().length > 0)
}

/** Low confidence only matters when the field has extracted text (empty fields often score 0). */
function letterHasLowConfidenceFields(letter: ScannedLetter): boolean {
  const { confidence, extractedFields } = letter
  if (!confidence || Object.keys(confidence).length === 0) return false
  return Object.entries(confidence).some(([key, c]) => {
    if (typeof c !== 'number' || c >= 0.7) return false
    const v = extractedFields[key]
    return typeof v === 'string' && v.trim().length > 0
  })
}

async function readActiveLlmModelId(): Promise<string | null> {
  try {
    const st = await window.llm?.getStatus?.()
    if (st && 'ok' in st && st.ok && st.data?.activeModel) {
      return st.data.activeModel
    }
  } catch {
    /* noop */
  }
  return null
}

function ExtractedRow({
  label,
  labelTitle,
  fieldKey,
  value,
  confidence,
  multiline,
  onChange,
  hideIfEmpty,
  selected,
  onSelectedChange,
  onUseField,
  useDisabled,
  useTitle,
}: {
  label: string
  /** Tooltip on the label (e.g. helper text for draft context). */
  labelTitle?: string
  fieldKey: string
  value: string
  confidence: number
  multiline?: boolean
  onChange: (key: string, v: string) => void
  hideIfEmpty?: boolean
  selected: boolean
  onSelectedChange: (checked: boolean) => void
  onUseField: () => void
  useDisabled: boolean
  useTitle?: string
}) {
  if (hideIfEmpty && !(value ?? '').trim()) return null
  const level = getConfidenceLevel(confidence)
  return (
    <div className="extracted-row extracted-row--with-actions">
      <input
        type="checkbox"
        className="extracted-row__check"
        checked={selected}
        onChange={(e) => onSelectedChange(e.target.checked)}
        aria-label={`Include ${label} in bulk actions`}
      />
      <span className="extracted-row__label" title={labelTitle}>
        {label}
      </span>
      <div className="extracted-row__value">
        {multiline ? (
          <textarea
            className="extracted-field-row__input extracted-field-row__input--multiline"
            value={value}
            rows={fieldKey === 'body_summary' ? 4 : 3}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          />
        ) : (
          <input
            type="text"
            className="extracted-field-row__input"
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          />
        )}
      </div>
      <button
        type="button"
        className="extracted-row__use"
        disabled={useDisabled}
        title={useTitle ?? 'Insert this field into the template'}
        onClick={onUseField}
      >
        Use
      </button>
      <span
        className={`confidence-badge confidence--${level}`}
        title={`${Math.round((confidence || 0) * 100)}% confidence`}
      >
        {Math.round((confidence || 0) * 100)}%
      </span>
    </div>
  )
}

async function saveLetterFileToStorage(
  file: File,
  api: NonNullable<typeof window.letterComposer>,
): Promise<string> {
  const pathProp = (file as File & { path?: string }).path
  if (pathProp && typeof pathProp === 'string' && api.saveLetterFromPath) {
    return api.saveLetterFromPath(pathProp, file.name)
  }
  const buf = await file.arrayBuffer()
  return api.saveLetterBuffer(file.name, buf)
}

export function LetterViewerPort() {
  const letters = useLetterComposerStore((s) => s.letters)
  const activeLetterId = useLetterComposerStore((s) => s.activeLetterId)
  const setActiveLetter = useLetterComposerStore((s) => s.setActiveLetter)
  const activeLetterPage = useLetterComposerStore((s) => s.activeLetterPage)
  const setActiveLetterPage = useLetterComposerStore((s) => s.setActiveLetterPage)
  const addLetter = useLetterComposerStore((s) => s.addLetter)
  const updateLetter = useLetterComposerStore((s) => s.updateLetter)
  const removeLetter = useLetterComposerStore((s) => s.removeLetter)
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)

  const activeLetter =
    letters.find((l) => l.id === activeLetterId) ?? letters[letters.length - 1] ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractNote, setExtractNote] = useState<string | null>(null)
  const [autofillNote, setAutofillNote] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [liveLlmModelId, setLiveLlmModelId] = useState<string | null>(null)
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({})

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null

  useEffect(() => {
    if (letters.length === 0) return
    const ids = new Set(letters.map((l) => l.id))
    if (activeLetterId == null || !ids.has(activeLetterId)) {
      setActiveLetter(letters[letters.length - 1].id)
    }
  }, [letters, activeLetterId, setActiveLetter])

  useEffect(() => {
    if (!activeLetter) return
    const max = Math.max(0, activeLetter.pages.length - 1)
    if (activeLetterPage > max) {
      setActiveLetterPage(max)
    }
  }, [activeLetter?.id, activeLetter?.pages.length, activeLetterPage, setActiveLetterPage])

  useEffect(() => {
    void readActiveLlmModelId().then(setLiveLlmModelId)
    const off = window.llm?.onActiveModelChanged?.((d) => setLiveLlmModelId(d.modelId))
    return () => {
      off?.()
    }
  }, [])

  useEffect(() => {
    if (!activeLetter?.extractedFields) {
      setSelectedFields({})
      return
    }
    const ef = activeLetter.extractedFields
    const initial: Record<string, boolean> = {}

    const alwaysSelect: readonly string[] = [
      'sender_name',
      'sender_address',
      'sender_email',
      'sender_phone',
      'date',
      'subject',
      'reference_number',
      'customer_number',
      'invoice_number',
      'contract_number',
      'order_number',
      'file_reference',
      'booking_account',
      'salutation',
    ]

    const neverSelect: readonly string[] = [
      'recipient_name',
      'recipient_address',
      'body_summary',
      'contact_person',
      'detected_language',
    ]

    for (const key of Object.keys(ef)) {
      if (!ef[key]?.trim()) continue

      if (alwaysSelect.includes(key)) {
        initial[key] = true
      } else if (neverSelect.includes(key)) {
        initial[key] = false
      } else {
        initial[key] = false
      }
    }

    const sn = (ef.sender_name ?? '').trim()
    const sa = (ef.sender_address ?? '').trim()
    if (sn || sa) {
      initial.sender_name = true
      initial.sender_address = true
    }

    setSelectedFields(initial)
  }, [activeLetter?.id])

  const processLetterFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return

      const api = window.letterComposer
      if (
        !api?.saveLetterBuffer ||
        !api?.processLetterPdf ||
        !api?.processLetterImagePaths ||
        !api?.processLetterImage
      ) {
        setError('Letter upload requires WR Desk (Electron).')
        return
      }

      const allPdf = files.every((f) => f.name.toLowerCase().endsWith('.pdf'))
      const allImage = files.every((f) => isImageFileName(f.name))

      if (!(allPdf && files.length === 1) && !allImage) {
        setError('Upload a single PDF, or one or more images (do not mix types).')
        return
      }

      setError(null)
      setExtractNote(null)
      setBusy(true)
      try {
        let pages: LetterPage[] = []
        let fullText = ''
        let sourceFilePath = ''
        let sourceFileName = ''
        let displayName = ''

        if (allPdf && files.length === 1) {
          const f = files[0]
          sourceFilePath = await saveLetterFileToStorage(f, api)
          sourceFileName = f.name
          displayName = f.name.replace(/\.[^.]+$/i, '')
          const result = await api.processLetterPdf(sourceFilePath)
          fullText = result.fullText
          pages = result.pages.map((p) => ({
            pageNumber: p.pageNumber,
            imageDataUrl: p.imageDataUrl,
            text: p.text,
          }))
        } else {
          const paths: string[] = []
          for (const f of files) {
            paths.push(await saveLetterFileToStorage(f, api))
          }
          sourceFilePath = paths[0] ?? ''
          sourceFileName =
            files.length === 1
              ? files[0].name
              : `${files[0].name} (+${files.length - 1} more)`
          displayName =
            files.length === 1
              ? files[0].name.replace(/\.[^.]+$/i, '')
              : `${files.length} images`
          if (paths.length === 1) {
            const one = await api.processLetterImage(paths[0])
            pages = [{ pageNumber: 1, imageDataUrl: one.imageDataUrl, text: one.text }]
            fullText = one.text
          } else {
            const result = await api.processLetterImagePaths(paths)
            fullText = result.fullText
            pages = result.pages.map((p) => ({
              pageNumber: p.pageNumber,
              imageDataUrl: p.imageDataUrl,
              text: p.text,
            }))
          }
        }

        let extractedFields: Record<string, string> = {}
        let confidence: Record<string, number> = {}
        let extractedWithModel: string | undefined
        if (api.extractFromScan && api.normalizeExtracted) {
          try {
            const { raw } = await api.extractFromScan(fullText)
            const norm = await api.normalizeExtracted(raw, fullText)
            extractedFields = { ...norm.fields }
            confidence = { ...norm.confidence }
            if (norm.error) {
              setExtractNote(norm.error)
            }
            const mid = await readActiveLlmModelId()
            if (mid) extractedWithModel = mid
          } catch (ex) {
            console.warn('[LetterViewerPort] extraction pipeline failed', ex)
            setExtractNote(
              ex instanceof Error ? ex.message : 'Field extraction failed; you can edit fields manually.',
            )
          }
        }

        const letter: ScannedLetter = {
          id: crypto.randomUUID(),
          name: displayName,
          sourceFileName,
          sourceFilePath,
          pages,
          fullText,
          extractedFields,
          confidence,
          ...(extractedWithModel ? { extractedWithModel } : {}),
          createdAt: new Date().toISOString(),
        }
        addLetter(letter)
      } catch (err) {
        console.error('[LetterViewerPort]', err)
        setError(err instanceof Error ? err.message : 'Could not process letter')
      } finally {
        setBusy(false)
      }
    },
    [addLetter],
  )

  const handleFilesReceived = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      const validFiles = files.filter((f) =>
        f.name.match(/\.(pdf|png|jpg|jpeg|tiff|tif|webp)$/i),
      )
      if (validFiles.length === 0) {
        console.warn('[LetterViewer] Only PDF and image files are supported')
        return
      }
      void processLetterFiles(validFiles)
    },
    [processLetterFiles],
  )

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return

      handleFilesReceived(files)
    },
    [handleFilesReceived],
  )

  const currentPage: LetterPage | undefined = activeLetter?.pages[activeLetterPage]
  const pageCount = activeLetter?.pages.length ?? 0

  const onExtractedFieldChange = useCallback(
    (key: string, value: string) => {
      if (!activeLetter) return
      if (key === 'sender_combined') {
        const lines = value.split('\n')
        const name = lines[0]?.trim() ?? ''
        const address = lines.slice(1).join('\n').trim()
        updateLetter(activeLetter.id, {
          extractedFields: { sender_name: name, sender_address: address },
          confidence: { sender_name: 1, sender_address: 1 },
        })
        if (value.trim()) {
          setSelectedFields((prev) => ({
            ...prev,
            sender_name: prev.sender_name ?? true,
            sender_address: prev.sender_address ?? true,
          }))
        }
        return
      }
      updateLetter(activeLetter.id, {
        extractedFields: { [key]: value },
        confidence: { [key]: 1 },
      })
      if (value.trim()) {
        setSelectedFields((prev) => ({ ...prev, [key]: prev[key] ?? true }))
      }
    },
    [activeLetter, updateLetter],
  )

  const handleUseSingleField = useCallback((extractedKey: string) => {
    const store = useLetterComposerStore.getState()
    const letter = store.letters.find((l) => l.id === store.activeLetterId)
    const raw = (letter?.extractedFields[extractedKey] ?? '').trim()
    if (!raw) return

    const template = store.templates.find((t) => t.id === store.activeTemplateId)
    if (!template?.mappingComplete) {
      setAutofillNote('Finish template field mapping before using extracted fields.')
      return
    }

    const semantic = mapExtractedToTemplateField(extractedKey, 'reply')
    if (!semantic) return

    let value = raw
    if (extractedKey === 'subject') {
      value = raw.toLowerCase().startsWith('re:') ? raw : `Re: ${raw}`
    }

    const field = resolveTemplateFieldForSemanticName(template.fields, semantic)
    if (!field) {
      setAutofillNote(
        `No matching template field for “${semantic}”. Add or name a field in the template.`,
      )
      return
    }

    store.updateTemplateField(template.id, field.id, value)
    setAutofillNote(null)
  }, [])

  const handleUseCombinedSender = useCallback(() => {
    const store = useLetterComposerStore.getState()
    const letter = store.letters.find((l) => l.id === store.activeLetterId)
    const fields = letter?.extractedFields
    if (!fields) return

    const template = store.templates.find((t) => t.id === store.activeTemplateId)
    if (!template?.mappingComplete) {
      setAutofillNote('Finish template field mapping before using extracted fields.')
      return
    }

    const combined = combineSenderLinesForReplyRecipient(
      fields.sender_name ?? '',
      fields.sender_address ?? '',
    )
    if (!combined) return

    const ok = applyReplyRecipientToTemplate(store, template.id, template.fields, combined)
    if (!ok) {
      setAutofillNote(
        'No matching template field for recipient (reply). Add a “Recipient” field or legacy recipient name/address fields.',
      )
      return
    }
    setAutofillNote(null)
  }, [])

  const handleUseSelected = useCallback(() => {
    const store = useLetterComposerStore.getState()
    const letter = store.letters.find((l) => l.id === store.activeLetterId)
    if (!letter?.extractedFields) return

    const template = store.templates.find((t) => t.id === store.activeTemplateId)
    if (!template?.mappingComplete) {
      setAutofillNote('Finish template field mapping before using extracted fields.')
      return
    }

    const nameSel = selectedFields.sender_name
    const addrSel = selectedFields.sender_address
    if (nameSel || addrSel) {
      const namePart = (letter.extractedFields.sender_name ?? '').trim()
      const addrPart = (letter.extractedFields.sender_address ?? '').trim()
      let combined = ''
      if (nameSel && addrSel) {
        combined = combineSenderLinesForReplyRecipient(namePart, addrPart)
      } else if (nameSel) {
        combined = namePart
      } else if (addrSel) {
        combined = addrPart
      }
      if (combined) {
        applyReplyRecipientToTemplate(store, template.id, template.fields, combined)
      }
    }

    for (const [key, isSelected] of Object.entries(selectedFields)) {
      if (!isSelected) continue
      if (
        key === 'sender_name' ||
        key === 'sender_address' ||
        key === 'recipient_name' ||
        key === 'recipient_address' ||
        key === 'sender_combined' ||
        key === 'recipient_combined'
      ) {
        continue
      }
      const raw = (letter.extractedFields[key] ?? '').trim()
      if (!raw) continue

      const semantic = mapExtractedToTemplateField(key, 'reply')
      if (!semantic) continue

      const field = resolveTemplateFieldForSemanticName(template.fields, semantic)
      if (!field) continue

      store.updateTemplateField(template.id, field.id, raw)
    }
    setAutofillNote(null)
  }, [selectedFields])

  const handleUseAsReply = useCallback(() => {
    const store = useLetterComposerStore.getState()
    const letter = store.letters.find((l) => l.id === store.activeLetterId)
    if (!letter?.extractedFields) return

    const template = store.templates.find((t) => t.id === store.activeTemplateId)
    if (!template?.mappingComplete) {
      setAutofillNote('Finish template field mapping before using reply autofill.')
      return
    }

    const today = new Date().toISOString().split('T')[0]

    const nameSel = selectedFields.sender_name
    const addrSel = selectedFields.sender_address
    if (nameSel || addrSel) {
      const namePart = (letter.extractedFields.sender_name ?? '').trim()
      const addrPart = (letter.extractedFields.sender_address ?? '').trim()
      let combined = ''
      if (nameSel && addrSel) {
        combined = combineSenderLinesForReplyRecipient(namePart, addrPart)
      } else if (nameSel) {
        combined = namePart
      } else if (addrSel) {
        combined = addrPart
      }
      if (combined) {
        applyReplyRecipientToTemplate(store, template.id, template.fields, combined)
      }
    }

    for (const [key, isSelected] of Object.entries(selectedFields)) {
      if (!isSelected) continue
      if (
        key === 'sender_name' ||
        key === 'sender_address' ||
        key === 'recipient_name' ||
        key === 'recipient_address' ||
        key === 'sender_combined' ||
        key === 'recipient_combined'
      ) {
        continue
      }
      const raw = (letter.extractedFields[key] ?? '').trim()
      if (!raw) continue

      const semantic = mapExtractedToTemplateField(key, 'reply')
      if (!semantic) continue

      const field = resolveTemplateFieldForSemanticName(template.fields, semantic)
      if (!field) continue

      let value = raw
      if (key === 'subject') {
        value = raw.toLowerCase().startsWith('re:') ? raw : `Re: ${raw}`
      } else if (key === 'date') {
        value = today
      }

      store.updateTemplateField(template.id, field.id, value)
    }

    const aid = store.activeComposeSessionId
    const sess =
      (aid
        ? store.composeSessions.find((c) => c.id === aid && c.templateId === template.id)
        : undefined) ?? store.composeSessions.find((c) => c.templateId === template.id)
    if (sess) {
      store.updateComposeSession(sess.id, { replyToLetterId: letter.id })
    }

    setAutofillNote('Reply: applied selected fields; subject and date use reply conventions.')
  }, [selectedFields])

  const handleClear = useCallback(() => {
    const id = activeLetter?.id
    if (!id) return
    removeLetter(id)
    setSelectedFields({})
    setAutofillNote(null)
  }, [activeLetter?.id, removeLetter])

  const ef = activeLetter?.extractedFields ?? {}
  const conf = activeLetter?.confidence ?? {}

  const canApplyExtracted = !!activeTemplateId && !!activeTemplate?.mappingComplete

  const senderCombinedDisplay = useMemo(
    () => buildCombinedNameAddressBlock(ef.sender_name, ef.sender_address),
    [ef.sender_name, ef.sender_address],
  )
  const senderCombinedConf = useMemo(() => {
    const n = (ef.sender_name ?? '').trim()
    const a = (ef.sender_address ?? '').trim()
    if (n && a) return averageConfidence(conf.sender_name ?? 0, conf.sender_address ?? 0)
    if (n) return conf.sender_name ?? 0
    if (a) return conf.sender_address ?? 0
    return 0
  }, [ef.sender_name, ef.sender_address, conf.sender_name, conf.sender_address])

  const combinedSenderUse = useMemo(() => {
    const canName = !!(ef.sender_name ?? '').trim()
    const canAddr = !!(ef.sender_address ?? '').trim()
    if (!canApplyExtracted) {
      return { useDisabled: true, useTitle: 'Select a template and finish field mapping first' }
    }
    if (!canName && !canAddr) {
      return { useDisabled: true, useTitle: 'No value to insert' }
    }
    if (!activeTemplate) {
      return { useDisabled: true, useTitle: 'Select a template and finish field mapping first' }
    }
    const sem = mapExtractedToTemplateField('sender_name', 'reply')
    const fieldR = sem ? resolveTemplateFieldForSemanticName(activeTemplate.fields, sem) : undefined
    const canInsert = Boolean((canName || canAddr) && fieldR)
    const useDisabled = !canInsert
    const useTitle = useDisabled
      ? 'No matching template field for recipient (reply letter)'
      : 'Insert original sender as reply recipient (name + address)'
    return { useDisabled, useTitle }
  }, [activeTemplate, canApplyExtracted, ef.sender_name, ef.sender_address])

  const hasSelectedExtracted = useMemo(
    () => Object.values(selectedFields).some(Boolean),
    [selectedFields],
  )

  const bulkActionsDisabled = !hasSelectedExtracted || !canApplyExtracted

  const getExtractedRowControls = (fieldKey: string) => {
    const trimmed = (ef[fieldKey] ?? '').trim()
    const semantic = mapExtractedToTemplateField(fieldKey, 'reply')
    const resolved =
      semantic && activeTemplate
        ? resolveTemplateFieldForSemanticName(activeTemplate.fields, semantic)
        : undefined
    const useDisabled = !canApplyExtracted || !trimmed || !semantic || !resolved

    let useTitle = 'Insert this field into the template (reply mapping)'
    if (!canApplyExtracted) {
      useTitle = 'Select a template and finish field mapping first'
    } else if (!trimmed) {
      useTitle = 'No value to insert'
    } else if (!semantic || !resolved) {
      useTitle = 'No matching template field for this extraction'
    }

    return {
      selected: selectedFields[fieldKey] ?? false,
      onSelectedChange: (checked: boolean) =>
        setSelectedFields((prev) => ({ ...prev, [fieldKey]: checked })),
      onUseField: () => handleUseSingleField(fieldKey),
      useDisabled,
      useTitle,
    }
  }

  const extractionModelLabel = useMemo(() => {
    if (!activeLetter) return 'local model'
    return (
      activeLetter.extractedWithModel?.trim() ||
      liveLlmModelId?.trim() ||
      'local model'
    )
  }, [activeLetter, activeLetter?.extractedWithModel, liveLlmModelId])

  const hasLowConfidenceFields = useMemo(
    () => (activeLetter ? letterHasLowConfidenceFields(activeLetter) : false),
    [activeLetter, activeLetter?.confidence, activeLetter?.extractedFields],
  )

  const hasAnyReferenceField = useMemo(() => {
    const x = activeLetter?.extractedFields ?? {}
    return REFERENCE_CONTACT_KEYS.some((k) => (x[k] ?? '').trim().length > 0)
  }, [activeLetter?.id, activeLetter?.extractedFields])

  return (
    <div
      className={`viewer-port letter-port${isDragOver ? ' letter-port--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="port-header">
        <h4>Letter Viewer</h4>
        <PortSelectButton port="letter" />
      </div>

      {letters.length > 0 && (
        <div className="template-picker letter-viewer__letter-picker">
          <label htmlFor="letter-active-scan" className="template-picker__label">
            Active letter
          </label>
          <select
            id="letter-active-scan"
            className="template-picker__select"
            value={activeLetter?.id ?? ''}
            onChange={(ev) => setActiveLetter(ev.target.value ? ev.target.value : null)}
          >
            {letters.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!activeLetter ? (
        <div className="letter-port__empty-drop-zone">
          <div className="letter-port__drop-icon" aria-hidden>
            {'\u{1F4EC}'}
          </div>
          <p className="letter-port__drop-text">Drag & drop a scanned letter here</p>
          <p className="letter-port__drop-subtext">PDF or images (PNG, JPG, TIFF)</p>
          <p className="letter-port__drop-subtext">or</p>
          <label className="letter-port__browse-btn">
            Browse files
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.webp,image/png,image/jpeg,application/pdf"
              multiple
              disabled={busy}
              onChange={(e) => {
                handleFilesReceived(Array.from(e.target.files || []))
                e.target.value = ''
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      ) : (
        <div className="port-upload-zone port-upload-zone--add-more">
          <input
            id="letter-scan-file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.webp,image/png,image/jpeg,application/pdf"
            multiple
            disabled={busy}
            onChange={(e) => {
              handleFilesReceived(Array.from(e.target.files || []))
              e.target.value = ''
            }}
          />
        </div>
      )}

      {error && <p className="template-port__error">{error}</p>}
      {extractNote && !error && (
        <p className="letter-viewer__extract-note" role="status">
          {extractNote}
        </p>
      )}
      {autofillNote && !error && (
        <p className="letter-viewer__extract-note" role="status">
          {autofillNote}
        </p>
      )}
      {busy && <p className="template-port__status">Processing…</p>}

      {activeLetter && !hasExtractedContent(ef) && !busy && (
        <div className="letter-viewer__extracted-actions letter-viewer__extracted-actions--solo">
          <button
            type="button"
            className="letter-viewer__extracted-actions__btn letter-viewer__extracted-actions__btn--clear"
            onClick={handleClear}
          >
            Clear scan
          </button>
        </div>
      )}

      {activeLetter && hasExtractedContent(ef) && (
        <div className="extracted-fields extracted-info">
          <h5 className="extracted-fields__title">Extracted information</h5>
          <p className="extracted-fields__hint">
            Postal address fields exclude phone, email, IBAN, and legal IDs. Edit any field to mark it
            verified (100%).
          </p>

          <div className="extracted-group">
            <h5>Sender</h5>
            <ExtractedRow
              label="Sender"
              fieldKey="sender_combined"
              value={senderCombinedDisplay}
              confidence={senderCombinedConf}
              multiline
              onChange={onExtractedFieldChange}
              hideIfEmpty
              selected={(selectedFields.sender_name ?? false) && (selectedFields.sender_address ?? false)}
              onSelectedChange={(checked) =>
                setSelectedFields((prev) => ({
                  ...prev,
                  sender_name: checked,
                  sender_address: checked,
                }))
              }
              onUseField={handleUseCombinedSender}
              useDisabled={combinedSenderUse.useDisabled}
              useTitle={combinedSenderUse.useTitle}
            />
            <ExtractedRow
              label="Phone"
              fieldKey="sender_phone"
              value={ef.sender_phone ?? ''}
              confidence={conf.sender_phone ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('sender_phone')}
            />
            <ExtractedRow
              label="Fax"
              fieldKey="sender_fax"
              value={ef.sender_fax ?? ''}
              confidence={conf.sender_fax ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('sender_fax')}
            />
            <ExtractedRow
              label="Email"
              fieldKey="sender_email"
              value={ef.sender_email ?? ''}
              confidence={conf.sender_email ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('sender_email')}
            />
            <ExtractedRow
              label="Website"
              fieldKey="sender_website"
              value={ef.sender_website ?? ''}
              confidence={conf.sender_website ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('sender_website')}
            />
          </div>

          {hasAnyReferenceField ? (
            <div className="extracted-group">
              <h5>References &amp; contact</h5>
              {REFERENCE_CONTACT_KEYS.map((fieldKey) => (
                <ExtractedRow
                  key={fieldKey}
                  label={REFERENCE_CONTACT_LABELS[fieldKey]}
                  fieldKey={fieldKey}
                  value={ef[fieldKey] ?? ''}
                  confidence={conf[fieldKey] ?? 0}
                  multiline={MULTILINE_KEYS.has(fieldKey)}
                  onChange={onExtractedFieldChange}
                  hideIfEmpty
                  {...getExtractedRowControls(fieldKey)}
                />
              ))}
            </div>
          ) : null}

          <div className="extracted-group">
            <h5>Letter details</h5>
            <ExtractedRow
              label="Date"
              fieldKey="date"
              value={ef.date ?? ''}
              confidence={conf.date ?? 0}
              onChange={onExtractedFieldChange}
              {...getExtractedRowControls('date')}
            />
            <ExtractedRow
              label="Subject"
              fieldKey="subject"
              value={ef.subject ?? ''}
              confidence={conf.subject ?? 0}
              onChange={onExtractedFieldChange}
              {...getExtractedRowControls('subject')}
            />
            <ExtractedRow
              label="Salutation"
              fieldKey="salutation"
              value={ef.salutation ?? ''}
              confidence={conf.salutation ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('salutation')}
            />
            <ExtractedRow
              label="Draft reply context"
              labelTitle="Summary of the original letter — used as context when drafting a reply with AI"
              fieldKey="body_summary"
              value={ef.body_summary ?? ''}
              confidence={conf.body_summary ?? 0}
              multiline={MULTILINE_KEYS.has('body_summary')}
              onChange={onExtractedFieldChange}
              hideIfEmpty
              {...getExtractedRowControls('body_summary')}
            />
          </div>

          {(ef.sender_iban ?? '').trim() || (ef.sender_bic ?? '').trim() || (ef.sender_bank ?? '').trim() ? (
            <div className="extracted-group">
              <h5>Bank details</h5>
              <ExtractedRow
                label="IBAN"
                fieldKey="sender_iban"
                value={ef.sender_iban ?? ''}
                confidence={conf.sender_iban ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
                {...getExtractedRowControls('sender_iban')}
              />
              <ExtractedRow
                label="BIC"
                fieldKey="sender_bic"
                value={ef.sender_bic ?? ''}
                confidence={conf.sender_bic ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
                {...getExtractedRowControls('sender_bic')}
              />
              <ExtractedRow
                label="Bank"
                fieldKey="sender_bank"
                value={ef.sender_bank ?? ''}
                confidence={conf.sender_bank ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
                {...getExtractedRowControls('sender_bank')}
              />
            </div>
          ) : null}

          {(ef.sender_tax_id || ef.sender_registration) &&
          ((ef.sender_tax_id ?? '').trim() || (ef.sender_registration ?? '').trim()) ? (
            <div className="extracted-group">
              <h5>Legal information</h5>
              <ExtractedRow
                label="Tax ID"
                fieldKey="sender_tax_id"
                value={ef.sender_tax_id ?? ''}
                confidence={conf.sender_tax_id ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
                {...getExtractedRowControls('sender_tax_id')}
              />
              <ExtractedRow
                label="Registration"
                fieldKey="sender_registration"
                value={ef.sender_registration ?? ''}
                confidence={conf.sender_registration ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
                {...getExtractedRowControls('sender_registration')}
              />
            </div>
          ) : null}

          <div className="letter-viewer__extracted-actions">
            <button
              type="button"
              className="letter-viewer__extracted-actions__btn"
              disabled={bulkActionsDisabled}
              onClick={handleUseSelected}
            >
              Use Selected
            </button>
            <button
              type="button"
              className="letter-viewer__extracted-actions__btn letter-viewer__extracted-actions__btn--primary"
              disabled={bulkActionsDisabled}
              onClick={handleUseAsReply}
              title="Apply checked fields; subject gets Re:; date set to today; links compose session to this letter"
            >
              {'\u{1F4EC}'} Use as reply
            </button>
            <button
              type="button"
              className="letter-viewer__extracted-actions__btn letter-viewer__extracted-actions__btn--clear"
              onClick={handleClear}
            >
              Clear
            </button>
          </div>

          <div className="extraction-model-hint">
            <span className="extraction-model-hint__icon" aria-hidden>
              {'\u{1F916}'}
            </span>
            <span className="extraction-model-hint__text">
              Extracted with <strong>{extractionModelLabel}</strong>. Larger models (30B+) or cloud
              models produce more accurate results. Switch in the top bar ↑
            </span>
          </div>

          {hasLowConfidenceFields ? (
            <div className="extraction-low-confidence-hint" role="status">
              {'\u26A0'} Some fields have low confidence — review before using.
            </div>
          ) : null}
        </div>
      )}

      {activeLetter && pageCount > 0 && currentPage?.imageDataUrl && (
        <div className="letter-pages">
          <p className="letter-pages__meta">
            Page {activeLetterPage + 1} of {pageCount}
          </p>
          <div className="page-nav">
            <button
              type="button"
              disabled={activeLetterPage <= 0}
              onClick={() => setActiveLetterPage(Math.max(0, activeLetterPage - 1))}
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={activeLetterPage >= pageCount - 1}
              onClick={() =>
                setActiveLetterPage(Math.min(pageCount - 1, activeLetterPage + 1))
              }
            >
              Next →
            </button>
          </div>
          <div className="letter-viewer__frame">
            <img
              className="letter-viewer__img"
              src={currentPage.imageDataUrl}
              alt={`Letter page ${currentPage.pageNumber}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
