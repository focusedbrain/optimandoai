/**
 * Safe link utilities — extract links from message content for button rendering.
 * Replaces raw URLs and {{LINK_BUTTON:...}} placeholders with safe, readable buttons.
 */

export interface LinkPart {
  type: 'text' | 'link'
  text: string
  url?: string
  label?: string
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+/gi
const PLACEHOLDER_RE = /\{\{LINK_BUTTON:([^}]+)\}\}/gi
const MD_LINK_RE = /\[([^\]]+)]\((https?:\/\/[^)\s<]+|www\.[^)\s<]+)\)/gi

/** Ensure http(s) URL for `openAppExternalUrl` (plain text often has `www.` only). */
export function ensureAbsoluteHttpUrlForOpen(u: string): string {
  const t = u.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (/^www\./i.test(t)) return `https://${t}`
  if (t.startsWith('//') && /^\/\/[^/]/i.test(t)) return `https:${t}`
  return t
}

/** Derive a readable button label from URL or context */
export function getButtonLabel(url: string, hint?: string): string {
  if (hint && hint.length > 0 && hint.length < 60) return hint
  const lower = url.toLowerCase()
  if (lower.includes('article') || lower.includes('/blog/') || lower.includes('/post/')) return 'Open article'
  if (lower.includes('docs') || lower.includes('readme')) return 'View source'
  return 'Open link'
}

interface Match {
  index: number
  end: number
  url: string
  label?: string
}

function rangeOverlaps(i: number, e: number, m: Match[]): boolean {
  return m.some((x) => i < x.end && e > x.index)
}

/** Extract link parts from plain text for rendering as text + buttons */
export function extractLinkParts(text: string): LinkPart[] {
  if (!text || typeof text !== 'string') return [{ type: 'text', text: '' }]
  const parts: LinkPart[] = []
  let lastIndex = 0

  // Placeholders, Markdown [label](url), then bare URLs — avoid overlapping windows
  const matches: Match[] = []

  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const raw = m[1].trim()
    const pipe = raw.indexOf('|')
    const label = pipe >= 0 ? raw.slice(0, pipe).trim() : undefined
    const url = ensureAbsoluteHttpUrlForOpen(pipe >= 0 ? raw.slice(pipe + 1).trim() : raw)
    const i = m.index!
    const e = i + m[0].length
    if (url && !rangeOverlaps(i, e, matches)) {
      matches.push({ index: i, end: e, url, label })
    }
  }

  for (const m of text.matchAll(MD_LINK_RE)) {
    let url = m[2].trim()
    url = ensureAbsoluteHttpUrlForOpen(url)
    const label = m[1].trim()
    const i = m.index!
    const e = i + m[0].length
    if (!rangeOverlaps(i, e, matches)) {
      matches.push({ index: i, end: e, url, label: label || undefined })
    }
  }

  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0]
    const url = ensureAbsoluteHttpUrlForOpen(raw)
    const idx = m.index!
    const end = idx + raw.length
    if (!rangeOverlaps(idx, end, matches)) {
      matches.push({ index: idx, end, url })
    }
  }

  matches.sort((a, b) => a.index - b.index)

  for (const m of matches) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, m.index) })
    }
    parts.push({
      type: 'link',
      text: getButtonLabel(m.url, m.label),
      url: m.url,
      label: m.label,
    })
    lastIndex = m.end
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return parts.length ? parts : [{ type: 'text', text }]
}

const BLOCK_OUT_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'TR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'BLOCKQUOTE',
  'TABLE',
  'TBODY',
  'THEAD',
  'TFOOT',
  'TD',
  'TH',
  'SECTION',
  'ARTICLE',
])

/**
 * From HTML (email / depackaged) extract the same link-button parts as {@link extractLinkParts},
 * without emitting raw &lt;a href&gt; in the output tree. Unsafe schemes are dropped to plain text
 * or child-walks.
 */
export function extractLinkPartsFromHtml(html: string): LinkPart[] {
  if (!html || typeof html !== 'string') return [{ type: 'text', text: '' }]
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((el) => el.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
    }
  })

  const out: LinkPart[] = []

  function tryPushLinkFromAbsoluteHref(href: string, linkLabel: string | undefined): boolean {
    const t = href.trim()
    if (!t) return false
    const low = t.toLowerCase()
    if (low.startsWith('javascript:') || low.startsWith('data:') || low.startsWith('vbscript:')) return false
    if (low.startsWith('mailto:') || low.startsWith('tel:')) return false
    const abs = ensureAbsoluteHttpUrlForOpen(
      t.startsWith('//') && /^\/\/[^/]/i.test(t) ? `https:${t}` : t,
    )
    if (!/^https?:\/\//i.test(abs)) return false
    const label = (linkLabel || '').trim()
    out.push({
      type: 'link',
      text: getButtonLabel(abs, label || undefined),
      url: abs,
      label: label || undefined,
    })
    return true
  }

  function mergeTextPush(ps: LinkPart[]) {
    for (const p of ps) {
      if (p.type === 'text' && p.text === '') continue
      const last = out[out.length - 1]
      if (last && last.type === 'text' && p.type === 'text') {
        out[out.length - 1] = { type: 'text', text: last.text + p.text }
      } else {
        out.push(p)
      }
    }
  }

  function walk(n: Node) {
    if (n.nodeType === Node.TEXT_NODE) {
      mergeTextPush(extractLinkParts(n.textContent || ''))
      return
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return
    const el = n as Element
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || ''
      const label = (el.textContent || '').trim()
      if (href && tryPushLinkFromAbsoluteHref(href, label || undefined)) {
        return
      }
      for (const c of el.childNodes) walk(c)
      return
    }
    if (el.tagName === 'BR') {
      mergeTextPush([{ type: 'text', text: '\n' }])
      return
    }
    for (const c of el.childNodes) walk(c)
    if (BLOCK_OUT_TAGS.has(el.tagName)) {
      mergeTextPush([{ type: 'text', text: '\n' }])
    }
  }

  for (const c of Array.from(doc.body.childNodes)) walk(c)

  if (out.length === 0) {
    return extractLinkParts(doc.body.textContent || '')
  }
  return out
}

/** Host/Sandbox shared: prefer HTML body (safe extraction) or plain `body_text` with URL/Markdown detection. */
export function beapInboxMessageBodyToLinkParts(m: { body_html?: string | null; body_text?: string | null }): LinkPart[] {
  const h = m.body_html
  if (h && String(h).trim()) return extractLinkPartsFromHtml(h)
  return extractLinkParts(m.body_text || '(No body)')
}
