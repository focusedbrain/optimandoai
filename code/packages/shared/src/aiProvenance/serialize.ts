import type { AiProvenance } from './types'
import { AI_CARRIER_ONLY_SCHEME, AI_VISIBLE_LABEL_LINE } from './types'

function toBase64Utf8(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64')
  }
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

/** Compact JSON → base64 for MIME / meta carriers. */
export function encodeProvenancePayload(p: AiProvenance): string {
  return toBase64Utf8(JSON.stringify(p))
}

export function decodeProvenancePayload(b64: string): AiProvenance | null {
  try {
    let json: string
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(b64, 'base64').toString('utf8')
    } else {
      json = new TextDecoder().decode(
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      )
    }
    const parsed = JSON.parse(json) as AiProvenance
    if (parsed?.synthetic !== true || parsed.marking_scheme !== 'optirando-prov/1') return null
    return parsed
  } catch {
    return null
  }
}

/** MIME headers for outbound email (Layer A). */
export function serializeForMime(p: AiProvenance): Record<string, string> {
  return {
    'X-AI-Generated': 'true',
    'X-AI-Provenance': encodeProvenancePayload(p),
  }
}

/** HTML meta tags fragment (Layer A carrier for clipboard HTML / print). */
export function serializeForHtmlMeta(p: AiProvenance): string {
  const encoded = encodeProvenancePayload(p)
  return (
    `<meta name="ai-generated" content="true">\n` +
    `<meta name="ai-provenance" content="${encoded}">`
  )
}

/** Visible single-line label for clipboard / body (Layer B). */
export function withVisibleAiLabel(body: string, label: string = AI_VISIBLE_LABEL_LINE): string {
  const t = body ?? ''
  if (t.startsWith(label)) return t
  return `${label}\n${t}`
}

/** Whether Layer A MIME headers should be applied (editorial exemption skips visible label, not MIME). */
export function shouldApplyMachineMarking(p: AiProvenance | null | undefined): boolean {
  if (!p) return false
  return p.origin === 'ai' || p.origin === 'mixed'
}

/** Visible send-time label default ON unless editorial responsibility claimed. */
export function shouldApplyVisibleSendLabel(p: AiProvenance | null | undefined): boolean {
  if (!p) return false
  if (p.editorial_responsible) return false
  return p.origin === 'ai' || p.origin === 'mixed'
}

/** Build a minimal HTML document for clipboard text/html flavor. */
export function buildClipboardHtml(plainBody: string, p: AiProvenance): string {
  const labelled = withVisibleAiLabel(plainBody)
  const escaped = labelled
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">\n` +
    `${serializeForHtmlMeta(p)}\n` +
    `</head><body><pre>${escaped}</pre></body></html>`
  )
}

/** HTML meta for AI-labelled content without generation-time provenance (legacy / absent). */
export function buildCarrierOnlyHtmlMeta(): string {
  return (
    `<meta name="ai-generated" content="true">\n` +
    `<meta name="ai-provenance-scheme" content="${AI_CARRIER_ONLY_SCHEME}">`
  )
}

/** Clipboard HTML when no generation provenance is available — not a fabricated AiProvenance. */
export function buildCarrierOnlyClipboardHtml(plainBody: string): string {
  const labelled = withVisibleAiLabel(plainBody)
  const escaped = labelled
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8">\n` +
    `${buildCarrierOnlyHtmlMeta()}\n` +
    `</head><body><pre>${escaped}</pre></body></html>`
  )
}
