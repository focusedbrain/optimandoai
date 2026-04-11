/**
 * Letter Composer — DOCX → HTML (mammoth), ODT → HTML (content.xml via pizzip) + AI field extraction (Ollama).
 */

import { ipcMain, app, dialog, BrowserWindow, shell } from 'electron'
import type { FSWatcher } from 'fs'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { pathToFileURL } from 'node:url'
import type { ChatMessage } from '../llm/types'

const TEMPLATES_SUBDIR = 'templates'
const LETTERS_SUBDIR = 'letters'
const CONVERTED_PDF_SUBDIR = 'converted-pdf'

function letterComposerRoot(): string {
  return path.join(app.getPath('userData'), 'letter-composer')
}

function templatesDir(): string {
  return path.join(letterComposerRoot(), TEMPLATES_SUBDIR)
}

function lettersDir(): string {
  return path.join(letterComposerRoot(), LETTERS_SUBDIR)
}

function convertedPdfDir(): string {
  return path.join(letterComposerRoot(), CONVERTED_PDF_SUBDIR)
}

function ensureLetterComposerDirs(): void {
  fs.mkdirSync(templatesDir(), { recursive: true })
  fs.mkdirSync(lettersDir(), { recursive: true })
  fs.mkdirSync(convertedPdfDir(), { recursive: true })
}

function exportStagingDir(): string {
  ensureLetterComposerDirs()
  const d = path.join(letterComposerRoot(), 'export-staging')
  fs.mkdirSync(d, { recursive: true })
  return d
}

type TemplateWatchEntry = { watcher: FSWatcher; debounce?: NodeJS.Timeout }
const templateFileWatchers = new Map<string, TemplateWatchEntry>()

type FillFieldPayload = {
  id: string
  placeholder: string
  value: string
  anchorText?: string
}

function normalizeFillFields(raw: unknown[]): FillFieldPayload[] {
  return raw.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    return {
      id: typeof o.id === 'string' ? o.id : `field_${i}`,
      placeholder: typeof o.placeholder === 'string' ? o.placeholder : '',
      value: typeof o.value === 'string' ? o.value : String(o.value ?? ''),
      anchorText: typeof o.anchorText === 'string' ? o.anchorText : '',
    }
  })
}

/** Opens the OS print dialog for a PDF, or falls back to the default viewer. */
function printPdfWithSystemDialog(pdfPath: string): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: false },
    })
    const url = pathToFileURL(pdfPath).href
    const fallback = () => {
      try {
        win.destroy()
      } catch {
        /* noop */
      }
      void shell.openPath(pdfPath).then(() => resolve())
    }
    const timer = setTimeout(fallback, 20_000)
    win.webContents.once('did-fail-load', () => {
      clearTimeout(timer)
      fallback()
    })
    win.webContents.once('did-finish-load', () => {
      try {
        win.webContents.print({ silent: false, printBackground: true }, () => {
          clearTimeout(timer)
          try {
            win.close()
          } catch {
            /* noop */
          }
          resolve()
        })
      } catch {
        clearTimeout(timer)
        fallback()
      }
    })
    win.loadURL(url).catch(() => {
      clearTimeout(timer)
      fallback()
    })
  })
}

/** PDF produced by LibreOffice for template preview — must stay under letter-composer root. */
function assertAllowedLetterComposerPdfPath(filePath: string): string {
  ensureLetterComposerDirs()
  const resolved = path.resolve(filePath)
  const root = path.resolve(letterComposerRoot())
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('PDF path is outside letter-composer storage')
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('PDF file not found')
  }
  if (!resolved.toLowerCase().endsWith('.pdf')) {
    throw new Error('Expected a PDF file')
  }
  return resolved
}

const TEMPLATE_EXT = /\.(docx|odt|doc|rtf|txt)$/i

function sanitizeTemplateBaseName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim()
  if (!base || base.length > 200) {
    throw new Error('Invalid template file name')
  }
  const lower = base.toLowerCase()
  if (!TEMPLATE_EXT.test(lower)) {
    throw new Error('Template must be .docx, .odt, .doc, .rtf, or .txt')
  }
  return base
}

