import type { DragEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  useLetterComposerStore,
  type LetterPage,
  type ScannedLetter,
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

const EXTRACTED_FIELD_ORDER = [
  'sender_name',
  'sender_address',
  'recipient_name',
  'recipient_address',
  'date',
  'subject',
  'reference_number',
  'salutation',
  'body_summary',
] as const

const EXTRACTED_FIELD_LABELS: Record<(typeof EXTRACTED_FIELD_ORDER)[number], string> = {
  sender_name: 'Sender name',
  sender_address: 'Sender address',
  recipient_name: 'Recipient name',
  recipient_address: 'Recipient address',
  date: 'Date',
  subject: 'Subject',
  reference_number: 'Reference no.',
  salutation: 'Salutation',
  body_summary: 'Summary',
}

const MULTILINE_FIELDS = new Set<string>(['sender_address', 'recipient_address', 'body_summary'])

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.9) return 'high'
  if (c >= 0.7) return 'medium'
  return 'low'
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

  const activeLetter =
    letters.find((l) => l.id === activeLetterId) ?? letters[letters.length - 1] ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractNote, setExtractNote] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

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
        if (api.extractFromScan && api.normalizeExtracted) {
          try {
            const { raw } = await api.extractFromScan(fullText)
            const norm = await api.normalizeExtracted(raw, fullText)
            extractedFields = { ...norm.fields }
            confidence = { ...norm.confidence }
            if (norm.error) {
              setExtractNote(norm.error)
            }
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
      {busy && <p className="template-port__status">Processing…</p>}

      {activeLetter && Object.keys(activeLetter.extractedFields).length > 0 && (
          <div className="extracted-fields">
            <h5 className="extracted-fields__title">Extracted information</h5>
            <p className="extracted-fields__hint">
              Confidence is estimated; edit any field to mark it verified (100%).
            </p>
            {EXTRACTED_FIELD_ORDER.map((key) => {
              const value = activeLetter.extractedFields[key] ?? ''
              const conf = activeLetter.confidence[key] ?? 0
              const level = getConfidenceLevel(conf)
              const label = EXTRACTED_FIELD_LABELS[key]
              const multiline = MULTILINE_FIELDS.has(key)
              return (
                <div key={key} className="extracted-field-row">
                  <span className="extracted-field-row__label">{label}</span>
                  {multiline ? (
                    <textarea
                      className="extracted-field-row__input extracted-field-row__input--multiline"
                      value={value}
                      rows={key === 'body_summary' ? 4 : 3}
                      onChange={(e) => onExtractedFieldChange(key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      className="extracted-field-row__input"
                      value={value}
                      onChange={(e) => onExtractedFieldChange(key, e.target.value)}
                    />
                  )}
                  <span
                    className={`confidence-badge confidence--${level}`}
                    title="Model / rule confidence for this field"
                  >
                    {Math.round(conf * 100)}%
                  </span>
                </div>
              )
            })}
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
