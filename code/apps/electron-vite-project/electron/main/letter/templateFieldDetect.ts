/**
 * AI-assisted field zone detection from PDF text layer (positions + Ollama).
 */

import fs from 'fs'
import type { ChatMessage } from '../llm/types'

const MAX_PAGES = 30
const MAX_TEXT_DUMP = 6000

type PositionedItem = { text: string; x: number; y: number; w: number; h: number }

export type DetectedFieldShape = {
  name: string
  label: string
  type: string
  mode: string
  page: number
  x: number
  y: number
  w: number
  h: number
}

async function loadPdfjs(): Promise<any> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs' as any).catch(() =>
    import('pdfjs-dist' as any),
  )
  const { createRequire } = await import('module')
  const { pathToFileURL } = await import('url')
  const path = await import('path')
  const require = createRequire(import.meta.url)
  if (pdfjs.GlobalWorkerOptions) {
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'))
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'build', 'pdf.worker.mjs')).href
  }
  return pdfjs
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

async function extractPositionedItemsAsync(
  buffer: Buffer,
): Promise<{ pageTexts: Array<{ page: number; items: PositionedItem[] }>; error?: string }> {
  if (buffer.length < 5 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return { pageTexts: [], error: 'Invalid PDF file' }
  }

  const pdfjs = await loadPdfjs()
  let pdf: any
  try {
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
    pdf = await loadingTask.promise
  } catch (err: any) {
    if (err?.name === 'PasswordException' || err?.message?.toLowerCase?.().includes('password')) {
      return { pageTexts: [], error: 'Password-protected PDF' }
    }
    return { pageTexts: [], error: err?.message ? String(err.message) : 'Could not open PDF' }
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES)
  const pageTexts: Array<{ page: number; items: PositionedItem[] }> = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1.0 })
    const textContent = await page.getTextContent()
    const items: PositionedItem[] = []

    for (const raw of textContent.items as any[]) {
      const str = typeof raw.str === 'string' ? raw.str : ''
      if (!str.trim()) continue
      const tx: number[] = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0]
      const vw = viewport.width || 1
      const vh = viewport.height || 1
      const x = tx[4] / vw
      const y = 1 - tx[5] / vh
      const w = (typeof raw.width === 'number' ? raw.width : 0) / vw
      const h = (typeof raw.height === 'number' ? raw.height : Math.abs(tx[3]) || 12) / vh
      items.push({
        text: str,
        x: clamp01(x),
        y: clamp01(y),
        w: clamp01(w || 0.02),
        h: clamp01(h || 0.02),
      })
    }

    pageTexts.push({ page: i - 1, items })
  }

  return { pageTexts }
}

function normalizeDetected(raw: unknown): DetectedFieldShape | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === 'string' ? o.name.trim() : ''
  const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : name || 'Field'
  if (!name && !label) return null
  const typeRaw = typeof o.type === 'string' ? o.type.toLowerCase() : 'text'
  const type =
    typeRaw === 'date' || typeRaw === 'multiline' || typeRaw === 'address' || typeRaw === 'richtext'
      ? typeRaw
      : 'text'
  const modeRaw = typeof o.mode === 'string' ? o.mode.toLowerCase() : 'fixed'
  const mode = modeRaw === 'flow' ? 'flow' : 'fixed'
  const page = typeof o.page === 'number' && Number.isFinite(o.page) ? Math.max(0, Math.floor(o.page)) : 0
  const x = typeof o.x === 'number' && Number.isFinite(o.x) ? clamp01(o.x) : 0
  const y = typeof o.y === 'number' && Number.isFinite(o.y) ? clamp01(o.y) : 0
  const w = typeof o.w === 'number' && Number.isFinite(o.w) ? clamp01(o.w) : 0.1
  const h = typeof o.h === 'number' && Number.isFinite(o.h) ? clamp01(o.h) : 0.04
  const safeName = name || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'
  return {
    name: safeName,
    label,
    type,
    mode,
    page,
    x,
    y,
    w: Math.max(0.01, Math.min(w, 1 - x)),
    h: Math.max(0.01, Math.min(h, 1 - y)),
  }
}

const FIELD_DETECT_SYSTEM = `You are analyzing a business letter template. Based on the positioned text snippets (x,y are 0-1 fractions, origin top-left of page), identify logical fillable field zones.

Return a JSON array only (no markdown, no prose) of objects with:
- name: snake_case semantic name (e.g. sender_address, recipient, date, subject, salutation, body, closing, signer_name, reference_number)
- label: short human-readable label
- type: one of text|date|multiline|address|richtext
- mode: fixed or flow (body/subject usually flow; addresses/date often fixed)
- page: 0-based page index
- x, y, w, h: bounding box as 0-1 fractions of the page (cover the relevant text lines; slightly expand if needed)

If unsure, omit that field. Return [] if there is no usable text.`

export async function detectTemplateFieldsFromPdfPath(absPdfPath: string): Promise<{
  ok: boolean
  fields: DetectedFieldShape[]
  error?: string
}> {
  const buffer = fs.readFileSync(absPdfPath)
  const { pageTexts, error: exErr } = await extractPositionedItemsAsync(buffer)
  if (exErr) {
    return { ok: false, fields: [], error: exErr }
  }

  const textDump = pageTexts
    .map(
      (p) =>
        `[Page ${p.page + 1}]\n` +
        p.items.map((i) => `(${i.x.toFixed(2)},${i.y.toFixed(2)}) "${i.text}"`).join('\n'),
    )
    .join('\n\n')
    .slice(0, MAX_TEXT_DUMP)

  if (!textDump.trim()) {
    return {
      ok: false,
      fields: [],
      error: 'No text layer in this PDF — try manual mapping or a different export.',
    }
  }

  const { ollamaManager } = await import('../llm/ollama-manager')
  const modelId = await ollamaManager.getEffectiveChatModelName()
  if (!modelId) {
    return { ok: false, fields: [], error: 'No Ollama model configured. Set a chat model in settings.' }
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: FIELD_DETECT_SYSTEM },
    {
      role: 'user',
      content: `Detect fields in this business letter template:\n\n${textDump}`,
    },
  ]

  let text = '[]'
  try {
    const response = await ollamaManager.chat(modelId, messages)
    text = response?.content?.trim() || '[]'
  } catch (e) {
    return {
      ok: false,
      fields: [],
      error: e instanceof Error ? e.message : 'Ollama request failed',
    }
  }

  let parsed: unknown
  try {
    const cleaned = text
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .trim()
    const start = cleaned.indexOf('[')
    const end = cleaned.lastIndexOf(']')
    const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
    parsed = JSON.parse(slice)
  } catch {
    return { ok: true, fields: [], error: 'Could not parse model output as JSON.' }
  }

  if (!Array.isArray(parsed)) {
    return { ok: true, fields: [] }
  }

  const fields: DetectedFieldShape[] = []
  for (const item of parsed) {
    const n = normalizeDetected(item)
    if (n) fields.push(n)
  }

  return { ok: true, fields }
}
