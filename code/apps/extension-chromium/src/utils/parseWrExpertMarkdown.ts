/**
 * Maps WR Expert .md uploads into structured detection hints only (not raw prompt injection).
 */

export interface WrExpertParsedProfile {
  emphasis: { terms: string[]; entityHints: string[] }
  deemphasis: { terms: string[] }
  /** Present after upload; optional for persisted rows before re-save. */
  fileSha256?: string
}

const MAX_EMPHASIS = 40
const MAX_DEEMPHASIS = 40
const MAX_ENTITY = 20

export function parseWrExpertMarkdown(markdown: string): WrExpertParsedProfile {
  const terms: string[] = []
  const deemphasisTerms: string[] = []
  const entityHints: string[] = []
  let section: 'emphasis' | 'deemphasis' | 'entity' | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)\s*$/)
    if (heading) {
      const title = heading[1].trim().toLowerCase()
      if (/emphas|focus|priorit|detection|topics?/.test(title)) section = 'emphasis'
      else if (/ignore|deprior|skip|noise|boilerplate/.test(title)) section = 'deemphasis'
      else if (/entity|entities|names?/.test(title)) section = 'entity'
      else section = null
      continue
    }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    if (bullet && section) {
      const t = bullet[1].trim()
      if (!t) continue
      if (section === 'emphasis') terms.push(t)
      else if (section === 'deemphasis') deemphasisTerms.push(t)
      else entityHints.push(t)
    }
  }

  const cap = (arr: string[], n: number) => arr.slice(0, n)

  return {
    emphasis: {
      terms: cap(terms, MAX_EMPHASIS),
      entityHints: cap(entityHints, MAX_ENTITY),
    },
    deemphasis: { terms: cap(deemphasisTerms, MAX_DEEMPHASIS) },
  }
}

export async function sha256HexUtf8(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
