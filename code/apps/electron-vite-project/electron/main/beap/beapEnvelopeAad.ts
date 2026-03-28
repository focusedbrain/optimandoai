/**
 * Canonical AAD for BEAP capsule/artefact AES-GCM — must match
 * `apps/extension-chromium/.../beapCrypto.ts` (`buildEnvelopeAadFields` +
 * `canonicalSerializeAAD` + `stableCanonicalize`).
 *
 * qBEAP encrypts each chunk with `subtle.encrypt({ additionalData: aadBytes })`.
 * Decrypt without the same AAD bytes always fails with a generic WebCrypto error.
 */

export function stableCanonicalize(value: unknown): unknown {
  if (value === null) return null
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    return value.map((item) => stableCanonicalize(item)).filter((item) => item !== undefined)
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const result: Record<string, unknown> = {}
    for (const key of sortedKeys) {
      const canonicalizedValue = stableCanonicalize(obj[key])
      if (canonicalizedValue !== undefined) {
        result[key] = canonicalizedValue
      }
    }
    return result
  }
  return value
}

export function canonicalSerializeAAD(aadFields: Record<string, unknown>): Uint8Array {
  const canonicalized = stableCanonicalize(aadFields)
  const json = JSON.stringify(canonicalized)
  return new TextEncoder().encode(json)
}

/** Mirrors `EnvelopeHeaderForAAD` / `buildEnvelopeAadFields` in extension beapCrypto.ts */
interface EnvelopeHeaderForAAD {
  version: string
  encoding: string
  encryption_mode: string
  timestamp: number
  sender_fingerprint: string
  receiver_fingerprint?: string
  template_hash: string
  policy_hash: string
  content_hash: string
  crypto?: {
    suiteId: string
    salt: string
    handshake_id: string
    senderX25519PublicKeyB64: string
    pq?:
      | false
      | {
          required: boolean
          kem?: string
          kemCiphertextB64?: string
        }
  }
  sizeLimits?: Record<string, unknown>
  processingEvents?: Record<string, unknown>
}

export function buildEnvelopeAadFields(header: EnvelopeHeaderForAAD): Record<string, unknown> {
  const aadFields: Record<string, unknown> = {
    version: header.version,
    encoding: header.encoding,
    encryption_mode: header.encryption_mode,
    timestamp: header.timestamp,
    sender_fingerprint: header.sender_fingerprint,
    template_hash: header.template_hash,
    policy_hash: header.policy_hash,
    content_hash: header.content_hash,
  }

  if (header.receiver_fingerprint !== undefined) {
    aadFields.receiver_fingerprint = header.receiver_fingerprint
  }

  if (header.crypto) {
    aadFields.crypto = {
      suiteId: header.crypto.suiteId,
      salt: header.crypto.salt,
      handshake_id: header.crypto.handshake_id,
      senderX25519PublicKeyB64: header.crypto.senderX25519PublicKeyB64,
    }

    if (header.crypto.pq) {
      ;(aadFields.crypto as Record<string, unknown>).pq = {
        required: header.crypto.pq.required,
        kem: header.crypto.pq.kem,
        kemCiphertextB64: header.crypto.pq.kemCiphertextB64,
      }
    }
  }

  if (header.sizeLimits !== undefined) {
    aadFields.sizeLimits = header.sizeLimits
  }

  if (header.processingEvents !== undefined) {
    aadFields.processingEvents = header.processingEvents
  }

  return aadFields
}

/**
 * Compute the same UTF-8 JSON bytes the extension uses as AES-GCM AAD for
 * capsule chunks and artefacts.
 */
export function computeEnvelopeAadBytes(header: Record<string, unknown>): Uint8Array {
  const aadFields = buildEnvelopeAadFields(header as unknown as EnvelopeHeaderForAAD)
  return canonicalSerializeAAD(aadFields)
}
