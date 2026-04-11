/**
 * Letter Composer — DOCX → HTML (mammoth), ODT → HTML (content.xml via pizzip) + AI field extraction (Ollama).
 */

import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { ChatMessage } from '../llm/types'

const TEMPLATES_SUBDIR = 'templates'
const LETTERS_SUBDIR = 'letters'

function letterComposerRoot(): string {
  return path.join(app.getPath('userData'), 'letter-composer')
}

function templatesDir(): string {
  return path.join(letterComposerRoot(), TEMPLATES_SUBDIR)
}

function lettersDir(): string {
  return path.join(letterComposerRoot(), LETTERS_SUBDIR)
}

function ensureLetterComposerDirs(): void {
  fs.mkdirSync(templatesDir(), { recursive: true })
  fs.mkdirSync(lettersDir(), { recursive: true })
}

function sanitizeTemplateBaseName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim()
  if (!base || base.length > 200) {
    throw new Error('Invalid template file name')
  }
  const lower = base.toLowerCase()
  if (!lower.endsWith('.docx') && !lower.endsWith('.odt')) {
    throw new Error('Template must be a .docx or .odt file')
  }
  return base
}

/** Paths under templates dir; .docx or .odt (for mammoth / ODT ZIP conversion). */
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
  if (!low.endsWith('.docx') && !low.endsWith('.odt')) {
    throw new Error('Only .docx and .odt files are supported for conversion')
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
        fields: Array<{ id: string; placeholder: string; value: string }>
        defaultName: string
      },
    ) => {
      if (!payload || typeof payload !== 'object' || typeof payload.sourcePath !== 'string') {
        return { success: false, error: 'Invalid payload' }
      }
      const fields = Array.isArray(payload.fields) ? payload.fields : []
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
      const win = BrowserWindow.fromWebContents(event.sender)
      const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
        defaultPath: path.join(app.getPath('downloads'), name),
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
      })
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
    const buf = fs.readFileSync(safe)
    const { convertOdtBufferToHtml } = await import('./odtToHtml')
    return convertOdtBufferToHtml(buf)
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

  console.log(
    '[MAIN] Letter Composer IPC: templates + letters (saveLetter*, processPdf, processImage*)',
  )
}
