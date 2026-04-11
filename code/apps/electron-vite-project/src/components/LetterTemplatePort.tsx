import type { DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createLetterComposeSession,
  useLetterComposerStore,
  type FieldMode,
  type FieldType,
  type LetterTemplate,
  type TemplateField,
} from '../stores/useLetterComposerStore'
import { ComposeFieldsForm } from './ComposeFieldsForm'
import { PortSelectButton } from './LetterComposerPortSelectButton'

const TEMPLATE_FILE_RE = /\.(docx|odt|doc|rtf|txt)$/i

function inferFieldType(name: string): FieldType {
  const n = name.toLowerCase()
  if (n.includes('date')) return 'date'
  if (n.includes('address')) return 'address'
  if (n.includes('body')) return 'richtext'
  if (n.includes('closing') || n.includes('salutation')) return 'multiline'
  return 'text'
}

function inferFieldMode(name: string): FieldMode {
  const n = name.toLowerCase()
  if (n.includes('body') || n.includes('subject') || n.includes('salutation') || n.includes('closing')) {
    return 'flow'
  }
  return 'fixed'
}

function placeholderFieldLabel(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function LetterTemplatePort() {
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)
  const setActiveTemplate = useLetterComposerStore((s) => s.setActiveTemplate)
  const addTemplate = useLetterComposerStore((s) => s.addTemplate)
  const removeTemplate = useLetterComposerStore((s) => s.removeTemplate)
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
  /** When LibreOffice is missing, hold the template file so Browse / Check again can retry upload. */
  const pendingTemplateFileRef = useRef<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [libreOfficeNeeded, setLibreOfficeNeeded] = useState(false)
  const [scanning, setScanning] = useState(false)

  const activeTemplateRef = useRef(activeTemplate)
  activeTemplateRef.current = activeTemplate

  const mergeScanFromDisk = useCallback(async (templateId: string, sourcePath: string) => {
    const api = window.letterComposer
    if (!api?.scanPlaceholders) return
    setScanning(true)
    try {
      const result = await api.scanPlaceholders(sourcePath)
      if (!result.ok) {
        setError(result.error ?? 'Could not scan placeholders')
        return
      }
      setError(null)
      const st = useLetterComposerStore.getState()
      const prev = st.templates.find((x) => x.id === templateId)?.fields ?? []
      const prevByName = new Map(prev.map((f) => [f.name, f]))
      const fields: TemplateField[] = result.fields.map((f) => {
        const old = prevByName.get(f.name)
        return {
          id: old?.id ?? crypto.randomUUID(),
          name: f.name,
          label: placeholderFieldLabel(f.name),
          type: inferFieldType(f.name),
          mode: inferFieldMode(f.name),
          page: 0,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          value: old?.value ?? '',
          defaultValue: old?.defaultValue ?? '',
          anchorText: f.placeholder,
          placeholder: f.placeholder,
        }
      })
      st.updateTemplate(templateId, { fields })
    } finally {
      setScanning(false)
    }
  }, [])

  const reconvertPreview = useCallback(async (t: LetterTemplate) => {
    const api = window.letterComposer
    const lo = window.libreoffice
    if (!api?.getConvertedPdfOutputDir || !api?.renderPdfPages || !lo?.convertToPdf) {
      throw new Error('LibreOffice or Letter Composer bridge unavailable')
    }
    await lo.resetDetection?.()
    const det = await lo.detect()
    if (!det.available) {
      throw new Error('LibreOffice not available')
    }
    const outputDir = await api.getConvertedPdfOutputDir()
    const conv = await lo.convertToPdf(t.sourceFilePath, outputDir)
    if (!conv.ok) {
      throw new Error(conv.error || 'Could not convert document to PDF')
    }
    const { pages, pageCount } = await api.renderPdfPages(conv.pdfPath)
    useLetterComposerStore.getState().updateTemplate(t.id, {
      pdfPreviewPath: conv.pdfPath,
      pdfPageImages: pages,
      pageCount,
    })
  }, [])

  useEffect(() => {
    const id = activeTemplateId
    return () => {
      if (id) void window.letterComposer?.unwatchTemplateFile?.(id)
    }
  }, [activeTemplateId])

  useEffect(() => {
    const t = activeTemplate
    const api = window.letterComposer
    if (!t || t.mappingComplete || !api?.onTemplateFileChanged) return

    const unsub = api.onTemplateFileChanged((data) => {
      if (data.templateId !== t.id) return
      void (async () => {
        const cur = activeTemplateRef.current
        if (!cur || cur.id !== t.id || cur.mappingComplete) return
        setBusy(true)
        setError(null)
        try {
          await reconvertPreview(cur)
          await mergeScanFromDisk(cur.id, cur.sourceFilePath)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Template refresh failed')
        } finally {
          setBusy(false)
        }
      })()
    })

    return () => {
      unsub()
    }
  }, [activeTemplate?.id, activeTemplate?.mappingComplete, reconvertPreview, mergeScanFromDisk])

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
          pendingTemplateFileRef.current = file
          setLibreOfficeNeeded(true)
          return
        }
        setLibreOfficeNeeded(false)
        pendingTemplateFileRef.current = null

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
        pendingTemplateFileRef.current = null
        await mergeScanFromDisk(template.id, savedPath)
      } catch (err) {
        console.error('[LetterTemplatePort] upload failed', err)
        setError(err instanceof Error ? err.message : 'Template processing failed')
      } finally {
        setBusy(false)
      }
    },
    [addTemplate, setActiveTemplate, mergeScanFromDisk],
  )

  const handleCheckAgain = useCallback(async () => {
    setError(null)
    try {
      await window.libreoffice?.resetDetection?.()
      const det = await window.libreoffice?.detect()
      if (det?.available) {
        setLibreOfficeNeeded(false)
        const pf = pendingTemplateFileRef.current
        if (pf) {
          pendingTemplateFileRef.current = null
          void processTemplateFile(pf)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not detect LibreOffice')
    }
  }, [processTemplateFile])

  const handleBrowseForSoffice = useCallback(async () => {
    setError(null)
    try {
      const result = await window.libreoffice?.browseForSoffice?.()
      if (result?.ok) {
        setLibreOfficeNeeded(false)
        const pf = pendingTemplateFileRef.current
        if (pf) {
          pendingTemplateFileRef.current = null
          void processTemplateFile(pf)
        }
      } else if (result && 'error' in result && result.error) {
        setError(result.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set LibreOffice path')
    }
  }, [processTemplateFile])

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
      await mergeScanFromDisk(activeTemplateId, activeTemplate.sourceFilePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset template')
    } finally {
      setBusy(false)
    }
  }, [activeTemplateId, activeTemplate, mergeScanFromDisk])

  const buildExportFieldsPayload = useCallback(() => {
    const t = useLetterComposerStore.getState().templates.find((x) => x.id === activeTemplate?.id)
    return (t?.fields ?? []).map((f) => {
      const token =
        (f.anchorText && f.anchorText.trim()) ||
        (f.placeholder && f.placeholder.trim()) ||
        `{{${f.name}}}`
      return {
        id: f.id,
        placeholder: token,
        anchorText: token,
        value: f.value ?? '',
      }
    })
  }, [activeTemplate?.id])

  const handleEditInLibreOffice = useCallback(async () => {
    if (!activeTemplate) return
    const api = window.letterComposer
    if (!api?.openInLibreOffice || !api.watchTemplateFile) {
      setError('Edit in LibreOffice requires an up-to-date WR Desk build.')
      return
    }
    setError(null)
    const r = await api.openInLibreOffice(activeTemplate.sourceFilePath)
    if (!r.ok) {
      setError(r.error === 'LIBREOFFICE_NOT_FOUND' ? 'LibreOffice not found.' : r.error)
      return
    }
    await api.watchTemplateFile(activeTemplate.sourceFilePath, activeTemplate.id)
  }, [activeTemplate])

  const handleRescanPlaceholders = useCallback(async () => {
    if (!activeTemplate) return
    setError(null)
    try {
      await mergeScanFromDisk(activeTemplate.id, activeTemplate.sourceFilePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    }
  }, [activeTemplate, mergeScanFromDisk])

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

  const handleFinishSetup = useCallback(() => {
    if (!activeTemplateId || !activeTemplate) return
    if (activeTemplate.fields.length === 0) return
    void window.letterComposer?.unwatchTemplateFile?.(activeTemplateId)
    setTemplateMappingComplete(activeTemplateId, true)
  }, [activeTemplateId, activeTemplate, setTemplateMappingComplete])

  const templateFileAccept =
    '.docx,.odt,.doc,.rtf,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,text/plain,application/msword,application/rtf'

  const previewImages = activeTemplate?.pdfPageImages ?? []

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
          <p>
            If LibreOffice is already installed but was not detected, point WR Desk at <code>soffice.exe</code> or
            check again after fixing your install.
          </p>
          <p>It&apos;s free, open source, and trusted by millions of businesses.</p>
          <button
            type="button"
            className="template-libreoffice-prompt__download-link"
            style={{
              display: 'inline',
              margin: 0,
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 13,
              color: '#4f46e5',
              fontWeight: 500,
              textDecoration: 'underline',
              textAlign: 'left',
            }}
            onClick={() => {
              void window.appShell?.openExternal('https://www.libreoffice.org/download/')
            }}
          >
            Download LibreOffice →
          </button>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--ghost"
              onClick={() => void handleBrowseForSoffice()}
            >
              Browse for soffice.exe
            </button>
            <button type="button" className="template-toolbar__btn template-toolbar__btn--ghost" onClick={() => void handleCheckAgain()}>
              Check again
            </button>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--ghost"
              onClick={() => {
                pendingTemplateFileRef.current = null
                setLibreOfficeNeeded(false)
              }}
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

            <div className="template-mapping-view template-setup">
              <div className="template-mapping-header">
                <div className="template-mapping-header__row">
                  <h4>Prepare your template</h4>
                  <button
                    type="button"
                    className="template-toolbar__btn template-toolbar__btn--ghost"
                    onClick={() => void handleEditInLibreOffice()}
                    disabled={busy || rehydrating}
                  >
                    {'\u270F\uFE0F Edit in LibreOffice'}
                  </button>
                  <button
                    type="button"
                    className="template-mapping-auto-detect"
                    onClick={() => void handleRescanPlaceholders()}
                    disabled={busy || rehydrating || scanning}
                  >
                    {scanning ? 'Scanning…' : '\u{1F50D} Scan for placeholders'}
                  </button>
                </div>
                <p>
                  Add <code>{'{{field_name}}'}</code> tokens in LibreOffice, save, then scan — or rely on auto-refresh
                  after you save.
                </p>
              </div>
              <div className="template-preview" style={{ flex: 1, overflowY: 'auto', maxHeight: '50vh' }}>
                {previewImages.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`Page ${i + 1}`}
                    style={{ width: '100%', marginBottom: 8, display: 'block' }}
                  />
                ))}
              </div>
              <div className="template-instructions" style={{ marginTop: 12, fontSize: 13 }}>
                <h4 style={{ margin: '8px 0' }}>How to prepare your template</h4>
                <ol style={{ margin: '0 0 8px 1.1em', padding: 0 }}>
                  <li>
                    Click <strong>Edit in LibreOffice</strong> to open your file.
                  </li>
                  <li>
                    Replace dynamic text with placeholders, e.g. <code>{'{{recipient_name}}'}</code>,{' '}
                    <code>{'{{date}}'}</code>, <code>{'{{subject}}'}</code>, <code>{'{{body}}'}</code>.
                  </li>
                  <li>Save in LibreOffice — the preview and field list refresh automatically.</li>
                  <li>
                    Use <strong>Scan for placeholders</strong> if you need to refresh manually.
                  </li>
                </ol>
                <details style={{ marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Common placeholders</summary>
                  <pre
                    style={{
                      margin: '8px 0 0',
                      padding: 8,
                      background: 'var(--letter-instructions-bg, #f4f4f2)',
                      borderRadius: 6,
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {`{{sender_name}}           Your name / company
{{sender_address}}        Your address
{{recipient_name}}        Recipient name
{{recipient_address}}     Recipient address
{{date}}                  Letter date
{{subject}}               Subject line
{{reference}}             Reference number
{{salutation}}            Opening line
{{body}}                  Main text
{{closing}}               Closing line
{{signer_name}}           Signer name

Custom: {{your_field}} also works.`}
                  </pre>
                </details>
              </div>
              {activeTemplate.fields.length > 0 ? (
                <div className="template-detected-fields" style={{ marginTop: 12 }}>
                  <h4 style={{ margin: '8px 0' }}>Detected fields ({activeTemplate.fields.length})</h4>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {activeTemplate.fields.map((f) => (
                      <li
                        key={f.id}
                        className="detected-field-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '4px 0',
                          borderBottom: '1px solid var(--letter-border, #e8e8e6)',
                        }}
                      >
                        <code style={{ flex: '0 0 auto' }}>{f.placeholder ?? f.anchorText}</code>
                        <span style={{ flex: 1 }}>{f.label}</span>
                        <span aria-hidden>{'\u2705'}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="finish-mapping-btn"
                    onClick={handleFinishSetup}
                    disabled={activeTemplate.fields.length === 0}
                    style={{ marginTop: 12 }}
                  >
                    Finish Setup ({activeTemplate.fields.length} fields ready)
                  </button>
                </div>
              ) : (
                <p className="no-fields-hint" style={{ marginTop: 12, fontSize: 13 }}>
                  No <code>{'{{...}}'}</code> placeholders found yet. Edit the template in LibreOffice, save, then scan.
                </p>
              )}
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
                  <div className="template-preview template-preview-readonly" style={{ overflowY: 'auto', maxHeight: 360 }}>
                    {previewImages.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Page ${i + 1}`}
                        style={{ width: '100%', marginBottom: 8, display: 'block' }}
                      />
                    ))}
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
