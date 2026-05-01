/**
 * Build payloads for POST /api/inbox/merge-depackaged (Electron inbox) from Stage-5 sanitised packages.
 * Local-only: decrypted content never leaves the device except to the desktop inbox DB on localhost.
 */

import type { SanitisedDecryptedPackage } from '../beap-messages/sandbox/sandboxProtocol'

export interface ElectronMergeDepackagedPayload {
  beap_package_json: string
  handshake_id: string
  depackaged_json: string
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

  const depackaged_json = JSON.stringify({
    schema_version: '1.0.0',
    format: 'beap_message_electron_extension_sync',
    encoding: pkg.header.encoding,
    subject: title,
    transport_plaintext: transport,
    body: { text: inner },
    metadata: {
      source: 'extension_stage5',
      verifiedAt: pkg.verifiedAt,
      ...(pkg.metadata?.inbox_response_path ? { inbox_response_path: pkg.metadata.inbox_response_path } : {}),
    },
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
    body_text,
    attachments,
  }
}
