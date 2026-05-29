/**
 * Test-only helpers — historical main-process pBEAP depackage shapes (PR 5.1 / 2.1).
 * Production untrusted depackage must use dispatchDepackageQBeap → pod only.
 * Not imported from production code under electron/main (enforced by CI gate).
 */

export interface InboxRowFallback {
  id: string
  subject: string | null
  from_address: string | null
  body_text: string | null
}

export interface BeapDepackagedPair {
  depackaged_json: string | null
  depackaged_metadata: string
}

export function beapPackageToMainProcessDepackaged(
  packageJson: string,
  fallback: InboxRowFallback,
): BeapDepackagedPair {
  const emailSubject = fallback.subject ?? ''
  const from = fallback.from_address ?? ''
  const bodyExcerpt = (fallback.body_text ?? '').slice(0, 12_000)

  const baseError = (reason: string): BeapDepackagedPair => ({
    depackaged_json: null,
    depackaged_metadata: JSON.stringify({
      format: 'beap_main_process_error',
      error_reason: reason,
      header: { subject: emailSubject, from },
      body_excerpt: bodyExcerpt,
      source: 'main_process_pending_beap',
      note: 'Could not extract BEAP structure; email fields retained for context.',
    }),
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(packageJson.trim())
  } catch {
    return baseError('invalid_json')
  }

  if (!parsed || typeof parsed !== 'object') {
    return baseError('not_object')
  }

  const p = parsed as Record<string, unknown>

  if (typeof p.schema_version === 'number' && typeof p.capsule_type === 'string') {
    return {
      depackaged_json: null,
      depackaged_metadata: JSON.stringify({
        format: 'beap_handshake_capsule_email',
        capsule_type: p.capsule_type,
        capsule_schema_version: p.schema_version,
        header: { subject: emailSubject, from },
        body_excerpt: bodyExcerpt,
        capsule_keys: Object.keys(p).slice(0, 40),
        source: 'main_process_pending_beap',
        note: 'Handshake capsule from email; cryptographic processing may still run in extension. Structural preview for inbox.',
      }),
    }
  }

  const header = p.header as Record<string, unknown> | undefined
  if (!header || typeof header !== 'object') {
    return baseError('missing_header')
  }

  const encoding = header.encoding
  const senderFingerprint =
    typeof header.sender_fingerprint === 'string' ? header.sender_fingerprint : undefined
  const contentHash = typeof header.content_hash === 'string' ? header.content_hash : undefined
  const version = header.version

  if (encoding === 'pBEAP' && typeof p.payload === 'string') {
    try {
      const capsuleJson = Buffer.from(p.payload, 'base64').toString('utf8')
      return {
        depackaged_json: capsuleJson,
        depackaged_metadata: JSON.stringify({
          format: 'beap_message_main_process',
          encoding: 'pBEAP',
          trust_note:
            'Public pBEAP payload decoded in main process without Stage-5 sandbox signature / gate verification.',
          header_from: from,
          sender_fingerprint: senderFingerprint,
          source: 'main_process_pending_beap',
          decoded_at: new Date().toISOString(),
        }),
      }
    } catch {
      // fall through to metadata-only paths below
    }
  }

  if (encoding === 'qBEAP') {
    return {
      depackaged_json: null,
      depackaged_metadata: JSON.stringify({
        format: 'beap_qbeap_pending_main',
        encoding: 'qBEAP',
        header_summary: { sender_fingerprint: senderFingerprint, content_hash: contentHash, version },
        email_fallback_header: { subject: emailSubject, from },
        source: 'main_process_pending_beap',
        note: 'qBEAP requires extension sandbox and keys; email excerpt retained for search/context.',
      }),
    }
  }

  return {
    depackaged_json: null,
    depackaged_metadata: JSON.stringify({
      format: 'beap_message_main_process_partial',
      encoding: typeof encoding === 'string' ? encoding : 'unknown',
      header_summary: { sender_fingerprint: senderFingerprint, content_hash: contentHash, version },
      body_excerpt: bodyExcerpt,
      source: 'main_process_pending_beap',
      note: 'Unrecognised BEAP message shape for main-process decode; email fields retained.',
    }),
  }
}

/** Test-only pBEAP capsule extract (production uses pod depackager). */
export function extractPBeapCapsule(packageJson: string): unknown | null {
  try {
    const pkg = JSON.parse(packageJson.trim()) as Record<string, unknown>
    const header = pkg.header as Record<string, unknown> | undefined
    if (header?.encoding !== 'pBEAP') return null
    if (typeof pkg.payload !== 'string') return null
    const capsuleJson = Buffer.from(pkg.payload, 'base64').toString('utf8')
    return JSON.parse(capsuleJson)
  } catch {
    return null
  }
}
