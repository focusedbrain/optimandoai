/**
 * OpenDocument Text (.odt) → HTML: ODT is a ZIP; main body lives in content.xml.
 * Maps common ODF elements to simple HTML without LibreOffice or new dependencies (uses pizzip).
 */

import PizZip from 'pizzip'

export function convertOdtBufferToHtml(buf: Buffer): { html: string; messages: string[] } {
  try {
    const zip = new PizZip(buf)
    const contentFile = zip.file('content.xml')
    if (!contentFile || contentFile.dir) {
      return {
        html: '<p>Could not read template content.</p>',
        messages: ['content.xml not found in .odt'],
      }
    }
    const contentXml = contentFile.asText()
    return { html: convertOdtXmlToHtml(contentXml), messages: [] }
  } catch (err) {
    return {
      html: '<p>Failed to read .odt file.</p>',
      messages: [String(err)],
    }
  }
}

/** Strip leftover namespaced XML tags (e.g. text:section, draw:frame). */
function stripResidualOdfTags(html: string): string {
  let prev = ''
  let cur = html
  for (let i = 0; i < 8 && cur !== prev; i++) {
    prev = cur
    cur = cur.replace(/<\/?[a-z][\w.-]*:[a-z][\w.-]*\b[^>]*>/gi, '')
  }
  return cur
}

export function convertOdtXmlToHtml(xml: string): string {
  let html = xml.replace(/<\?xml[^?]*\?>/gi, '')
  const bodyMatch = html.match(/<office:text\b[^>]*>([\s\S]*?)<\/office:text>/i)
  if (!bodyMatch) {
    return '<p>(Empty document)</p>'
  }
  html = bodyMatch[1]

  html = html
    .replace(/<text:h\b[^>]*>/gi, '<h2>')
    .replace(/<\/text:h>/gi, '</h2>')
    .replace(/<text:p\b[^>]*>/gi, '<p>')
    .replace(/<\/text:p>/gi, '</p>')
    .replace(/<text:span\b[^>]*>/gi, '<span>')
    .replace(/<\/text:span>/gi, '</span>')
    .replace(/<text:line-break\s*\/>/gi, '<br/>')
    .replace(/<text:tab\s*\/>/gi, '&emsp;')
    .replace(/<text:s\b[^>]*\btext:c="(\d+)"[^>]*\/>/gi, (_, c) => ' '.repeat(parseInt(c, 10)))
    .replace(/<text:s\b[^>]*\/>/gi, ' ')
    .replace(/<text:list\b[^>]*>/gi, '<ul>')
    .replace(/<\/text:list>/gi, '</ul>')
    .replace(/<text:list-item\b[^>]*>/gi, '<li>')
    .replace(/<\/text:list-item>/gi, '</li>')
    .replace(/<table:table\b[^>]*>/gi, '<table>')
    .replace(/<\/table:table>/gi, '</table>')
    .replace(/<table:table-row\b[^>]*>/gi, '<tr>')
    .replace(/<\/table:table-row>/gi, '</tr>')
    .replace(/<table:table-cell\b[^>]*>/gi, '<td>')
    .replace(/<\/table:table-cell>/gi, '</td>')

  html = stripResidualOdfTags(html)
  html = html.replace(/\n\s*\n/g, '\n').trim()

  if (!html) return '<p>(Empty document)</p>'
  return html
}
