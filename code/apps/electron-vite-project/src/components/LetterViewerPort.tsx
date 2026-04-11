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

const MULTILINE_KEYS = new Set(['sender_address', 'recipient_address', 'body_summary'])

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.9) return 'high'
  if (c >= 0.7) return 'medium'
  return 'low'
}

function findRecipientNameField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => {
    const n = f.name.toLowerCase()
    return n.includes('recipient') && !n.includes('address')
  })
}

function findRecipientAddressField(fields: TemplateField[]): TemplateField | undefined {
  return fields.find((f) => f.name.toLowerCase().includes('recipient_address'))
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
  fieldKey,
  value,
  confidence,
  multiline,
  onChange,
  hideIfEmpty,
}: {
  label: string
  fieldKey: string
  value: string
  confidence: number
  multiline?: boolean
  onChange: (key: string, v: string) => void
  hideIfEmpty?: boolean
}) {
  if (hideIfEmpty && !(value ?? '').trim()) return null
  const level = getConfidenceLevel(confidence)
  return (
    <div className="extracted-row">
      <span className="extracted-row__label">{label}</span>
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
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)
  const updateTemplateField = useLetterComposerStore((s) => s.updateTemplateField)
  const composeSessions = useLetterComposerStore((s) => s.composeSessions)
  const updateComposeSession = useLetterComposerStore((s) => s.updateComposeSession)

  const activeLetter =
    letters.find((l) => l.id === activeLetterId) ?? letters[letters.length - 1] ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractNote, setExtractNote] = useState<string | null>(null)
  const [autofillNote, setAutofillNote] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [liveLlmModelId, setLiveLlmModelId] = useState<string | null>(null)

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null
  const canAutofill =
    !!activeTemplate?.mappingComplete &&
    !!activeLetter &&
    hasExtractedContent(activeLetter.extractedFields)

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
      updateLetter(activeLetter.id, {
        extractedFields: { [key]: value },
        confidence: { [key]: 1 },
      })
    },
    [activeLetter, updateLetter],
  )

  const autoFillFromLetter = useCallback(
    (letter: ScannedLetter) => {
      setAutofillNote(null)
      const ef = letter.extractedFields
      if (!ef || !hasExtractedContent(ef)) return

      const tid = activeTemplateId
      if (!tid) {
        setAutofillNote('Select a letter template first (Template port).')
        return
      }
      const tpl = templates.find((t) => t.id === tid)
      if (!tpl?.mappingComplete) {
        setAutofillNote('Finish template field mapping before using reply autofill.')
        return
      }

      const fields = tpl.fields
      const rName = findRecipientNameField(fields)
      const rAddr = findRecipientAddressField(fields)
      const subj = findSubjectField(fields)
      const refF = findReferenceField(fields)
      const dateF = findDateField(fields)

      const recipientAddress = (ef.sender_address ?? '').trim()
      const recipientName = (ef.sender_name ?? '').trim()
      const subjVal = (ef.subject ?? '').trim()
      const refVal = (ef.reference_number ?? '').trim()
      const today = new Date().toISOString().split('T')[0]

      if (rName && recipientName) updateTemplateField(tid, rName.id, recipientName)
      if (rAddr && recipientAddress) updateTemplateField(tid, rAddr.id, recipientAddress)
      if (subj && subjVal) {
        const s = subjVal
        const next = s.toLowerCase().startsWith('re:') ? s : `Re: ${s}`
        updateTemplateField(tid, subj.id, next)
      }
      if (refF && refVal) updateTemplateField(tid, refF.id, refVal)
      if (dateF) updateTemplateField(tid, dateF.id, today)

      const sess = composeSessions.find((c) => c.templateId === tid)
      if (sess) {
        updateComposeSession(sess.id, { replyToLetterId: letter.id })
      }

      setAutofillNote('Recipient fields updated from this letter (postal data only).')
    },
    [
      activeTemplateId,
      templates,
      updateTemplateField,
      composeSessions,
      updateComposeSession,
    ],
  )

  const ef = activeLetter?.extractedFields ?? {}
  const conf = activeLetter?.confidence ?? {}

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
          <p>Add another scan (one PDF, or one or more images)</p>
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
              label="Name"
              fieldKey="sender_name"
              value={ef.sender_name ?? ''}
              confidence={conf.sender_name ?? 0}
              onChange={onExtractedFieldChange}
            />
            <ExtractedRow
              label="Address"
              fieldKey="sender_address"
              value={ef.sender_address ?? ''}
              confidence={conf.sender_address ?? 0}
              multiline={MULTILINE_KEYS.has('sender_address')}
              onChange={onExtractedFieldChange}
            />
            <ExtractedRow
              label="Phone"
              fieldKey="sender_phone"
              value={ef.sender_phone ?? ''}
              confidence={conf.sender_phone ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
            <ExtractedRow
              label="Fax"
              fieldKey="sender_fax"
              value={ef.sender_fax ?? ''}
              confidence={conf.sender_fax ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
            <ExtractedRow
              label="Email"
              fieldKey="sender_email"
              value={ef.sender_email ?? ''}
              confidence={conf.sender_email ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
            <ExtractedRow
              label="Website"
              fieldKey="sender_website"
              value={ef.sender_website ?? ''}
              confidence={conf.sender_website ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
          </div>

          <div className="extracted-group">
            <h5>Recipient</h5>
            <ExtractedRow
              label="Name"
              fieldKey="recipient_name"
              value={ef.recipient_name ?? ''}
              confidence={conf.recipient_name ?? 0}
              onChange={onExtractedFieldChange}
            />
            <ExtractedRow
              label="Address"
              fieldKey="recipient_address"
              value={ef.recipient_address ?? ''}
              confidence={conf.recipient_address ?? 0}
              multiline={MULTILINE_KEYS.has('recipient_address')}
              onChange={onExtractedFieldChange}
            />
          </div>

          <div className="extracted-group">
            <h5>Letter details</h5>
            <ExtractedRow
              label="Date"
              fieldKey="date"
              value={ef.date ?? ''}
              confidence={conf.date ?? 0}
              onChange={onExtractedFieldChange}
            />
            <ExtractedRow
              label="Subject"
              fieldKey="subject"
              value={ef.subject ?? ''}
              confidence={conf.subject ?? 0}
              onChange={onExtractedFieldChange}
            />
            <ExtractedRow
              label="Reference"
              fieldKey="reference_number"
              value={ef.reference_number ?? ''}
              confidence={conf.reference_number ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
            <ExtractedRow
              label="Salutation"
              fieldKey="salutation"
              value={ef.salutation ?? ''}
              confidence={conf.salutation ?? 0}
              onChange={onExtractedFieldChange}
              hideIfEmpty
            />
            <ExtractedRow
              label="Summary"
              fieldKey="body_summary"
              value={ef.body_summary ?? ''}
              confidence={conf.body_summary ?? 0}
              multiline={MULTILINE_KEYS.has('body_summary')}
              onChange={onExtractedFieldChange}
              hideIfEmpty
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
              />
              <ExtractedRow
                label="BIC"
                fieldKey="sender_bic"
                value={ef.sender_bic ?? ''}
                confidence={conf.sender_bic ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
              />
              <ExtractedRow
                label="Bank"
                fieldKey="sender_bank"
                value={ef.sender_bank ?? ''}
                confidence={conf.sender_bank ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
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
              />
              <ExtractedRow
                label="Registration"
                fieldKey="sender_registration"
                value={ef.sender_registration ?? ''}
                confidence={conf.sender_registration ?? 0}
                onChange={onExtractedFieldChange}
                hideIfEmpty
              />
            </div>
          ) : null}

          <button
            type="button"
            className="letter-viewer__autofill-btn"
            disabled={!canAutofill}
            onClick={() => activeLetter && autoFillFromLetter(activeLetter)}
          >
            {'\u{1F4EC}'} Use as reply → fill recipient fields
          </button>

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
