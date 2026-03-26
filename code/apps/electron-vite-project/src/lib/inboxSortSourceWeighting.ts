/**
 * Source/type weighting for the shared inbox sort pipeline (Auto-Sort classify).
 * Not separate routing classes — only biases within the same category set.
 */

export type SortSourceWeighting = {
  nativeBeap: boolean
  depackagedEmail: boolean
  handshakeLinked: boolean
}

export function sortSourceWeightingFromMessageRow(row: {
  source_type?: string | null
  handshake_id?: string | null
}): SortSourceWeighting {
  const st = String(row.source_type ?? '')
  const depackagedEmail = st === 'email_plain'
  const nativeBeap = st === 'email_beap' || st === 'direct_beap'
  const hid = row.handshake_id != null ? String(row.handshake_id).trim() : ''
  const handshakeLinked = hid.length > 0 || st === 'direct_beap'
  return { nativeBeap, depackagedEmail, handshakeLinked }
}

/** Short block appended to classify prompts so the model applies the same policy as reconcile. */
export function formatSourceWeightingForPrompt(w: SortSourceWeighting): string {
  const lines: string[] = [
    '## Message origin (weighting only — same categories as always; source is not a verdict by itself)',
  ]
  if (w.handshakeLinked) {
    lines.push(
      '- Handshake-linked: strongly favor visibility and review priority; do not choose archive or pending_delete for borderline cases; handshake is an override-style signal but still respect obvious high-stakes and attachment rules.',
    )
  }
  if (w.nativeBeap) {
    lines.push(
      '- Native BEAP: favor archive/file when content fits; avoid delete-oriented outcomes and disfavor pending_delete unless the message is unmistakably low-value or spam-like; preserve conservatively.',
    )
  }
  if (w.depackagedEmail) {
    lines.push(
      '- Depackaged email: favor pending_review when unsure; be less eager to archive than for Native BEAP; when content looks low-quality, irrelevant, or spam-like, pending_delete is more appropriate than for Native BEAP.',
    )
  }
  if (!w.handshakeLinked && !w.nativeBeap && !w.depackagedEmail) {
    lines.push('- Source type unknown or nonstandard — rely on content and attachments only.')
  }
  return lines.join('\n')
}
