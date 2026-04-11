/**
 * Fill a .docx by replacing placeholder / anchor text in word/*.xml.
 * Handles text split across multiple <w:t> runs (common in Word).
 */

import PizZip from 'pizzip'

function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type FillDocxField = {
  id: string
  placeholder: string
  value: string
  /** Original text at mapped zone — preferred for search when present in XML. */
  anchorText?: string
}

function effectiveSearch(f: FillDocxField): string {
  const a = (f.anchorText && f.anchorText.trim()) || ''
  if (a) return a
  const p = (f.placeholder && f.placeholder.trim()) || ''
  if (p) return p
  return `{{${f.id}}}`
}

type WtMatch = { start: number; end: number; text: string; plainStart: number }

function collectWtMatches(xml: string): { matches: WtMatch[]; plain: string } {
  const wtRe = /<w:t([^>]*)>([^<]*)<\/w:t>/g
  const matches: WtMatch[] = []
  let plain = ''
  let m: RegExpExecArray | null
  while ((m = wtRe.exec(xml)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[2],
      plainStart: plain.length,
    })
    plain += m[2]
  }
  return { matches, plain }
}

/** Replace first occurrence of search (as contiguous plain text across <w:t> runs). */
function replaceFirstAcrossRuns(xml: string, search: string, replacement: string): string {
  if (!search) return xml
  const esc = escapeXmlText(replacement)
  if (xml.includes(search)) {
    return xml.replace(search, esc)
  }

  const { matches: ms, plain } = collectWtMatches(xml)
  if (ms.length === 0) return xml

  const idx = plain.indexOf(search)
  if (idx === -1) return xml

  const endIdx = idx + search.length
  let firstMi = -1
  let lastMi = -1
  for (let i = 0; i < ms.length; i++) {
    const w = ms[i]
    const pe = w.plainStart + w.text.length
    if (pe > idx && firstMi === -1) firstMi = i
    if (w.plainStart < endIdx) lastMi = i
  }
  if (firstMi === -1 || lastMi === -1 || firstMi > lastMi) return xml

  let out = ''
  out += xml.slice(0, ms[firstMi].start)
  for (let i = firstMi; i <= lastMi; i++) {
    const segment = xml.slice(ms[i].start, ms[i].end)
    const inner = i === firstMi ? esc : ''
    const replaced = segment.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, `<w:t xml:space="preserve">${inner}</w:t>`)
    out += replaced
    if (i < lastMi) {
      out += xml.slice(ms[i].end, ms[i + 1].start)
    }
  }
  out += xml.slice(ms[lastMi].end)
  return out
}

function replaceAllInXml(xml: string, fld: FillDocxField): string {
  const search = effectiveSearch(fld)
  if (!search) return xml
  const val = fld.value ?? ''
  if (!val.trim()) return xml

  let next = xml
  let guard = 0
  while (guard++ < 64) {
    const prev = next
    next = replaceFirstAcrossRuns(next, search, val)
    if (next === prev) break
  }
  return next
}

export function fillDocxPlaceholders(buf: Buffer, fields: FillDocxField[]): Buffer {
  const zip = new PizZip(buf)
  const ordered = [...fields].sort(
    (a, b) => effectiveSearch(b).length - effectiveSearch(a).length,
  )
  for (const relPath of Object.keys(zip.files)) {
    if (!relPath.startsWith('word/') || !relPath.endsWith('.xml')) continue
    const entry = zip.file(relPath)
    if (!entry || entry.dir) continue
    let xml = entry.asText()
    for (const fld of ordered) {
      xml = replaceAllInXml(xml, fld)
    }
    zip.file(relPath, xml)
  }
  return zip.generate({ type: 'nodebuffer' }) as Buffer
}