/** Paths under templates dir — supported template formats for conversion. */
function assertAllowedTemplatePath(filePath: string): string {
  ensureLetterComposerDirs()
  const resolved = path.resolve(filePath)
  const root = path.resolve(templatesDir())
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Template path is outside letter-composer storage')
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('Template file not found')
  }
  const low = resolved.toLowerCase()
  if (!TEMPLATE_EXT.test(low)) {
    throw new Error('Only .docx, .odt, .doc, .rtf, and .txt are supported for conversion')
  }
  return resolved
}

/** Only .docx — used for filled DOCX export (mammoth/zip structure). */
function assertAllowedDocxPath(filePath: string): string {
  ensureLetterComposerDirs()
  const resolved = path.resolve(filePath)
  const root = path.resolve(templatesDir())
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Template path is outside letter-composer storage')
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('Template file not found')
  }
  if (!resolved.toLowerCase().endsWith('.docx')) {
    throw new Error('Only .docx files are supported for export')
  }
  return resolved
}

function sanitizeLetterFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim()
  if (!base || base.length > 200) {
    throw new Error('Invalid letter file name')
  }
  const lower = base.toLowerCase()
  const allowed =
    lower.endsWith('.pdf') ||
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.tif') ||
    lower.endsWith('.tiff') ||
    lower.endsWith('.webp')
  if (!allowed) {
    throw new Error('Letter must be a PDF or image (.png, .jpg, .jpeg, .tif, .tiff, .webp)')
  }
  return base
}

function assertAllowedLetterPath(filePath: string): string {
  ensureLetterComposerDirs()
  const resolved = path.resolve(filePath)
  const root = path.resolve(lettersDir())
  const rel = path.relative(root, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Letter path is outside letter-composer storage')
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('Letter file not found')
  }
  return resolved
}

const FIELD_SYSTEM_PROMPT = `You are analyzing a business letter template. Identify all placeholder fields that should be filled in by the user or AI. Return a JSON array of objects with: id (snake_case), name (human readable), placeholder (the marker text in the template like "{{field_name}}" or "[FIELD NAME]" or blank lines meant for content), type (text|date|multiline|address). Only return the JSON array, no other text.`

function normalizeExtractedField(raw: unknown): {
  id: string
  name: string
  placeholder: string
  type: 'text' | 'date' | 'multiline' | 'address'
} | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!id) return null
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id
  const placeholder = typeof o.placeholder === 'string' ? o.placeholder : ''
  const tr = typeof o.type === 'string' ? o.type.toLowerCase().trim() : 'text'
  const type =
    tr === 'date' || tr === 'multiline' || tr === 'address' || tr === 'text' ? tr : 'text'
  return { id, name, placeholder, type }
}

