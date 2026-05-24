/**
 * Build payloads for POST /api/inbox/merge-depackaged (Electron inbox) from Stage-5 sanitised packages.
 * Local-only: decrypted content never leaves the device except to the desktop inbox DB on localhost.
 *
 * Phase B, PR B-8: mergeDepackagedToElectron moved here and exported so all
 * ingestion paths (P2P queue, file import, messenger import) can write through
 * Electron main's sealed-storage gate rather than mutating the renderer store
 * directly.
 */

import type { SanitisedDecryptedPackage } from '../beap-messages/sandbox/sandboxProtocol'

export interface ElectronMergeDepackagedPayload {
  beap_package_json: string
  handshake_id: string
  /**
   * PR 5.1 / Decision A: canonical capsule plaintext — byte-equivalent to the
   * plaintext the Validator approved. Fields: subject, body, transport_plaintext,
   * attachments, automation, session_import_artefact (when present).
   */
  depackaged_json: string
  /**
   * PR 5.1 / Decision B: wrapper metadata (format, source, verifiedAt) separated
   * from the validated content.
   */
  depackaged_metadata: string
  body_text: string
  attachments: Array<{
    content_id: string
    filename: string
    content_type: string
    size_bytes: number
    base64?: string | null
  }>
}

export function buildElectronMergePayload(
  packageJson: string,
  handshakeId: string,
  pkg: SanitisedDecryptedPackage,
): ElectronMergeDepackagedPayload {
  const transport = (pkg.capsule.transport_plaintext ?? '').trim()
  const inner = (pkg.capsule.body ?? '').trim()
  const title = pkg.capsule.subject ?? ''

  // PR 5.1 / Decision A: canonical plaintext — include all fields the Builder produced.
  // session_import_artefact lives on capsule at runtime (not on the TypeScript type).
  const sessionImportArtefact =
    ((pkg.capsule as unknown as Record<string, unknown>).session_import_artefact as
      | Record<string, unknown>
      | null
      | undefined) ?? null

  const canonicalContent: Record<string, unknown> = {
    subject: title,
    body: inner,
    transport_plaintext: transport,
    attachments: pkg.capsule.attachments ?? [],
    automation: pkg.capsule.automation,
  }
  if (pkg.capsule.audit_notice != null) canonicalContent.audit_notice = pkg.capsule.audit_notice
  if (pkg.capsule.normalized_url_refs != null)
    canonicalContent.normalized_url_refs = pkg.capsule.normalized_url_refs
  if (pkg.capsule.has_authoritative_encrypted != null)
    canonicalContent.has_authoritative_encrypted = pkg.capsule.has_authoritative_encrypted
  if (sessionImportArtefact != null)
    canonicalContent.session_import_artefact = sessionImportArtefact

  const depackaged_json = JSON.stringify(canonicalContent)

  // PR 5.1 / Decision B: operational wrapper metadata.
  const depackaged_metadata = JSON.stringify({
    format: 'beap_message_electron_extension_sync',
    encoding: pkg.header.encoding,
    source: 'extension_stage5',
    verifiedAt: pkg.verifiedAt,
    ...(pkg.metadata?.inbox_response_path
      ? { inbox_response_path: pkg.metadata.inbox_response_path }
      : {}),
  })

  const body_text = [title, transport, inner].filter(Boolean).join('\n\n').slice(0, 120_000)

  const attachments: ElectronMergeDepackagedPayload['attachments'] = []
  for (const a of pkg.capsule.attachments ?? []) {
    const art = pkg.artefacts.find((x) => x.class === 'original' && x.attachmentId === a.id)
    attachments.push({
      content_id: a.id,
      filename: a.originalName,
      content_type: a.originalType,
      size_bytes: a.originalSize,
      base64: art?.base64 ?? null,
    })
  }

  console.log('[MERGE] Building merge payload:', {
    hasDepackagedJson: !!depackaged_json,
    depackagedJsonLength: depackaged_json.length,
    bodyTextLength: body_text.length,
    attachmentCount: attachments.length,
    hasBase64: attachments.some((a) => !!a.base64 && a.base64.length > 0),
  })

  return {
    beap_package_json: packageJson,
    handshake_id: handshakeId,
    depackaged_json,
    depackaged_metadata,
    body_text,
    attachments,
  }
}

/**
 * Push Stage-5 decrypted content to Electron main's sealed inbox DB.
 *
 * Sends `ELECTRON_INBOX_MERGE_DEPACKAGED` via the Chrome background script,
 * which forwards to `POST /api/inbox/merge-depackaged` — the sealed write
 * path implemented in PR B-5 (`mergeExtensionDepackaged.ts`).
 *
 * Returns `{ ok: true }` when main accepted and sealed the row, or
 * `{ ok: false, error }` on any failure.
 */
export function mergeDepackagedToElectron(
  packageJson: string,
  handshakeId: string,
  pkg: SanitisedDecryptedPackage,
): Promise<{ ok: boolean; error?: string }> {
  const payload = buildElectronMergePayload(packageJson, handshakeId, pkg)
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'ELECTRON_INBOX_MERGE_DEPACKAGED', payload },
        (response: { ok?: boolean; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          resolve(response ?? { ok: false, error: 'no response' })
        },
      )
    } catch (e) {
      reject(e)
    }
  })
}
