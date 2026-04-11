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

  const activeLetter =
    letters.find((l) => l.id === activeLetterId) ?? letters[letters.length - 1] ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

        const letter: ScannedLetter = {
          id: crypto.randomUUID(),
          name: displayName,
          sourceFileName,
          sourceFilePath,
          pages,
          fullText,
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
      {busy && <p className="template-port__status">Processing…</p>}

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
