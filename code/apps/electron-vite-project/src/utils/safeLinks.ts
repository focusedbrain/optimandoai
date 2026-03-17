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

/** Derive a readable button label from URL or context */
export function getButtonLabel(url: string, hint?: string): string {
  if (hint && hint.length > 0 && hint.length < 60) return hint
  const lower = url.toLowerCase()
  if (lower.includes('article') || lower.includes('/blog/') || lower.includes('/post/')) return 'Open article'
  if (lower.includes('docs') || lower.includes('readme')) return 'View source'
  return 'Open link'
}

/** Extract link parts from plain text for rendering as text + buttons */
export function extractLinkParts(text: string): LinkPart[] {
  if (!text || typeof text !== 'string') return [{ type: 'text', text: '' }]
  const parts: LinkPart[] = []
  let lastIndex = 0

  // Process placeholders first ({{LINK_BUTTON:label|url}} or {{LINK_BUTTON:url}})
  const placeholderMatches = [...text.matchAll(PLACEHOLDER_RE)]
  const urlMatches = [...text.matchAll(URL_RE)]

  // Merge and sort all matches by index
  interface Match {
    index: number
    end: number
    url: string
    label?: string
  }
  const matches: Match[] = []

  for (const m of placeholderMatches) {
    const raw = m[1].trim()
    const pipe = raw.indexOf('|')
    const label = pipe >= 0 ? raw.slice(0, pipe).trim() : undefined
    const url = pipe >= 0 ? raw.slice(pipe + 1).trim() : raw
    if (url) matches.push({ index: m.index!, end: m.index! + m[0].length, url, label })
  }

  for (const m of urlMatches) {
    const url = m[0]
    const idx = m.index!
    const overlapping = matches.some((x) => idx >= x.index && idx < x.end)
    if (!overlapping) matches.push({ index: idx, end: idx + url.length, url })
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