export function registerLetterComposerIpcHandlers(): void {
  ipcMain.handle(
    'letter:saveTemplateFromPath',
    async (_e, sourcePath: string, originalName: string) => {
      if (typeof sourcePath !== 'string' || typeof originalName !== 'string') {
        throw new Error('Invalid arguments')
      }
      if (sourcePath.length > 4096 || originalName.length > 300) {
        throw new Error('Path or name too long')
      }
      ensureLetterComposerDirs()
      const resolvedSource = path.resolve(sourcePath)
      if (!fs.existsSync(resolvedSource)) {
        throw new Error('Source file not found')
      }
      const safeName = sanitizeTemplateBaseName(originalName)
      const destName = `${crypto.randomUUID()}-${safeName}`
      const destPath = path.join(templatesDir(), destName)
      fs.copyFileSync(resolvedSource, destPath)
      return destPath
    },
  )

  ipcMain.handle('letter:saveTemplateBuffer', async (_e, fileName: string, data: unknown) => {
    if (typeof fileName !== 'string') {
      throw new Error('Invalid fileName')
    }
    let buf: Buffer
    if (Buffer.isBuffer(data)) {
      buf = data
    } else if (data instanceof Uint8Array) {
      buf = Buffer.from(data)
    } else if (Array.isArray(data) && data.every((x) => typeof x === 'number')) {
      buf = Buffer.from(data as number[])
    } else {
      throw new Error('Invalid file buffer')
    }
    if (buf.byteLength > 40 * 1024 * 1024) {
      throw new Error('Template file too large')
    }
    ensureLetterComposerDirs()
    const safeName = sanitizeTemplateBaseName(fileName)
    const destName = `${crypto.randomUUID()}-${safeName}`
    const destPath = path.join(templatesDir(), destName)
    fs.writeFileSync(destPath, buf)
    return destPath
  })

  ipcMain.handle(
    'letter:exportFilledDocx',
    async (
      event,
      payload: {
        sourcePath: string
        fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
        defaultName: string
      },
    ) => {
      if (!payload || typeof payload !== 'object' || typeof payload.sourcePath !== 'string') {
        return { success: false, error: 'Invalid payload' }
      }
      const fields = normalizeFillFields(Array.isArray(payload.fields) ? payload.fields : [])
      if (!payload.sourcePath.toLowerCase().endsWith('.docx')) {
        return {
          success: false,
          error:
            'Export as DOCX is only available for Word (.docx) templates. OpenDocument (.odt) can use Print.',
        }
      }
      const safe = assertAllowedDocxPath(payload.sourcePath)
      const buf = fs.readFileSync(safe)
      const { fillDocxPlaceholders } = await import('./fillDocxPlaceholders')
      const outBuf = fillDocxPlaceholders(buf, fields)
      const baseName =
        typeof payload.defaultName === 'string' && payload.defaultName.trim()
          ? payload.defaultName.trim().replace(/[^\w.\- ()[\]]+/g, '_')
          : 'filled-letter.docx'
      const name = baseName.toLowerCase().endsWith('.docx') ? baseName : `${baseName}.docx`
      const bw = BrowserWindow.fromWebContents(event.sender)
      const saveOpts = {
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      }
      const { canceled, filePath } = bw
        ? await dialog.showSaveDialog(bw, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (canceled || !filePath) {
        return { success: false, canceled: true }
      }
      fs.writeFileSync(filePath, outBuf)
      return { success: true, filePath }
    },
  )

  ipcMain.handle('letter:convertDocx', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length > 4096) {
      throw new Error('Invalid path')
    }
    const safe = assertAllowedTemplatePath(filePath)
    const low = safe.toLowerCase()
    if (low.endsWith('.docx')) {
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({ path: safe })
      return {
        html: result.value,
        messages: result.messages,
      }
    }
    if (low.endsWith('.odt')) {
      const buf = fs.readFileSync(safe)
      const { convertOdtBufferToHtml } = await import('./odtToHtml')
      return convertOdtBufferToHtml(buf)
    }
    if (low.endsWith('.doc')) {
      const buffer = fs.readFileSync(safe)
      const { extractTextFromDoc, plainTextLinesToParagraphHtml } = await import('./legacyDocumentToHtml')
      const text = extractTextFromDoc(buffer)
      const html = plainTextLinesToParagraphHtml(text, false)
      return {
        html,
        messages: ['Converted from legacy .doc — layout may differ from original'],
      }
    }
    if (low.endsWith('.rtf')) {
      const raw = fs.readFileSync(safe, 'utf-8')
      const { stripRtfFormatting, plainTextLinesToParagraphHtml } = await import('./legacyDocumentToHtml')
      const text = stripRtfFormatting(raw)
      const html = plainTextLinesToParagraphHtml(text, true)
      return {
        html,
        messages: ['Converted from RTF — layout may differ from original'],
      }
    }
    if (low.endsWith('.txt')) {
      const text = fs.readFileSync(safe, 'utf-8')
      const { plainTextLinesToParagraphHtml } = await import('./legacyDocumentToHtml')
      return {
        html: plainTextLinesToParagraphHtml(text, true),
        messages: [],
      }
    }
    throw new Error('Unsupported template format')
  })

  ipcMain.handle('letter:getConvertedPdfOutputDir', async () => {
    ensureLetterComposerDirs()
    return convertedPdfDir()
  })

  ipcMain.handle('letter:renderPdfPages', async (_e, pdfPath: string) => {
    if (typeof pdfPath !== 'string' || pdfPath.length > 4096) {
      throw new Error('Invalid path')
    }
    const safe = assertAllowedLetterComposerPdfPath(pdfPath)
    const { renderPdfFileToPngDataUrls } = await import('./templatePdfPreviewRender')
    return renderPdfFileToPngDataUrls(safe)
  })

  ipcMain.handle('letter:openInLibreOffice', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length > 4096) {
      return { ok: false as const, error: 'Invalid path' }
    }
    try {
      const safe = assertAllowedTemplatePath(filePath)
      const { detectLibreOffice } = await import('../libreoffice/libreofficeService')
      const sofficePath = await detectLibreOffice()
      if (!sofficePath) {
        return { ok: false as const, error: 'LIBREOFFICE_NOT_FOUND' }
      }
      const { spawn } = await import('child_process')
      const child = spawn(sofficePath, [safe], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      child.unref()
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Open failed' }
    }
  })

  ipcMain.handle('letter:scanPlaceholders', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length > 4096) {
      return {
        ok: false as const,
        fields: [] as Array<{ name: string; placeholder: string }>,
        error: 'Invalid path',
      }
    }
    let cleanupDir: string | null = null
    try {
      const safe = assertAllowedTemplatePath(filePath)
      const ext = path.extname(safe).slice(1).toLowerCase()
      let docxPath = safe
      if (ext !== 'docx') {
        const { convertToDocx } = await import('../libreoffice/libreofficeService')
        docxPath = await convertToDocx(safe)
        cleanupDir = path.dirname(docxPath)
      }
      const content = fs.readFileSync(docxPath)
      const PizZip = (await import('pizzip')).default
      const zip = new PizZip(content)
      const docXml = zip.file('word/document.xml')
      if (!docXml) {
        return { ok: false as const, fields: [], error: 'No document.xml in DOCX' }
      }
      const xmlText = docXml.asText()
      const textOnly = xmlText.replace(/<[^>]+>/g, '')
      const placeholderRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g
      const fields: Array<{ name: string; placeholder: string }> = []
      const seen = new Set<string>()
      let match: RegExpExecArray | null
      while ((match = placeholderRegex.exec(textOnly)) !== null) {
        const name = match[1]
        if (seen.has(name)) continue
        seen.add(name)
        fields.push({ name, placeholder: match[0] })
      }
      return { ok: true as const, fields }
    } catch (e) {
      return {
        ok: false as const,
        fields: [] as Array<{ name: string; placeholder: string }>,
        error: e instanceof Error ? e.message : 'Scan failed',
      }
    } finally {
      if (cleanupDir && fs.existsSync(cleanupDir)) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
  })

  ipcMain.handle('letter:watchTemplateFile', async (_e, filePath: string, templateId: string) => {
    if (typeof filePath !== 'string' || typeof templateId !== 'string' || templateId.length > 200) {
      return { ok: false as const, error: 'Invalid arguments' }
    }
    const prev = templateFileWatchers.get(templateId)
    if (prev) {
      if (prev.debounce) clearTimeout(prev.debounce)
      prev.watcher.close()
      templateFileWatchers.delete(templateId)
    }
    const safe = assertAllowedTemplatePath(filePath)
    const entry: TemplateWatchEntry = {
      watcher: fs.watch(safe, { persistent: false }, (eventType) => {
        if (eventType !== 'change' && eventType !== 'rename') return
        const st = templateFileWatchers.get(templateId)
        if (!st) return
        if (st.debounce) clearTimeout(st.debounce)
        st.debounce = setTimeout(() => {
          st.debounce = undefined
          for (const win of BrowserWindow.getAllWindows()) {
            if (win.isDestroyed()) continue
            win.webContents.send('letter:templateFileChanged', { templateId, filePath: safe })
          }
        }, 1500)
      }),
    }
    templateFileWatchers.set(templateId, entry)
    return { ok: true as const }
  })

  ipcMain.handle('letter:unwatchTemplateFile', async (_e, templateId: string) => {
    if (typeof templateId !== 'string') {
      return { ok: false as const }
    }
    const existing = templateFileWatchers.get(templateId)
    if (existing) {
      if (existing.debounce) clearTimeout(existing.debounce)
      existing.watcher.close()
      templateFileWatchers.delete(templateId)
    }
    return { ok: true as const }
  })

  ipcMain.handle('letter:detectFields', async (_e, pdfPath: string) => {
    if (typeof pdfPath !== 'string' || pdfPath.length > 4096) {
      return { ok: false, fields: [], error: 'Invalid path' }
    }
    try {
      const safe = assertAllowedLetterComposerPdfPath(pdfPath)
      const { detectTemplateFieldsFromPdfPath } = await import('./templateFieldDetect')
      return await detectTemplateFieldsFromPdfPath(safe)
    } catch (e) {
      return {
        ok: false,
        fields: [],
        error: e instanceof Error ? e.message : 'Field detection failed',
      }
    }
  })

  ipcMain.handle('letter:extractFromScan', async (_e, text: string) => {
    if (typeof text !== 'string') {
      return { raw: { date: null, sender_lines: [], recipient_lines: [], subject_line: null, reference: null, salutation_line: null } }
    }
    const { extractRawFromScanText } = await import('./letterScanExtract')
    return extractRawFromScanText(text.slice(0, 500_000))
  })

  ipcMain.handle('letter:normalizeExtracted', async (_e, rawFields: unknown, fullText: string) => {
    const ft = typeof fullText === 'string' ? fullText : ''
    const { normalizeLetterScanExtraction } = await import('./letterScanNormalize')
    return normalizeLetterScanExtraction(rawFields, ft.slice(0, 500_000))
  })

  ipcMain.handle('letter:extractFields', async (_e, html: string) => {
    if (typeof html !== 'string') {
      return []
    }
    const slice = html.slice(0, 8000)
    try {
      const { ollamaManager } = await import('../llm/ollama-manager')
      const modelId = await ollamaManager.getEffectiveChatModelName()
      if (!modelId) {
        console.warn('[letter:extractFields] No effective Ollama model')
        return []
      }
      const messages: ChatMessage[] = [
        { role: 'system', content: FIELD_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Analyze this letter template HTML and extract all fillable fields:\n\n${slice}`,
        },
      ]
      const response = await ollamaManager.chat(modelId, messages)
      const text = response?.content || '[]'
      const cleaned = text
        .replace(/```json?\s*/gi, '')
        .replace(/```/g, '')
        .trim()
      const parsed = JSON.parse(cleaned) as unknown
      if (!Array.isArray(parsed)) {
        return []
      }
      const out: ReturnType<typeof normalizeExtractedField>[] = []
      for (const item of parsed) {
        const n = normalizeExtractedField(item)
        if (n) out.push(n)
      }
      return out
    } catch (e) {
      console.warn('[letter:extractFields] failed:', e instanceof Error ? e.message : e)
      return []
    }
  })

  ipcMain.handle(
    'letter:saveLetterFromPath',
    async (_e, sourcePath: string, originalName: string) => {
      if (typeof sourcePath !== 'string' || typeof originalName !== 'string') {
        throw new Error('Invalid arguments')
      }
      if (sourcePath.length > 4096 || originalName.length > 300) {
        throw new Error('Path or name too long')
      }
      ensureLetterComposerDirs()
      const resolvedSource = path.resolve(sourcePath)
      if (!fs.existsSync(resolvedSource)) {
        throw new Error('Source file not found')
      }
      const safeName = sanitizeLetterFileName(originalName)
      const destName = `${crypto.randomUUID()}-${safeName}`
      const destPath = path.join(lettersDir(), destName)
      fs.copyFileSync(resolvedSource, destPath)
      return destPath
    },
  )

  ipcMain.handle('letter:saveLetterBuffer', async (_e, fileName: string, data: unknown) => {
    if (typeof fileName !== 'string') {
      throw new Error('Invalid fileName')
    }
    let buf: Buffer
    if (Buffer.isBuffer(data)) {
      buf = data
    } else if (data instanceof Uint8Array) {
      buf = Buffer.from(data)
    } else if (Array.isArray(data) && data.every((x) => typeof x === 'number')) {
      buf = Buffer.from(data as number[])
    } else {
      throw new Error('Invalid file buffer')
    }
    if (buf.byteLength > 80 * 1024 * 1024) {
      throw new Error('Letter file too large')
    }
    ensureLetterComposerDirs()
    const safeName = sanitizeLetterFileName(fileName)
    const destName = `${crypto.randomUUID()}-${safeName}`
    const destPath = path.join(lettersDir(), destName)
    fs.writeFileSync(destPath, buf)
    return destPath
  })

  ipcMain.handle('letter:processPdf', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length > 4096) {
      throw new Error('Invalid path')
    }
    const safe = assertAllowedLetterPath(filePath)
    if (!safe.toLowerCase().endsWith('.pdf')) {
      throw new Error('Not a PDF file')
    }
    const { processPdfForLetterViewer } = await import('./letterScanProcessing')
    return processPdfForLetterViewer(safe)
  })

  ipcMain.handle('letter:processImageFile', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length > 4096) {
      throw new Error('Invalid path')
    }
    const safe = assertAllowedLetterPath(filePath)
    const low = safe.toLowerCase()
    if (low.endsWith('.pdf')) {
      throw new Error('Use letter:processPdf for PDF files')
    }
    const { processImageFileForLetterViewer } = await import('./letterScanProcessing')
    return processImageFileForLetterViewer(safe)
  })

  ipcMain.handle('letter:processImagePaths', async (_e, paths: unknown) => {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error('Expected non-empty paths array')
    }
    if (paths.length > 80) {
      throw new Error('Too many images')
    }
    const { processImageFileForLetterViewer } = await import('./letterScanProcessing')
    const pages: Array<{ pageNumber: number; imageDataUrl: string; text: string }> = []
    let idx = 0
    for (const p of paths) {
      if (typeof p !== 'string') continue
      const safe = assertAllowedLetterPath(p)
      const low = safe.toLowerCase()
      if (low.endsWith('.pdf')) {
        throw new Error('Do not mix PDF with batch image paths')
      }
      const { imageDataUrl, text } = await processImageFileForLetterViewer(safe)
      idx += 1
      pages.push({ pageNumber: idx, imageDataUrl, text })
    }
    if (pages.length === 0) {
      throw new Error('No valid image paths')
    }
    const fullText = pages.map((x) => x.text).filter(Boolean).join('\n\n--- Page Break ---\n\n')
    return { pages, fullText }
  })

  ipcMain.handle(
    'letter:exportFilledPdf',
    async (
      event,
      payload: {
        sourcePath: string
        fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
        defaultName: string
      },
    ) => {
      if (!payload || typeof payload !== 'object' || typeof payload.sourcePath !== 'string') {
        return { success: false, error: 'Invalid payload' }
      }
      if (!payload.sourcePath.toLowerCase().endsWith('.docx')) {
        return {
          success: false,
          error: 'PDF export is only available for Word (.docx) templates.',
        }
      }
      const fields = normalizeFillFields(Array.isArray(payload.fields) ? payload.fields : [])
      const safe = assertAllowedDocxPath(payload.sourcePath)
      const buf = fs.readFileSync(safe)
      const { fillDocxPlaceholders } = await import('./fillDocxPlaceholders')
      const outBuf = fillDocxPlaceholders(buf, fields)
      const staging = exportStagingDir()
      const id = crypto.randomUUID()
      const tempDocx = path.join(staging, `${id}-filled.docx`)
      fs.writeFileSync(tempDocx, outBuf)
      let pdfPath: string
      try {
        const { convertToPdf } = await import('../libreoffice/libreofficeService')
        pdfPath = await convertToPdf(tempDocx, staging)
      } catch (e) {
        try {
          fs.unlinkSync(tempDocx)
        } catch {
          /* noop */
        }
        const msg = e instanceof Error ? e.message : 'PDF conversion failed'
        return { success: false, error: msg === 'LIBREOFFICE_NOT_FOUND' ? 'LibreOffice not found.' : msg }
      }
      try {
        fs.unlinkSync(tempDocx)
      } catch {
        /* noop */
      }
      const baseName =
        typeof payload.defaultName === 'string' && payload.defaultName.trim()
          ? payload.defaultName.trim().replace(/[^\w.\- ()[\]]+/g, '_')
          : 'filled-letter.pdf'
      const name = baseName.toLowerCase().endsWith('.pdf') ? baseName : `${baseName}.pdf`
      const bwPdf = BrowserWindow.fromWebContents(event.sender)
      const pdfSaveOpts = {
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      }
      const { canceled, filePath } = bwPdf
        ? await dialog.showSaveDialog(bwPdf, pdfSaveOpts)
        : await dialog.showSaveDialog(pdfSaveOpts)
      if (canceled || !filePath) {
        try {
          fs.unlinkSync(pdfPath)
        } catch {
          /* noop */
        }
        return { success: false, canceled: true }
      }
      try {
        fs.copyFileSync(pdfPath, filePath)
      } finally {
        try {
          fs.unlinkSync(pdfPath)
        } catch {
          /* noop */
        }
      }
      return { success: true, filePath }
    },
  )

  ipcMain.handle(
    'letter:printFilledLetter',
    async (
      _event,
      payload: {
        sourcePath: string
        fields: Array<{ id: string; placeholder: string; value: string; anchorText?: string }>
      },
    ) => {
      if (!payload || typeof payload !== 'object' || typeof payload.sourcePath !== 'string') {
        return { success: false, error: 'Invalid payload' }
      }
      if (!payload.sourcePath.toLowerCase().endsWith('.docx')) {
        return { success: false, error: 'Print from filled template requires a .docx source.' }
      }
      const fields = normalizeFillFields(Array.isArray(payload.fields) ? payload.fields : [])
      const safe = assertAllowedDocxPath(payload.sourcePath)
      const buf = fs.readFileSync(safe)
      const { fillDocxPlaceholders } = await import('./fillDocxPlaceholders')
      const outBuf = fillDocxPlaceholders(buf, fields)
      const staging = exportStagingDir()
      const id = crypto.randomUUID()
      const tempDocx = path.join(staging, `${id}-filled.docx`)
      fs.writeFileSync(tempDocx, outBuf)
      let pdfPath: string
      try {
        const { convertToPdf } = await import('../libreoffice/libreofficeService')
        pdfPath = await convertToPdf(tempDocx, staging)
      } catch (e) {
        try {
          fs.unlinkSync(tempDocx)
        } catch {
          /* noop */
        }
        const msg = e instanceof Error ? e.message : 'PDF conversion failed'
        return { success: false, error: msg === 'LIBREOFFICE_NOT_FOUND' ? 'LibreOffice not found.' : msg }
      }
      try {
        fs.unlinkSync(tempDocx)
      } catch {
        /* noop */
      }
      try {
        await printPdfWithSystemDialog(pdfPath)
      } finally {
        try {
          fs.unlinkSync(pdfPath)
        } catch {
          /* noop */
        }
      }
      return { success: true }
    },
  )

  console.log(
    '[MAIN] Letter Composer IPC: templates + letters + template PDF preview (saveLetter*, processPdf, renderPdfPages, …)',
  )
}
