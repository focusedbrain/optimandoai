import type { DragEvent, MouseEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLetterComposerStore, type LetterTemplate } from '../stores/useLetterComposerStore'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { PortSelectButton } from './LetterComposerPortSelectButton'

const TEMPLATE_FILE_RE = /\.(docx|odt|doc|rtf|txt)$/i

export function LetterTemplatePort() {
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)
  const setActiveTemplate = useLetterComposerStore((s) => s.setActiveTemplate)
  const addTemplate = useLetterComposerStore((s) => s.addTemplate)
  const removeTemplate = useLetterComposerStore((s) => s.removeTemplate)
  const activeTemplate = templates.find((t) => t.id === activeTemplateId)

  const documentRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastTemplateIdRef = useRef<string | null>(null)
  const selectedBlockRef = useRef<HTMLElement | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const syncTemplateHtmlFromDom = useCallback(() => {
    const el = documentRef.current
    if (!el || !activeTemplateId) return
    useLetterComposerStore.getState().updateTemplate(activeTemplateId, {
      renderedHtml: el.innerHTML,
    })
  }, [activeTemplateId])

  useEffect(() => {
    const t = activeTemplate
    if (!t?.sourceFilePath || (t.renderedHtml && t.renderedHtml.length > 0)) {
      setRehydrating(false)
      return
    }
    const api = typeof window !== 'undefined' ? window.letterComposer : undefined
    if (!api?.convertDocxToHtml) {
      setRehydrating(false)
      return
    }
    let cancelled = false
    setRehydrating(true)
    void (async () => {
      try {
        const { html } = await api.convertDocxToHtml(t.sourceFilePath)
        if (!cancelled) {
          useLetterComposerStore.getState().updateTemplate(t.id, { renderedHtml: html })
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[LetterTemplatePort] rehydrate HTML failed', e)
          setError(e instanceof Error ? e.message : 'Could not reload template preview')
        }
      } finally {
        if (!cancelled) setRehydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTemplate?.id, activeTemplate?.sourceFilePath, activeTemplate?.renderedHtml])

  useEffect(() => {
    const el = documentRef.current
    if (!el || !activeTemplate) return

    const idChanged = lastTemplateIdRef.current !== activeTemplate.id
    lastTemplateIdRef.current = activeTemplate.id

    if (idChanged) {
      el.innerHTML = activeTemplate.renderedHtml || ''
      el.querySelectorAll('.template-block-selected').forEach((n) => n.classList.remove('template-block-selected'))
      selectedBlockRef.current = null
      return
    }

    if (el.contains(document.activeElement)) return

    const next = activeTemplate.renderedHtml || ''
    if (el.innerHTML !== next) {
      el.innerHTML = next
    }
  }, [activeTemplate?.id, activeTemplate?.renderedHtml])

  const processTemplateFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (!TEMPLATE_FILE_RE.test(lower)) {
        setError('Please upload a supported template (.docx, .odt, .doc, .rtf, or .txt).')
        return
      }

      const api = window.letterComposer
      if (!api?.saveTemplateFromPath && !api?.saveTemplateBuffer) {
        setError('Template upload requires WR Desk (Electron).')
        return
      }

      setError(null)
      setBusy(true)
      try {
        const pathProp = (file as File & { path?: string }).path
        let savedPath: string
        if (pathProp && typeof pathProp === 'string' && api.saveTemplateFromPath) {
          savedPath = await api.saveTemplateFromPath(pathProp, file.name)
        } else if (api.saveTemplateBuffer) {
          const buf = await file.arrayBuffer()
          savedPath = await api.saveTemplateBuffer(file.name, buf)
        } else {
          throw new Error('No save method available')
        }

        const { html } = await api.convertDocxToHtml(savedPath)

        const template: LetterTemplate = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          sourceFileName: file.name,
          sourceFilePath: savedPath,
          renderedHtml: html,
          fields: [],
          versions: [],
          activeVersionIndex: -1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }

        addTemplate(template)
        setActiveTemplate(template.id)
      } catch (err) {
        console.error('[LetterTemplatePort] upload failed', err)
        setError(err instanceof Error ? err.message : 'Template processing failed')
      } finally {
        setBusy(false)
      }
    },
    [addTemplate, setActiveTemplate],
  )

  const handleFilesReceived = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (!file) return
      if (!file.name.match(TEMPLATE_FILE_RE)) {
        console.warn('[LetterTemplate] Unsupported format. Use .docx, .odt, .doc, .rtf, or .txt')
        return
      }
      void processTemplateFile(file)
    },
    [processTemplateFile],
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

  const handleDocumentInput = useCallback(() => {
    syncTemplateHtmlFromDom()
  }, [syncTemplateHtmlFromDom])

  const handleDocumentClick = useCallback(
    (e: MouseEvent) => {
      const el = documentRef.current
      if (!el || !activeTemplateId) return

      const block = (e.target as HTMLElement).closest(
        'p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote',
      )
      if (!block || !el.contains(block) || block === el) return

      const blockEl = block as HTMLElement

      el.querySelectorAll('.template-block-selected').forEach((n) => {
        n.classList.remove('template-block-selected')
      })
      blockEl.classList.add('template-block-selected')
      selectedBlockRef.current = blockEl

      const text = blockEl.textContent?.trim() ?? ''
      useDraftRefineStore.getState().connect(
        null,
        'Letter template',
        text,
        (refinedText) => {
          const target = selectedBlockRef.current
          if (target) {
            target.textContent = refinedText
            syncTemplateHtmlFromDom()
          }
        },
        'letter-template',
      )
    },
    [activeTemplateId, syncTemplateHtmlFromDom],
  )

  const handleClearTemplate = useCallback(() => {
    if (!activeTemplateId) return
    if (!window.confirm('Remove this template?')) return
    useDraftRefineStore.getState().disconnect()
    removeTemplate(activeTemplateId)
    setActiveTemplate(null)
    selectedBlockRef.current = null
    lastTemplateIdRef.current = null
  }, [activeTemplateId, removeTemplate, setActiveTemplate])

  const handleResetToOriginal = useCallback(async () => {
    if (!activeTemplateId || !activeTemplate) return
    const api = window.letterComposer
    if (!api?.convertDocxToHtml) return
    setError(null)
    try {
      const { html } = await api.convertDocxToHtml(activeTemplate.sourceFilePath)
      useLetterComposerStore.getState().updateTemplate(activeTemplateId, { renderedHtml: html })
      const el = documentRef.current
      if (el) {
        el.innerHTML = html
        el.querySelectorAll('.template-block-selected').forEach((n) => n.classList.remove('template-block-selected'))
      }
      selectedBlockRef.current = null
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset template')
    }
  }, [activeTemplateId, activeTemplate])

  const handleExportDocx = useCallback(async () => {
    const api = window.letterComposer
    if (!api?.exportFilledDocx || !activeTemplate) return
    if (!activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')) {
      setError('Export as DOCX is only available for Word (.docx) templates. Use Print for other formats.')
      return
    }
    syncTemplateHtmlFromDom()
    setError(null)
    try {
      const t = useLetterComposerStore.getState().templates.find((x) => x.id === activeTemplate.id)
      const r = await api.exportFilledDocx({
        sourcePath: activeTemplate.sourceFilePath,
        fields: (t?.fields ?? []).map((f) => ({
          id: f.id,
          placeholder: f.placeholder,
          value: f.value,
        })),
        defaultName: `${activeTemplate.name}-filled.docx`,
      })
      if (!r.success && !r.canceled) setError(r.error || 'Export failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }, [activeTemplate, syncTemplateHtmlFromDom])

  const handlePrint = useCallback(() => {
    if (!activeTemplate) return
    syncTemplateHtmlFromDom()
    const html =
      documentRef.current?.innerHTML ||
      useLetterComposerStore.getState().templates.find((t) => t.id === activeTemplate.id)?.renderedHtml ||
      ''
    if (!html.trim()) return
    const w = window.open('', '_blank')
    if (!w) {
      setError('Allow pop-ups to open the print window.')
      return
    }
    w.document.open()
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title></head><body>${html}</body></html>`,
    )
    w.document.close()
    w.focus()
    requestAnimationFrame(() => {
      try {
        w.print()
      } catch {
        /* noop */
      }
    })
  }, [activeTemplate, syncTemplateHtmlFromDom])

  const templateFileAccept =
    '.docx,.odt,.doc,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain,application/msword,application/rtf'

  return (
    <div
      className={`template-port letter-port${isDragOver ? ' letter-port--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="port-header">
        <h4>Template</h4>
        <PortSelectButton port="template" />
      </div>

      {templates.length > 0 && (
        <div className="template-picker">
          <label htmlFor="letter-template-active" className="template-picker__label">
            Active template
          </label>
          <select
            id="letter-template-active"
            className="template-picker__select"
            value={activeTemplateId ?? ''}
            onChange={(ev) => setActiveTemplate(ev.target.value ? ev.target.value : null)}
          >
            <option value="">— None —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="template-toolbar__file-hidden"
        accept={templateFileAccept}
        disabled={busy}
        onChange={(e) => {
          handleFilesReceived(Array.from(e.target.files || []))
          e.target.value = ''
        }}
        aria-hidden
        tabIndex={-1}
      />

      {!activeTemplate ? (
        <div className="letter-port__empty-drop-zone">
          <div className="letter-port__drop-icon" aria-hidden>
            {'\u{1F4C4}'}
          </div>
          <p className="letter-port__drop-text">Drag & drop a template here</p>
          <p className="letter-port__drop-subtext">.docx, .odt, .doc, .rtf, or .txt</p>
          <p className="letter-port__drop-subtext">or</p>
          <button
            type="button"
            className="letter-port__browse-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </button>
        </div>
      ) : (
        <div className="template-display">
          <div className="template-toolbar">
            <button
              type="button"
              className="template-toolbar__linkish"
              onClick={() => fileInputRef.current?.click()}
            >
              Add another template
            </button>
            <button type="button" className="template-toolbar__btn template-toolbar__btn--ghost" onClick={handleClearTemplate}>
              Clear
            </button>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--ghost"
              onClick={() => void handleResetToOriginal()}
            >
              Reset to original
            </button>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--ghost"
              onClick={() => void handleExportDocx()}
            >
              Export as DOCX
            </button>
            <button type="button" className="template-toolbar__btn template-toolbar__btn--primary" onClick={handlePrint}>
              Print
            </button>
          </div>

          <div
            ref={documentRef}
            className="template-document template-content__html"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline
            aria-label="Letter template document"
            onInput={handleDocumentInput}
            onClick={handleDocumentClick}
          />
        </div>
      )}

      {error && <p className="template-port__error">{error}</p>}
      {busy && <p className="template-port__status">Processing template…</p>}
      {rehydrating && !busy && (
        <p className="template-port__status">Loading preview from saved file…</p>
      )}
    </div>
  )
}
