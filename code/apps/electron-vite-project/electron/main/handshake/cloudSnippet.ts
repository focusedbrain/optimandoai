/**
 * Deterministic cloud-safe snippet builder.
 *
 * Pure function: no PII detection, no NLP, no external dependencies.
 * Strips common email cruft and truncates on a word boundary.
 */

const SIGNATURE_SEPARATORS = [
  /^--\s*$/m,
  /^-- $/m,
  /^Best regards/im,
  /^Kind regards/im,
  /^Mit freundlichen Grüßen/im,
  /^Viele Grüße/im,
  /^Regards,/im,
  /^Sincerely,/im,
  /^Cheers,/im,
]

const FORWARDED_BLOCK = /^-{5,}\s*Forwarded message\s*-{5,}/im

export function buildCloudSnippet(input: string, maxBytes: number = 1200): string {
  if (!input) return ''

  let text = input

  // 1. Strip forwarded message blocks (everything after the marker)
  const fwdMatch = FORWARDED_BLOCK.exec(text)
  if (fwdMatch) {
    text = text.slice(0, fwdMatch.index)
  }

  // 2. Strip email signature separators and everything after
  for (const sep of SIGNATURE_SEPARATORS) {
    const match = sep.exec(text)
    if (match) {
      text = text.slice(0, match.index)
    }
  }

  // 3. Remove quoted reply lines (lines starting with ">")
  text = text
    .split('\n')
    .filter(line => !line.trimStart().startsWith('>'))
    .join('\n')

  // 4. Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()

  // 5. Truncate to maxBytes on a word boundary
  const encoder = new TextEncoder()
  const encoded = encoder.encode(text)

  if (encoded.length <= maxBytes) {
    return text
  }

  // Decode only the first maxBytes (may cut a codepoint) then find the last space
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let truncated = decoder.decode(encoded.slice(0, maxBytes))

  // Find last word boundary
  const lastSpace = truncated.lastIndexOf(' ')
  if (lastSpace > 0) {
    truncated = truncated.slice(0, lastSpace)
  }

  // 6. Append ellipsis
  return truncated + '…'
}
