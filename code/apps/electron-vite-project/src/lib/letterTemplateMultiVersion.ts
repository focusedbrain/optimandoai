/**
 * Detect when WR Chat should run 3× LLM fills for the letter template (template port focus).
 */

export function wantsLetterTemplateMultiVersion(userMessage: string): boolean {
  const s = userMessage.trim().toLowerCase()
  if (!s) return false
  if (/\b(generate|create|produce|make)\s+(3|three)\s+versions\b/.test(s)) return true
  if (/\b3\s+versions\b/.test(s) && /\b(generate|create|fill|draft)\b/.test(s)) return true
  if (/\bfill\s+the\s+template\b/.test(s)) return true
  if (/\bdraft\s+(a\s+)?response\b/.test(s)) return true
  if (/\bfill\s+all\s+(the\s+)?fields\b/.test(s)) return true
  return false
}

/** Strip markdown fences and parse JSON object; values must be strings for known field ids. */
export function parseLetterFillJson(raw: string, fieldIds: string[]): Record<string, string> | null {
  if (!fieldIds.length) return null
  let t = raw.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  t = t.slice(start, end + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(t) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const id of fieldIds) {
    const v = o[id]
    if (v === undefined || v === null) {
      out[id] = ''
      continue
    }
    out[id] = typeof v === 'string' ? v : String(v)
  }
  return out
}

/** Build a minimal printable HTML page from mammoth HTML + current field values. */
export function letterTemplateFilledHtml(
  renderedHtml: string,
  fields: Array<{ id: string; placeholder: string; value: string }>,
): string {
  let html = renderedHtml
  for (const f of fields) {
    const tok = f.placeholder?.trim() || `{{${f.id}}}`
    if (!tok) continue
    const safe = String(f.value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n/g, '\n')
    const withBr = safe.replace(/\n/g, '<br/>')
    html = html.split(tok).join(withBr)
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Letter</title><style>body{font-family:Georgia,'Times New Roman',serif;padding:24px;max-width:8.5in;margin:0 auto;color:#111}</style></head><body>${html}</body></html>`
}
