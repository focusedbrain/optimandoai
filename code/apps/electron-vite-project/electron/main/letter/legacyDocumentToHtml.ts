/**
 * Best-effort text extraction → simple paragraph HTML for .doc / .rtf / .txt (no layout fidelity).
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Legacy Word .doc (binary OLE) — pull printable runs; layout will not match. */
export function extractTextFromDoc(buffer: Buffer): string {
  const latin = buffer.toString('latin1')
  const runs = latin.match(/[\x20-\x7E\u00A0-\u024F]{4,}/g) ?? []
  if (runs.length > 0) {
    return runs.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }
  const utf8 = buffer.toString('utf8', 0, Math.min(buffer.length, 2_000_000))
  const lines = utf8
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[^\x20-\x7E\u00C0-\u024F]/g, '').trim())
    .filter((l) => l.length > 2)
  return lines.join('\n').trim()
}

/** Strip RTF control words; decode \'hh hex bytes to chars where possible. */
export function stripRtfFormatting(rtf: string): string {
  let text = rtf.replace(/\r\n|\r/g, '\n')
  text = text.replace(/\\'([0-9a-f]{2})/gi, (_, hex) => {
    const code = parseInt(hex, 16)
    if (Number.isNaN(code)) return ''
    try {
      return String.fromCharCode(code)
    } catch {
      return ''
    }
  })
  text = text
    .replace(/\{\\\*[^}]*\}/g, '')
    .replace(/\{[^{}]*\}/g, '')
    .replace(/\\[a-z]+(-?\d+)?[ ]?/gi, '')
    .replace(/\\[^a-z]?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

export function plainTextLinesToParagraphHtml(text: string, emptyAsBr: boolean): string {
  const lines = text.split(/\n/)
  const parts = lines.map((l) => {
    const t = l.trim()
    if (!t) return emptyAsBr ? '<br/>' : ''
    return `<p>${escapeHtml(l)}</p>`
  })
  const html = parts.filter(Boolean).join('\n')
  return html || '<p>(Empty document)</p>'
}
