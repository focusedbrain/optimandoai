import type { DragEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  useLetterComposerStore,
  type LetterTemplate,
  type TemplateField,
} from '../stores/useLetterComposerStore'
import { letterTemplateFilledHtml } from '../lib/letterTemplateMultiVersion'
import { PortSelectButton } from './LetterComposerPortSelectButton'

function isTemplateFieldShape(x: unknown): x is {
  id: string
  name?: string
  placeholder?: string
  type?: string
} {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string' && o.id.length > 0
}

function coerceFieldType(raw: unknown): TemplateField['type'] {
  const t = typeof raw === 'string' ? raw.toLowerCase().trim() : 'text'
  if (t === 'date' || t === 'multiline' || t === 'address' || t === 'text') return t
  return 'text'
}

export function LetterTemplatePort() {
  const templates = useLetterComposerStore((s) => s.templates)
  const activeTemplateId = useLetterComposerStore((s) => s.activeTemplateId)
  const setActiveTemplate = useLetterComposerStore((s) => s.setActiveTemplate)
  const addTemplate = useLetterComposerStore((s) => s.addTemplate)
  const updateTemplateField = useLetterComposerStore((s) => s.updateTemplateField)
  const setFocusedTemplateField = useLetterComposerStore((s) => s.setFocusedTemplateField)
  const setActiveTemplateVersionIndex = useLetterComposerStore((s) => s.setActiveTemplateVersionIndex)
  const activeTemplate = templates.find((t) => t.id === activeTemplateId)

  const versions = activeTemplate?.versions ?? []
  const versionIndex = activeTemplate?.activeVersionIndex ?? -1

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

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

  const processTemplateFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      if (!lower.endsWith('.docx') && !lower.endsWith('.odt')) {
        setError('Please upload a .docx or .odt template.')
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

        let extracted: unknown[] = []
        if (api.extractFields) {
          extracted = await api.extractFields(html)
        }

        const fields: TemplateField[] = (extracted || [])
          .filter(isTemplateFieldShape)
          .map((f) => ({
            id: f.id,
            name: typeof f.name === 'string' && f.name.trim() ? f.name.trim() : f.id,
            placeholder: typeof f.placeholder === 'string' ? f.placeholder : '',
            type: coerceFieldType(f.type),
            value: '',
            aiGenerated: false,
          }))

        const template: LetterTemplate = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ''),
          sourceFileName: file.name,
          sourceFilePath: savedPath,
          renderedHtml: html,
          fields,
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
      if (!file.name.match(/\.(docx|odt)$/i)) {
        console.warn('[LetterTemplate] Only .docx and .odt files are supported')
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

  const handleExportDocx = useCallback(async () => {
    const api = window.letterComposer
    if (!api?.exportFilledDocx || !activeTemplate) return
    setError(null)
    try {
      const r = await api.exportFilledDocx({
        sourcePath: activeTemplate.sourceFilePath,
        fields: activeTemplate.fields.map((f) => ({
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
  }, [activeTemplate])

  const handlePrint = useCallback(() => {
    if (!activeTemplate?.renderedHtml) return
    const html = letterTemplateFilledHtml(
      activeTemplate.renderedHtml,
      activeTemplate.fields.map((f) => ({
        id: f.id,
        placeholder: f.placeholder,
        value: f.value,
      })),
    )
    const w = window.open('', '_blank')
    if (!w) {
      setError('Allow pop-ups to open the print window.')
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    requestAnimationFrame(() => {
      try {
        w.print()
      } catch {
        /* noop */
      }
    })
  }, [activeTemplate])

  const goVersionPrev = useCallback(() => {
    if (!activeTemplate || versions.length === 0) return
    const cur = versionIndex < 0 ? 0 : versionIndex
    const next = cur <= 0 ? versions.length - 1 : cur - 1
    setActiveTemplateVersionIndex(activeTemplate.id, next)
  }, [activeTemplate, versions.length, versionIndex, setActiveTemplateVersionIndex])

  const goVersionNext = useCallback(() => {
    if (!activeTemplate || versions.length === 0) return
    const cur = versionIndex < 0 ? 0 : versionIndex
    const next = cur >= versions.length - 1 ? 0 : cur + 1
    setActiveTemplateVersionIndex(activeTemplate.id, next)
  }, [activeTemplate, versions.length, versionIndex, setActiveTemplateVersionIndex])

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

      {!activeTemplate ? (
        <div className="letter-port__empty-drop-zone">
          <div className="letter-port__drop-icon" aria-hidden>
            {'\u{1F4C4}'}
          </div>
          <p className="letter-port__drop-text">Drag & drop a .docx or .odt template here</p>
          <p className="letter-port__drop-subtext">or</p>
          <label className="letter-port__browse-btn">
            Browse files
            <input
              type="file"
              accept=".docx,.odt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"
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
          <p>Add another template (.docx or .odt)</p>
          <input
            id="letter-template-file"
            type="file"
            accept=".docx,.odt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"
            disabled={busy}
            onChange={(e) => {
              handleFilesReceived(Array.from(e.target.files || []))
              e.target.value = ''
            }}
          />
        </div>
      )}

      {error && <p className="template-port__error">{error}</p>}
      {busy && <p className="template-port__status">Processing template…</p>}
      {rehydrating && !busy && (
        <p className="template-port__status">Loading preview from saved file…</p>
      )}

      {activeTemplate && (
        <>
          {versions.length > 0 && (
            <div className="template-version-bar" role="group" aria-label="Template versions">
              <button type="button" className="template-version-bar__nav" onClick={goVersionPrev}>
                Prev
              </button>
              <div className="template-version-bar__dots">
                {versions.map((_, i) => {
                  const activeI = versionIndex >= 0 ? versionIndex : 0
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`template-version-dot${i === activeI ? ' template-version-dot--active' : ''}`}
                      aria-label={`Version ${i + 1}`}
                      aria-current={i === activeI ? 'step' : undefined}
                      onClick={() => setActiveTemplateVersionIndex(activeTemplate.id, i)}
                    />
                  )
                })}
              </div>
              <button type="button" className="template-version-bar__nav" onClick={goVersionNext}>
                Next
              </button>
              <span className="template-version-bar__hint">
                {(versionIndex >= 0 ? versionIndex : 0) + 1} / {versions.length}
              </span>
            </div>
          )}

          <div className="template-export-actions">
            <button type="button" className="template-export-actions__btn" onClick={() => void handleExportDocx()}>
              Export as DOCX
            </button>
            <button type="button" className="template-export-actions__btn" onClick={handlePrint}>
              Print
            </button>
          </div>

          <div
            className="template-html-preview template-content__html"
            dangerouslySetInnerHTML={{ __html: activeTemplate.renderedHtml }}
          />

          <div className="template-fields">
            <h5>Template Fields</h5>
            {activeTemplate.fields.length === 0 ? (
              <p className="template-fields__empty">No fields extracted (try a model with Ollama running).</p>
            ) : (
              activeTemplate.fields.map((field) => (
                <div key={field.id} className="template-field-row">
                  <label htmlFor={`field-${field.id}`}>{field.name}</label>
                  {field.type === 'multiline' ? (
                    <textarea
                      id={`field-${field.id}`}
                      value={field.value}
                      onFocus={() => setFocusedTemplateField(field.id)}
                      onChange={(ev) =>
                        updateTemplateField(activeTemplate.id, field.id, ev.target.value)
                      }
                      rows={4}
                    />
                  ) : (
                    <input
                      id={`field-${field.id}`}
                      type={field.type === 'date' ? 'date' : 'text'}
                      value={field.value}
                      onFocus={() => setFocusedTemplateField(field.id)}
                      onChange={(ev) =>
                        updateTemplateField(activeTemplate.id, field.id, ev.target.value)
                      }
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
