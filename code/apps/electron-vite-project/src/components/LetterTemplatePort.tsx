import type { DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createLetterComposeSession,
  useLetterComposerStore,
  type FieldType,
  type LetterTemplate,
  type TemplateField,
} from '../stores/useLetterComposerStore'
import { ComposeFieldsForm } from './ComposeFieldsForm'
import { FieldMappingOverlay } from './FieldMappingOverlay'
import { PortSelectButton } from './LetterComposerPortSelectButton'

const TEMPLATE_FILE_RE = /\.(docx|odt|doc|rtf|txt)$/i

function coerceFieldType(t: string): FieldType {
  return t === 'date' || t === 'multiline' || t === 'address' || t === 'richtext' ? t : 'text'
}

export function LetterTemplatePort() {
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)
  const setActiveTemplate = useLetterComposerStore((s) => s.setActiveTemplate)
  const addTemplate = useLetterComposerStore((s) => s.addTemplate)
  const removeTemplate = useLetterComposerStore((s) => s.removeTemplate)
  const addTemplateField = useLetterComposerStore((s) => s.addTemplateField)
  const removeTemplateField = useLetterComposerStore((s) => s.removeTemplateField)
  const patchTemplateField = useLetterComposerStore((s) => s.patchTemplateField)
  const setTemplateMappingComplete = useLetterComposerStore((s) => s.setTemplateMappingComplete)
  const letters = useLetterComposerStore((s) => s.letters)
  const activeLetterId = useLetterComposerStore((s) => s.activeLetterId)
  const composeSessions = useLetterComposerStore((s) => s.composeSessions)
  const activeComposeSessionId = useLetterComposerStore((s) => s.activeComposeSessionId)

  const activeTemplate = templates.find((t) => t.id === activeTemplateId)
  const replyToLetter = letters.find((l) => l.id === activeLetterId) ?? null

  const activeComposeSession = useMemo(() => {
    if (!activeTemplate) return null
    const byActive = composeSessions.find(
      (c) => c.id === activeComposeSessionId && c.templateId === activeTemplate.id,
    )
    if (byActive) return byActive
    return composeSessions.find((c) => c.templateId === activeTemplate.id) ?? null
  }, [composeSessions, activeComposeSessionId, activeTemplate?.id])

  const fileInputRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [libreOfficeNeeded, setLibreOfficeNeeded] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [suggestionFields, setSuggestionFields] = useState<TemplateField[]>([])
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    setCurrentPage(0)
  }, [activeTemplate?.id])

  useEffect(() => {
    setSuggestionFields([])
  }, [activeTemplateId, activeTemplate?.pdfPreviewPath])

  useEffect(() => {
    if (!activeTemplate?.mappingComplete) return
    const st = useLetterComposerStore.getState()
    let sess = st.composeSessions.find((c) => c.templateId === activeTemplate.id)
    if (!sess) {
      sess = createLetterComposeSession(activeTemplate.id)
      st.addComposeSession(sess)
    } else if (st.activeComposeSessionId !== sess.id) {
      st.setActiveComposeSession(sess.id)
    }
  }, [activeTemplate?.id, activeTemplate?.mappingComplete])

  useEffect(() => {
    const t = activeTemplate
    if (!t?.pdfPreviewPath || (t.pdfPageImages?.length ?? 0) > 0) {
      setRehydrating(false)
      return
    }
    const api = typeof window !== 'undefined' ? window.letterComposer : undefined
    if (!api?.renderPdfPages) {
      setRehydrating(false)
      return
    }
    let cancelled = false
    setRehydrating(true)
    void (async () => {
      try {
        const { pages, pageCount } = await api.renderPdfPages(t.pdfPreviewPath)
        if (!cancelled) {
          useLetterComposerStore.getState().updateTemplate(t.id, {
            pdfPageImages: pages,
            pageCount,
          })
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('[LetterTemplatePort] rehydrate PDF pages failed', e)
          setError(e instanceof Error ? e.message : 'Could not reload template preview')
        }
      } finally {
        if (!cancelled) setRehydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeTemplate?.id, activeTemplate?.pdfPreviewPath, activeTemplate?.pdfPageImages?.length])

  const handleCheckAgain = useCallback(async () => {
    setError(null)
    try {
      await window.libreoffice?.resetDetection?.()
      const det = await window.libreoffice?.detect()
      if (det?.available) {
        setLibreOfficeNeeded(false)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not detect LibreOffice')
    }
  }, [])

  const processTemplateFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (!TEMPLATE_FILE_RE.test(lower)) {
        setError('Please upload a supported template (.docx, .odt, .doc, .rtf, or .txt).')
        return
      }

      const api = window.letterComposer
      const lo = window.libreoffice
      if (!api?.saveTemplateFromPath && !api?.saveTemplateBuffer) {
        setError('Template upload requires WR Desk (Electron).')
        return
      }
      if (!lo?.detect || !lo?.convertToPdf) {
        setError('LibreOffice bridge is not available.')
        return
      }

      setError(null)
      setBusy(true)
      try {
        await lo.resetDetection?.()
        const det = await lo.detect()
        if (!det.available) {
          setLibreOfficeNeeded(true)
          return
        }
        setLibreOfficeNeeded(false)

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

        if (!api.getConvertedPdfOutputDir) {
          throw new Error('Letter Composer IPC is outdated (getConvertedPdfOutputDir missing).')
        }
        const outputDir = await api.getConvertedPdfOutputDir()
        const conv = await lo.convertToPdf(savedPath, outputDir)
        if (!conv.ok) {
          throw new Error(conv.error || 'Could not convert document to PDF')
        }

        if (!api.renderPdfPages) {
          throw new Error('Letter Composer IPC is outdated (renderPdfPages missing).')
        }
        const { pages, pageCount } = await api.renderPdfPages(conv.pdfPath)

        const template: LetterTemplate = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          sourceFileName: file.name,
          sourceFilePath: savedPath,
          pdfPreviewPath: conv.pdfPath,
          pdfPageImages: pages,
          pageCount,
          fields: [],
          mappingComplete: false,
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

  const handleClearTemplate = useCallback(() => {
    if (!activeTemplateId) return
    if (!window.confirm('Remove this template?')) return
    removeTemplate(activeTemplateId)
    setActiveTemplate(null)
  }, [activeTemplateId, removeTemplate, setActiveTemplate])

  const handleResetToOriginal = useCallback(async () => {
    if (!activeTemplateId || !activeTemplate) return
    const api = window.letterComposer
    const lo = window.libreoffice
    if (!api?.getConvertedPdfOutputDir || !api?.renderPdfPages || !lo?.convertToPdf) return
    setError(null)
    setBusy(true)
    try {
      await lo.resetDetection?.()
      const det = await lo.detect()
      if (!det.available) {
        setLibreOfficeNeeded(true)
        return
      }
      setLibreOfficeNeeded(false)
      const outputDir = await api.getConvertedPdfOutputDir()
      const conv = await lo.convertToPdf(activeTemplate.sourceFilePath, outputDir)
      if (!conv.ok) {
        throw new Error(conv.error || 'Could not convert document to PDF')
      }
      const { pages, pageCount } = await api.renderPdfPages(conv.pdfPath)
      useLetterComposerStore.getState().updateTemplate(activeTemplateId, {
        pdfPreviewPath: conv.pdfPath,
        pdfPageImages: pages,
        pageCount,
        fields: [],
        mappingComplete: false,
      })
      setCurrentPage(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset template')
    } finally {
      setBusy(false)
    }
  }, [activeTemplateId, activeTemplate])

  const buildExportFieldsPayload = useCallback(() => {
    const t = useLetterComposerStore.getState().templates.find((x) => x.id === activeTemplate?.id)
    return (t?.fields ?? []).map((f) => ({
      id: f.id,
      placeholder: f.defaultValue || `{{${f.id}}}`,
      anchorText: f.anchorText ?? '',
      value: f.value ?? '',
    }))
  }, [activeTemplate?.id])

  const handleExportDocx = useCallback(async () => {
    const api = window.letterComposer
    if (!api?.exportFilledDocx || !activeTemplate) return
    if (!activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')) {
      setError('Export as DOCX is only available for Word (.docx) templates. Use Print for other formats.')
      return
    }
    setError(null)
    try {
      const r = await api.exportFilledDocx({
        sourcePath: activeTemplate.sourceFilePath,
        fields: buildExportFieldsPayload(),
        defaultName: `${activeTemplate.name}-filled.docx`,
      })
      if (!r.success && !r.canceled) setError(r.error || 'Export failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }, [activeTemplate, buildExportFieldsPayload])

  const handleExportPdf = useCallback(async () => {
    const api = window.letterComposer
    if (!api?.exportFilledPdf || !activeTemplate) return
    if (!activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')) {
      setError('Export as PDF needs a Word (.docx) template (filled via export pipeline).')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const r = await api.exportFilledPdf({
        sourcePath: activeTemplate.sourceFilePath,
        fields: buildExportFieldsPayload(),
        defaultName: `${activeTemplate.name}-filled.pdf`,
      })
      if (!r.success && !r.canceled) setError(r.error || 'PDF export failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF export failed')
    } finally {
      setBusy(false)
    }
  }, [activeTemplate, buildExportFieldsPayload])

  const handlePrint = useCallback(async () => {
    if (!activeTemplate) return
    const api = window.letterComposer
    const isDocx = activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')
    if (activeTemplate.mappingComplete && isDocx && api?.printFilledLetter) {
      setError(null)
      setBusy(true)
      try {
        const r = await api.printFilledLetter({
          sourcePath: activeTemplate.sourceFilePath,
          fields: buildExportFieldsPayload(),
        })
        if (!r.success) setError(r.error || 'Could not start print')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start print')
      } finally {
        setBusy(false)
      }
      return
    }

    const imgs =
      activeTemplate.pdfPageImages?.length > 0
        ? activeTemplate.pdfPageImages
        : useLetterComposerStore.getState().templates.find((t) => t.id === activeTemplate.id)?.pdfPageImages ?? []
    if (!imgs.length) {
      setError('Nothing to print yet — wait for the preview to finish loading.')
      return
    }
    const body = imgs
      .map(
        (src) =>
          `<div style="page-break-after:always;margin:0;padding:0"><img src="${src}" style="width:100%;display:block" alt=""/></div>`,
      )
      .join('')
    const w = window.open('', '_blank')
    if (!w) {
      setError('Allow pop-ups to open the print window.')
      return
    }
    w.document.open()
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print</title></head><body style="margin:0">${body}</body></html>`,
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
  }, [activeTemplate, buildExportFieldsPayload])

  const onMappingFieldAdded = useCallback(
    (partial: Omit<TemplateField, 'id' | 'value' | 'defaultValue'>) => {
      if (!activeTemplateId) return
      const field: TemplateField = {
        ...partial,
        id: crypto.randomUUID(),
        value: '',
        defaultValue: '',
      }
      addTemplateField(activeTemplateId, field)
    },
    [activeTemplateId, addTemplateField],
  )

  const onMappingFieldRemoved = useCallback(
    (fieldId: string) => {
      if (!activeTemplateId) return
      removeTemplateField(activeTemplateId, fieldId)
    },
    [activeTemplateId, removeTemplateField],
  )

  const onMappingFieldUpdated = useCallback(
    (fieldId: string, patch: Partial<TemplateField>) => {
      if (!activeTemplateId) return
      patchTemplateField(activeTemplateId, fieldId, patch)
    },
    [activeTemplateId, patchTemplateField],
  )

  const handleAutoDetect = useCallback(async () => {
    if (!activeTemplate?.pdfPreviewPath) return
    const api = window.letterComposer
    if (!api?.detectTemplateFields) {
      setError('Field auto-detection requires WR Desk (Electron) with an up-to-date Letter Composer bridge.')
      return
    }
    setError(null)
    setDetecting(true)
    try {
      const r = await api.detectTemplateFields(activeTemplate.pdfPreviewPath)
      if (!r.ok) {
        setSuggestionFields([])
        if (r.error) setError(r.error)
        return
      }
      const rows = r.fields ?? []
      if (rows.length === 0 && r.error) {
        setSuggestionFields([])
        setError(r.error)
        return
      }
      const mapped: TemplateField[] = rows.map((row) => ({
        id: crypto.randomUUID(),
        name: row.name?.trim() || 'field',
        label: row.label?.trim() || row.name?.trim() || 'Field',
        type: coerceFieldType(row.type),
        mode: row.mode === 'flow' ? 'flow' : 'fixed',
        page: Math.max(0, Math.floor(row.page)),
        x: row.x,
        y: row.y,
        w: row.w,
        h: row.h,
        value: '',
        defaultValue: '',
        anchorText: '',
      }))
      setSuggestionFields(mapped)
    } catch (e) {
      console.warn('[LetterTemplatePort] auto-detect fields failed', e)
      setSuggestionFields([])
      setError(e instanceof Error ? e.message : 'Could not auto-detect fields')
    } finally {
      setDetecting(false)
    }
  }, [activeTemplate])

  const onSuggestionConfirm = useCallback(
    (fieldId: string) => {
      if (!activeTemplateId) return
      setSuggestionFields((prev) => {
        const s = prev.find((f) => f.id === fieldId)
        if (!s) return prev
        const field: TemplateField = { ...s, id: crypto.randomUUID() }
        addTemplateField(activeTemplateId, field)
        return prev.filter((f) => f.id !== fieldId)
      })
    },
    [activeTemplateId, addTemplateField],
  )

  const onSuggestionRemoved = useCallback((fieldId: string) => {
    setSuggestionFields((prev) => prev.filter((f) => f.id !== fieldId))
  }, [])

  const onSuggestionUpdated = useCallback((fieldId: string, patch: Partial<TemplateField>) => {
    setSuggestionFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)))
  }, [])

  const handleFinishMapping = useCallback(() => {
    if (!activeTemplateId || !activeTemplate) return
    if (activeTemplate.fields.length === 0) return
    setSuggestionFields([])
    setTemplateMappingComplete(activeTemplateId, true)
  }, [activeTemplateId, activeTemplate, setTemplateMappingComplete])

  const templateFileAccept =
    '.docx,.odt,.doc,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain,application/msword,application/rtf'

  const previewImages = activeTemplate?.pdfPageImages ?? []
  const safePage = Math.min(currentPage, Math.max(0, previewImages.length - 1))
  const pageCount = activeTemplate?.pageCount ?? previewImages.length

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

      {libreOfficeNeeded && (
        <div className="template-libreoffice-prompt">
          <h4>LibreOffice Required</h4>
          <p>
            Letter Composer uses LibreOffice to render your corporate templates with perfect layout fidelity.
          </p>
          <p>It&apos;s free, open source, and trusted by millions of businesses.</p>
          <a href="https://www.libreoffice.org/download/" target="_blank" rel="noopener noreferrer">
            Download LibreOffice →
          </a>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="template-toolbar__btn template-toolbar__btn--ghost" onClick={() => void handleCheckAgain()}>
              Check again
            </button>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--ghost"
              onClick={() => setLibreOfficeNeeded(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!activeTemplate && !libreOfficeNeeded ? (
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
      ) : null}

      {activeTemplate ? (
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

          {activeTemplate && !activeTemplate.mappingComplete && previewImages.length > 0 ? (
            <div className="template-mapping-view">
              <div className="template-mapping-header">
                <div className="template-mapping-header__row">
                  <h4>Map your template fields</h4>
                  <button
                    type="button"
                    className="template-mapping-auto-detect"
                    onClick={() => void handleAutoDetect()}
                    disabled={
                      detecting ||
                      busy ||
                      rehydrating ||
                      !activeTemplate.pdfPreviewPath ||
                      !window.letterComposer?.detectTemplateFields
                    }
                  >
                    {detecting ? 'Detecting…' : '🔍 Auto-detect fields'}
                  </button>
                </div>
                <p>Click and drag on the preview to mark editable zones, then name each field.</p>
              </div>
              {pageCount > 1 ? (
                <div className="template-page-nav">
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--ghost"
                    disabled={safePage <= 0}
                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  >
                    Previous page
                  </button>
                  <span className="template-page-nav__label">
                    Page {safePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--ghost"
                    disabled={safePage >= previewImages.length - 1}
                    onClick={() => setCurrentPage((p) => Math.min(previewImages.length - 1, p + 1))}
                  >
                    Next page
                  </button>
                </div>
              ) : null}
              <div className="template-page-preview template-page-preview--overlay">
                <FieldMappingOverlay
                  pageImage={previewImages[safePage]}
                  pageIndex={safePage}
                  fields={activeTemplate.fields}
                  suggestionFields={suggestionFields}
                  readOnly={false}
                  onFieldAdded={onMappingFieldAdded}
                  onFieldRemoved={onMappingFieldRemoved}
                  onFieldUpdated={onMappingFieldUpdated}
                  onSuggestionConfirm={onSuggestionConfirm}
                  onSuggestionRemoved={onSuggestionRemoved}
                  onSuggestionUpdated={onSuggestionUpdated}
                />
              </div>
              <button
                type="button"
                className="finish-mapping-btn"
                onClick={handleFinishMapping}
                disabled={activeTemplate.fields.length === 0}
              >
                Finish Mapping ({activeTemplate.fields.length} fields defined)
              </button>
            </div>
          ) : activeTemplate.mappingComplete && previewImages.length > 0 ? (
            <div className="template-compose-layout">
              <ComposeFieldsForm
                template={activeTemplate}
                composeSession={activeComposeSession}
                replyToLetter={replyToLetter}
              />
              {activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx') ? (
                <div className="compose-export-actions">
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--ghost"
                    onClick={() => void handleExportDocx()}
                  >
                    Export as DOCX
                  </button>
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--ghost"
                    disabled={busy}
                    onClick={() => void handleExportPdf()}
                  >
                    Export as PDF
                  </button>
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--primary"
                    disabled={busy}
                    onClick={() => void handlePrint()}
                  >
                    Print
                  </button>
                </div>
              ) : null}
              <details className="template-compose-preview-details">
                <summary className="template-compose-preview-summary">Template preview (read-only)</summary>
                <div className="template-mapping-view template-mapping-view--done template-mapping-view--embedded">
                  {pageCount > 1 ? (
                    <div className="template-page-nav">
                      <button
                        type="button"
                        className="template-toolbar__btn template-toolbar__btn--ghost"
                        disabled={safePage <= 0}
                        onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                      >
                        Previous page
                      </button>
                      <span className="template-page-nav__label">
                        Page {safePage + 1} / {pageCount}
                      </span>
                      <button
                        type="button"
                        className="template-toolbar__btn template-toolbar__btn--ghost"
                        disabled={safePage >= previewImages.length - 1}
                        onClick={() => setCurrentPage((p) => Math.min(previewImages.length - 1, p + 1))}
                      >
                        Next page
                      </button>
                    </div>
                  ) : null}
                  <div className="template-page-preview template-page-preview--overlay">
                    <FieldMappingOverlay
                      pageImage={previewImages[safePage]}
                      pageIndex={safePage}
                      fields={activeTemplate.fields}
                      readOnly
                      onFieldAdded={() => {}}
                      onFieldRemoved={() => {}}
                      onFieldUpdated={() => {}}
                    />
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <p className="template-port__status">Generating PDF preview…</p>
          )}
        </div>
      ) : null}

      {error && <p className="template-port__error">{error}</p>}
      {busy && <p className="template-port__status">Processing template…</p>}
      {rehydrating && !busy && (
        <p className="template-port__status">Loading preview from saved file…</p>
      )}
    </div>
  )
}
