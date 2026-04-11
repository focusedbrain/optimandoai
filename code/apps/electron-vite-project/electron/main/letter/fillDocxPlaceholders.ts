/**
 * Fill a .docx by replacing placeholder tokens in word/*.xml (best-effort for Word run splits).
 */

import PizZip from 'pizzip'

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type FillDocxField = { id: string; placeholder: string; value: string }

export function fillDocxPlaceholders(buf: Buffer, fields: FillDocxField[]): Buffer {
  const zip = new PizZip(buf)
  for (const relPath of Object.keys(zip.files)) {
    if (!relPath.startsWith('word/') || !relPath.endsWith('.xml')) continue
    const entry = zip.file(relPath)
    if (!entry || entry.dir) continue
    let xml = entry.asText()
    for (const fld of fields) {
      const tok = (fld.placeholder && fld.placeholder.trim()) ? fld.placeholder.trim() : `{{${fld.id}}}`
      if (!tok || !xml.includes(tok)) continue
      xml = xml.split(tok).join(escapeXmlText(fld.value ?? ''))
    }
    zip.file(relPath, xml)
  }
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}
