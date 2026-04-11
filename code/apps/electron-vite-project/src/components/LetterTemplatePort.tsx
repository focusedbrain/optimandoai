import type { ChangeEvent, DragEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILTIN_TEMPLATES,
  createLetterComposeSession,
  useLetterComposerStore,
  type BuiltinLayout,
  type BuiltinTemplate,
  type FieldType,
  type LetterTemplate,
  type TemplateField,
} from '../stores/useLetterComposerStore'
import { ComposeFieldsForm } from './ComposeFieldsForm'
import { FieldMappingOverlay } from './FieldMappingOverlay'
import { PortSelectButton } from './LetterComposerPortSelectButton'

const TEMPLATE_FILE_RE = /\.(docx|odt|doc|rtf|txt)$/i
const CUSTOM_TEMPLATE_ACCEPT =
  '.docx,.odt,.doc,.rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text,application/msword,application/rtf'

const BODY_LINE_WIDTHS = [55, 62, 58, 64, 60]

function TemplatePreviewThumb({ layout }: { layout: BuiltinLayout | string }) {
  const l = layout as BuiltinLayout
  if (l === 'din5008b') {
    return (
      <svg viewBox="0 0 80 110" width="100%" height="100%" aria-hidden>
        <rect x="0" y="0" width="80" height="110" fill="#fff" stroke="#eee" />
        <rect x="5" y="4" width="25" height="8" rx="1" fill="#ddd" />
        <rect x="45" y="4" width="30" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="45" y="9" width="28" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="38" width="35" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="5" y="43" width="30" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="5" y="48" width="32" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="55" y="58" width="20" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="65" width="50" height="3" rx="0.5" fill="#6366f1" opacity={0.3} />
        {[60, 65, 70, 75, 80].map((y, i) => (
          <rect key={y} x="5" y={y + 12} width={BODY_LINE_WIDTHS[i] ?? 55} height="2" rx="0.5" fill="#e8e8e8" />
        ))}
        <rect x="5" y="98" width="35" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="104" width="25" height="3" rx="0.5" fill="#e8e8e8" />
      </svg>
    )
  }
  if (l === 'classic') {
    return (
      <svg viewBox="0 0 80 110" width="100%" height="100%" aria-hidden>
        <rect x="0" y="0" width="80" height="110" fill="#fff" stroke="#eee" />
        <rect x="22" y="6" width="36" height="6" rx="1" fill="#ddd" />
        <rect x="18" y="16" width="44" height="2" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="28" width="35" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="5" y="33" width="30" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="5" y="38" width="32" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="55" y="48" width="20" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="55" width="50" height="3" rx="0.5" fill="#6366f1" opacity={0.3} />
        {[60, 65, 70, 75, 80].map((y, i) => (
          <rect key={y} x="5" y={y + 2} width={BODY_LINE_WIDTHS[i] ?? 55} height="2" rx="0.5" fill="#e8e8e8" />
        ))}
        <rect x="5" y="92" width="35" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="98" width="25" height="3" rx="0.5" fill="#e8e8e8" />
      </svg>
    )
  }
  if (l === 'modern') {
    return (
      <svg viewBox="0 0 80 110" width="100%" height="100%" aria-hidden>
        <rect x="0" y="0" width="80" height="110" fill="#fff" stroke="#eee" />
        <rect x="5" y="6" width="14" height="40" rx="1" fill="#e8e8e8" />
        <rect x="5" y="10" width="12" height="2" rx="0.5" fill="#d1d5db" />
        <rect x="5" y="14" width="11" height="2" rx="0.5" fill="#d1d5db" />
        <rect x="5" y="18" width="10" height="2" rx="0.5" fill="#d1d5db" />
        <rect x="24" y="6" width="20" height="8" rx="1" fill="#ddd" />
        <rect x="24" y="22" width="35" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="24" y="27" width="30" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="24" y="32" width="32" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="52" y="42" width="23" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="24" y="49" width="48" height="3" rx="0.5" fill="#6366f1" opacity={0.3} />
        {[58, 63, 68, 73, 78].map((y, i) => (
          <rect key={y} x="24" y={y} width={BODY_LINE_WIDTHS[i] ?? 55} height="2" rx="0.5" fill="#e8e8e8" />
        ))}
        <rect x="24" y="92" width="35" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="24" y="98" width="25" height="3" rx="0.5" fill="#e8e8e8" />
      </svg>
    )
  }
  if (l === 'minimal') {
    return (
      <svg viewBox="0 0 80 110" width="100%" height="100%" aria-hidden>
        <rect x="0" y="0" width="80" height="110" fill="#fff" stroke="#eee" />
        <rect x="5" y="8" width="18" height="4" rx="0.5" fill="#e5e7eb" />
        <rect x="5" y="22" width="40" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="5" y="27" width="34" height="3" rx="0.5" fill="#c7d2fe" />
        <rect x="52" y="36" width="23" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="44" width="55" height="3" rx="0.5" fill="#6366f1" opacity={0.25} />
        {[52, 57, 62, 67, 72].map((y, i) => (
          <rect key={y} x="5" y={y} width={BODY_LINE_WIDTHS[i] ?? 55} height="2" rx="0.5" fill="#e8e8e8" />
        ))}
        <rect x="5" y="88" width="30" height="3" rx="0.5" fill="#e8e8e8" />
        <rect x="5" y="94" width="22" height="3" rx="0.5" fill="#e8e8e8" />
      </svg>
    )
  }
  /* din5008a — default */
  return (
    <svg viewBox="0 0 80 110" width="100%" height="100%" aria-hidden>
      <rect x="0" y="0" width="80" height="110" fill="#fff" stroke="#eee" />
      <rect x="5" y="4" width="25" height="8" rx="1" fill="#ddd" />
      <rect x="45" y="4" width="30" height="3" rx="0.5" fill="#e8e8e8" />
      <rect x="45" y="9" width="28" height="3" rx="0.5" fill="#e8e8e8" />
      <rect x="5" y="25" width="35" height="3" rx="0.5" fill="#c7d2fe" />
      <rect x="5" y="30" width="30" height="3" rx="0.5" fill="#c7d2fe" />
      <rect x="5" y="35" width="32" height="3" rx="0.5" fill="#c7d2fe" />
      <rect x="55" y="45" width="20" height="3" rx="0.5" fill="#e8e8e8" />
      <rect x="5" y="52" width="50" height="3" rx="0.5" fill="#6366f1" opacity={0.3} />
      {[60, 65, 70, 75, 80].map((y, i) => (
        <rect key={y} x="5" y={y} width={BODY_LINE_WIDTHS[i] ?? 55} height="2" rx="0.5" fill="#e8e8e8" />
      ))}
      <rect x="5" y="92" width="35" height="3" rx="0.5" fill="#e8e8e8" />
      <rect x="5" y="98" width="25" height="3" rx="0.5" fill="#e8e8e8" />
    </svg>
  )
}

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
  const selectedBuiltinTemplate = useLetterComposerStore((s) => s.selectedBuiltinTemplate)
  const setSelectedBuiltinTemplate = useLetterComposerStore((s) => s.setSelectedBuiltinTemplate)
  const templateSetupStep = useLetterComposerStore((s) => s.templateSetupStep)
  const setTemplateSetupStep = useLetterComposerStore((s) => s.setTemplateSetupStep)
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
  const customTemplateFileInputRef = useRef<HTMLInputElement>(null)
  const pendingTemplateFileRef = useRef<File | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rehydrating, setRehydrating] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [libreOfficeNeeded, setLibreOfficeNeeded] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [suggestionFields, setSuggestionFields] = useState<TemplateField[]>([])
  const [detecting, setDetecting] = useState(false)
  const [pdfTextLayers, setPdfTextLayers] = useState<
    Array<{ page: number; items: Array<{ text: string; x: number; y: number; w: number; h: number }> }>
  >([])

  const [companyDetails, setCompanyDetails] = useState<Record<string, string>>({})
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const setupWizardInitRef = useRef<string | null>(null)

  useEffect(() => {
    const pdfPath = activeTemplate?.pdfPreviewPath
    const api = typeof window !== 'undefined' ? window.letterComposer : undefined
    if (!pdfPath || !api?.extractPdfTextPositions) {
      setPdfTextLayers([])
      return
    }
    let cancelled = false
    void api
      .extractPdfTextPositions(pdfPath)
      .then((pages) => {
        if (!cancelled) setPdfTextLayers(pages ?? [])
      })
      .catch((e) => {
        console.warn('[LetterTemplatePort] extractPdfTextPositions failed', e)
        if (!cancelled) setPdfTextLayers([])
      })
    return () => {
      cancelled = true
    }
  }, [activeTemplate?.pdfPreviewPath])

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
    const lang = sess.language
    if (typeof lang !== 'string' || !lang.trim()) {
      st.updateComposeSession(sess.id, { language: 'en' })
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
      } catch (err) {
        console.error('[LetterTemplatePort] upload failed', err)
        setError(err instanceof Error ? err.message : 'Template processing failed')
      } finally {
        setBusy(false)
      }
    },
    [addTemplate, setActiveTemplate],
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

  const handleSelectBuiltin = useCallback(
    (tmpl: BuiltinTemplate) => {
      setSelectedBuiltinTemplate(tmpl)
      setTemplateSetupStep('company-details')
    },
    [setSelectedBuiltinTemplate, setTemplateSetupStep],
  )

  const handleBackToTemplateChooser = useCallback(() => {
    setSelectedBuiltinTemplate(null)
    setTemplateSetupStep('chooser')
    setupWizardInitRef.current = null
  }, [setSelectedBuiltinTemplate, setTemplateSetupStep])

  useEffect(() => {
    if (templateSetupStep !== 'company-details' || !selectedBuiltinTemplate) {
      setupWizardInitRef.current = null
      return
    }
    const key = selectedBuiltinTemplate.id
    if (setupWizardInitRef.current === key) return
    setupWizardInitRef.current = key
    const p = useLetterComposerStore.getState().companyProfile
    setCompanyDetails({
      company_logo: p.logoPath ?? '',
      sender_name: p.sender_name ?? '',
      sender_address: p.sender_address ?? '',
      sender_phone: p.sender_phone ?? '',
      sender_email: p.sender_email ?? '',
      signer_name: p.signer_name ?? '',
    })
    setLogoPreview(p.logoPath)
  }, [templateSetupStep, selectedBuiltinTemplate])

  const handleLogoUpload = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const okMime = /^image\/(png|jpeg|jpg|svg\+xml)$/i.test(file.type)
    const okSvgName = file.name.toLowerCase().endsWith('.svg')
    if (!okMime && !okSvgName) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl) return
      setLogoPreview(dataUrl)
      setCompanyDetails((prev) => ({ ...prev, company_logo: dataUrl }))
    }
    reader.readAsDataURL(file)
  }, [])

  const handleRemoveLogo = useCallback(() => {
    setLogoPreview(null)
    setCompanyDetails((prev) => ({ ...prev, company_logo: '' }))
  }, [])

  const handleFinishBuiltinSetup = useCallback(() => {
    const selected = selectedBuiltinTemplate
    if (!selected) return
    const senderName = (companyDetails.sender_name || '').trim()
    if (!senderName) return

    const logoData = logoPreview?.trim() || companyDetails.company_logo?.trim() || null

    const fields: TemplateField[] = selected.fields.map((f) => {
      const anchorText = `{{${f.name}}}`
      let value: string
      if (f.staticField) {
        if (f.name === 'company_logo') {
          value = logoData ?? ''
        } else {
          value = (companyDetails[f.name] ?? '').trim() || (f.defaultValue ?? '')
        }
      } else {
        value = f.defaultValue ?? ''
      }
      return {
        id: crypto.randomUUID(),
        name: f.name,
        label: f.label,
        type: f.type,
        mode: f.mode,
        page: 0,
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        value,
        defaultValue: f.defaultValue ?? '',
        anchorText,
      }
    })

    const template: LetterTemplate = {
      id: `builtin-${selected.id}-${Date.now()}`,
      name: `${selected.name} — ${senderName}`,
      sourceFileName: '',
      sourceFilePath: '',
      pdfPreviewPath: '',
      pdfPageImages: [],
      pageCount: 1,
      fields,
      mappingComplete: true,
      builtinLayout: selected.layout,
      logoPath: logoData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const st = useLetterComposerStore.getState()
    st.setCompanyProfile({
      sender_name: companyDetails.sender_name ?? '',
      sender_address: companyDetails.sender_address ?? '',
      sender_phone: companyDetails.sender_phone ?? '',
      sender_email: companyDetails.sender_email ?? '',
      signer_name: companyDetails.signer_name ?? '',
      logoPath: logoData,
    })
    st.addTemplate(template)
    st.setActiveTemplate(template.id)
    setupWizardInitRef.current = null
    setCompanyDetails({})
    setLogoPreview(null)
  }, [selectedBuiltinTemplate, companyDetails, logoPreview])

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
    if (activeTemplate.builtinLayout) return
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
    return (t?.fields ?? []).map((f) => {
      const anchor =
        (f.anchorText && f.anchorText.trim()) ||
        (f.defaultValue && f.defaultValue.trim()) ||
        (f.placeholder && f.placeholder.trim()) ||
        ''
      const fallback = `{{${f.name}}}`
      const search = anchor || fallback
      return {
        id: f.id,
        placeholder: f.defaultValue?.trim() || search,
        anchorText: search,
        value: f.value ?? '',
      }
    })
  }, [activeTemplate?.id])

  const buildBuiltinFieldRecord = useCallback((): Record<string, string> => {
    const t = useLetterComposerStore.getState().templates.find((x) => x.id === activeTemplate?.id)
    const rec: Record<string, string> = {}
    for (const f of t?.fields ?? []) {
      rec[f.name] = typeof f.value === 'string' ? f.value : ''
    }
    return rec
  }, [activeTemplate?.id])

  const handleExportDocx = useCallback(async () => {
    const api = window.letterComposer
    if (!activeTemplate) return
    setError(null)
    try {
      if (activeTemplate.builtinLayout) {
        if (!api?.exportBuiltinDocx) {
          setError('Built-in DOCX export requires WR Desk (Electron) with an up-to-date Letter Composer bridge.')
          return
        }
        const r = await api.exportBuiltinDocx({
          layout: activeTemplate.builtinLayout,
          fields: buildBuiltinFieldRecord(),
          logoPath: activeTemplate.logoPath ?? null,
          defaultName: `${activeTemplate.name}.docx`,
        })
        if (!r.success && !r.canceled) setError(r.error || 'Export failed')
        return
      }
      if (!api?.exportFilledDocx) return
      if (!activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')) {
        setError('Export as DOCX is only available for Word (.docx) templates. Use Print for other formats.')
        return
      }
      const r = await api.exportFilledDocx({
        sourcePath: activeTemplate.sourceFilePath,
        fields: buildExportFieldsPayload(),
        defaultName: `${activeTemplate.name}-filled.docx`,
      })
      if (!r.success && !r.canceled) setError(r.error || 'Export failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    }
  }, [activeTemplate, buildExportFieldsPayload, buildBuiltinFieldRecord])

  const handleExportPdf = useCallback(async () => {
    const api = window.letterComposer
    if (!activeTemplate) return
    setError(null)
    setBusy(true)
    try {
      if (activeTemplate.builtinLayout) {
        if (!api?.exportBuiltinPdf) {
          setError('Built-in PDF export requires WR Desk (Electron) with an up-to-date Letter Composer bridge.')
          return
        }
        const r = await api.exportBuiltinPdf({
          layout: activeTemplate.builtinLayout,
          fields: buildBuiltinFieldRecord(),
          logoPath: activeTemplate.logoPath ?? null,
          defaultName: `${activeTemplate.name}.pdf`,
        })
        if (!r.success && !r.canceled) setError(r.error || 'PDF export failed')
        return
      }
      if (!api?.exportFilledPdf) return
      if (!activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx')) {
        setError('Export as PDF needs a Word (.docx) template (filled via export pipeline).')
        return
      }
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
  }, [activeTemplate, buildExportFieldsPayload, buildBuiltinFieldRecord])

  const handlePrint = useCallback(async () => {
    if (!activeTemplate) return
    const api = window.letterComposer
    if (activeTemplate.mappingComplete && activeTemplate.builtinLayout && api?.printBuiltinLetter) {
      setError(null)
      setBusy(true)
      try {
        const r = await api.printBuiltinLetter({
          layout: activeTemplate.builtinLayout,
          fields: buildBuiltinFieldRecord(),
          logoPath: activeTemplate.logoPath ?? null,
        })
        if (!r.success) setError(r.error || 'Could not start print')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start print')
      } finally {
        setBusy(false)
      }
      return
    }
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
  }, [activeTemplate, buildExportFieldsPayload, buildBuiltinFieldRecord])

  const onMappingFieldAdded = useCallback(
    (partial: Omit<TemplateField, 'id' | 'value'>) => {
      if (!activeTemplateId) return
      const field: TemplateField = {
        ...partial,
        id: crypto.randomUUID(),
        value: '',
        defaultValue: partial.defaultValue ?? '',
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
  const pageTextItemsForOverlay = pdfTextLayers.find((p) => p.page === safePage)?.items ?? []

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

      {!activeTemplate && !libreOfficeNeeded && templateSetupStep === 'company-details' && selectedBuiltinTemplate ? (
        <div className="template-setup-wizard">
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
            Set up: {selectedBuiltinTemplate.name}
          </h3>
          <p style={{ fontSize: 12, color: '#666', margin: '0 0 12px', lineHeight: 1.45 }}>
            Fill in your company details once. They&apos;ll be pre-filled on every letter.
          </p>

          <div className="setup-fields">
            {selectedBuiltinTemplate.fields
              .filter((f) => f.staticField)
              .map((f) => (
                <div key={f.name} className="setup-field">
                  <label className="setup-field__label" htmlFor={`setup-${f.name}`}>
                    {f.label}
                  </label>
                  {f.name === 'company_logo' ? (
                    <div className="logo-upload">
                      {logoPreview ? (
                        <div className="logo-preview">
                          <img src={logoPreview} alt="Logo" style={{ maxHeight: 60, maxWidth: 200 }} />
                          <button type="button" className="logo-remove-btn" onClick={handleRemoveLogo}>
                            × Remove
                          </button>
                        </div>
                      ) : (
                        <label className="logo-upload-btn">
                          {'\u{1F4CE}'} Upload logo image
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml"
                            onChange={handleLogoUpload}
                            style={{ display: 'none' }}
                          />
                        </label>
                      )}
                      <p className="setup-field__hint">PNG, JPG, or SVG — optional</p>
                    </div>
                  ) : f.type === 'address' ? (
                    <textarea
                      id={`setup-${f.name}`}
                      className="setup-field__input setup-field__textarea"
                      value={companyDetails[f.name] || ''}
                      onChange={(e) =>
                        setCompanyDetails({ ...companyDetails, [f.name]: e.target.value })
                      }
                      rows={3}
                      placeholder={f.label}
                    />
                  ) : (
                    <input
                      id={`setup-${f.name}`}
                      type="text"
                      className="setup-field__input"
                      value={companyDetails[f.name] || ''}
                      onChange={(e) =>
                        setCompanyDetails({ ...companyDetails, [f.name]: e.target.value })
                      }
                      placeholder={f.label}
                    />
                  )}
                </div>
              ))}
          </div>

          <p className="setup-reuse-note">
            These details are saved and reused when you start another Quick Start template.
          </p>

          <div className="setup-actions">
            <button type="button" className="template-toolbar__btn template-toolbar__btn--ghost" onClick={handleBackToTemplateChooser}>
              ← Back
            </button>
            <button
              type="button"
              className="template-toolbar__btn template-toolbar__btn--primary setup-finish-btn"
              onClick={handleFinishBuiltinSetup}
              disabled={!(companyDetails.sender_name || '').trim()}
            >
              Finish Setup →
            </button>
          </div>
        </div>
      ) : null}

      {!activeTemplate && !libreOfficeNeeded && templateSetupStep === 'chooser' ? (
        <div className="template-chooser">
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Choose a template</h3>
          <p style={{ fontSize: 12, color: '#666', margin: '0 0 16px' }}>
            Start with a pre-built template or upload your own corporate design.
          </p>

          <div className="template-library">
            <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Quick Start Templates</h4>
            <div className="template-library-grid">
              {BUILTIN_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  type="button"
                  className="template-library-card"
                  onClick={() => handleSelectBuiltin(tmpl)}
                >
                  <div className="template-card-preview">
                    <TemplatePreviewThumb layout={tmpl.layout} />
                  </div>
                  <span className="template-card-name">{tmpl.name}</span>
                  <span className="template-card-desc">{tmpl.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #E8E8E6' }} />
            <span style={{ fontSize: 11, color: '#999' }}>or</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid #E8E8E6' }} />
          </div>

          <div className="template-custom-upload">
            <h4 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Upload Your Own Template</h4>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
              Use your corporate letterhead. You&apos;ll map the dynamic fields once — then reuse forever.
            </p>
            <div
              className={`template-drop-zone ${isDragOver ? 'template-drop-zone--active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span>{'\u{1F4C4}'} Drag & drop your template here</span>
              <span style={{ fontSize: 11, color: '#999' }}>.docx, .odt, .doc, .rtf</span>
              <span style={{ fontSize: 11, color: '#999' }}>or</span>
              <label className="template-chooser-browse-btn" htmlFor="letter-template-custom-file">
                Browse files
                <input
                  id="letter-template-custom-file"
                  ref={customTemplateFileInputRef}
                  type="file"
                  accept={CUSTOM_TEMPLATE_ACCEPT}
                  disabled={busy}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    handleFilesReceived(Array.from(e.target.files || []))
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          </div>
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
              disabled={!activeTemplate.sourceFilePath || !!activeTemplate.builtinLayout}
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
                    {detecting ? 'Detecting…' : '\u{1F50D} Auto-detect fields'}
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
                  pageTextItems={pageTextItemsForOverlay}
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
          ) : activeTemplate.mappingComplete &&
            (previewImages.length > 0 || !!activeTemplate.builtinLayout) ? (
            <div className="template-compose-layout">
              {!activeTemplate.builtinLayout ? (
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="template-toolbar__linkish"
                    onClick={() => {
                      if (activeTemplateId) setTemplateMappingComplete(activeTemplateId, false)
                    }}
                  >
                    Edit field mapping
                  </button>
                </div>
              ) : null}
              <ComposeFieldsForm
                template={activeTemplate}
                composeSession={activeComposeSession}
                replyToLetter={replyToLetter}
              />
              {activeTemplate.sourceFilePath.toLowerCase().endsWith('.docx') ||
              !!activeTemplate.builtinLayout ? (
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
              {!activeTemplate.builtinLayout && previewImages.length > 0 ? (
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
                        pageTextItems={pageTextItemsForOverlay}
                        readOnly
                        onFieldAdded={() => {}}
                        onFieldRemoved={() => {}}
                        onFieldUpdated={() => {}}
                      />
                    </div>
                  </div>
                </details>
              ) : activeTemplate.builtinLayout ? (
                <p className="template-port__status template-port__status--muted">
                  Built-in letterhead preview will appear after document generation is enabled.
                </p>
              ) : null}
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
