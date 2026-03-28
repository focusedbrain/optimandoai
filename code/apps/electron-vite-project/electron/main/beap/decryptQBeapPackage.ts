/**
 * qBEAP package decryption in the Electron main process.
 * Mirrors extension Gate 4 + capsule/artefact decrypt (AES-256-GCM, HKDF-SHA-256)
 * using local BEAP keys stored on `handshakes` (see schema v50).
 */

import { createHash } from 'crypto'
import { webcrypto } from 'crypto'
import { x25519 } from '@noble/curves/ed25519'
import { ml_kem768 } from '@noble/post-quantum/ml-kem'

import { getHandshakeRecord } from '../handshake/db'

const wc = webcrypto as Crypto

export interface DecryptedQBeapContent {
  subject: string
  body: string
  transport_plaintext: string
  attachments: Array<{
    id: string
    filename: string
    contentType: string
    size: number
    bytes: Buffer | null
  }>
  automation?: {
    tags: string[]
    tagSource: string
  }
}

function fromBase64(s: string): Uint8Array {
  return Buffer.from(s, 'base64')
}

async function hkdfDerive(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Promise<Uint8Array> {
  const keyMaterial = await wc.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await wc.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    length * 8,
  )
  return new Uint8Array(bits)
}

async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await wc.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = fromBase64(nonceB64)
  const data = fromBase64(ciphertextB64)
  const decrypted = await wc.subtle.decrypt(
    aad && aad.length > 0
      ? { name: 'AES-GCM', iv, additionalData: aad }
      : { name: 'AES-GCM', iv },
    key,
    data,
  )
  return new Uint8Array(decrypted)
}

async function sha256HexUtf8(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s)
  const hash = await wc.subtle.digest('SHA-256', buf)
  return Buffer.from(hash).toString('hex')
}

function concatByteArrays(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

interface EncryptedChunk {
  index?: number
  nonce: string
  ciphertext: string
}

function getPayloadChunks(payloadEnc: Record<string, unknown>): EncryptedChunk[] | null {
  const ch = payloadEnc.chunking as Record<string, unknown> | undefined
  if (ch?.enabled === true && Array.isArray(ch.chunks)) {
    return ch.chunks as EncryptedChunk[]
  }
  // Canon builder places `chunks` on payloadEnc (not under chunking)
  if (ch?.enabled === true && Array.isArray(payloadEnc.chunks)) {
    return payloadEnc.chunks as EncryptedChunk[]
  }
  if (Array.isArray(payloadEnc.chunks)) {
    return payloadEnc.chunks as EncryptedChunk[]
  }
  return null
}

function getArtefactChunks(enc: Record<string, unknown>): EncryptedChunk[] | null {
  const ch = enc.chunking as Record<string, unknown> | undefined
  if (ch?.enabled === true && Array.isArray(ch.chunks)) {
    return ch.chunks as EncryptedChunk[]
  }
  if (ch?.enabled === true && Array.isArray(enc.chunks)) {
    return enc.chunks as EncryptedChunk[]
  }
  if (Array.isArray(enc.chunks)) {
    return enc.chunks as EncryptedChunk[]
  }
  return null
}

async function decryptChunkSequence(
  key: Uint8Array,
  chunks: EncryptedChunk[],
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const sorted = [...chunks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const parts: Uint8Array[] = []
  for (const chunk of sorted) {
    const plain = await aesGcmDecrypt(key, chunk.nonce, chunk.ciphertext, aad)
    parts.push(plain)
  }
  return concatByteArrays(parts)
}

/**
 * Decrypt a qBEAP JSON package using local keys from the handshake row.
 * @returns null if keys missing, package invalid, or crypto fails.
 */
export async function decryptQBeapPackage(
  packageJson: string,
  handshakeId: string,
  db: unknown,
): Promise<DecryptedQBeapContent | null> {
  if (!db || !handshakeId?.trim()) {
    console.warn('[qBEAP-decrypt] Missing db or handshakeId')
    return null
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(packageJson) as Record<string, unknown>
  } catch {
    console.warn('[qBEAP-decrypt] Invalid package JSON')
    return null
  }

  const header = pkg.header as Record<string, unknown> | undefined
  if (!header || header.encoding !== 'qBEAP') {
    return null
  }

  const hs = getHandshakeRecord(db as any, handshakeId.trim())
  if (!hs) {
    console.warn('[qBEAP-decrypt] Handshake not found:', handshakeId)
    return null
  }

  const localX25519PrivB64 = hs.local_x25519_private_key_b64?.trim()
  const localMlkemSecretB64 = hs.local_mlkem768_secret_key_b64?.trim()

  const cryptoHdr = header.crypto as Record<string, unknown> | undefined
  if (!cryptoHdr) {
    console.warn('[qBEAP-decrypt] No header.crypto')
    return null
  }

  const senderX25519PubB64 =
    typeof cryptoHdr.senderX25519PublicKeyB64 === 'string' ? cryptoHdr.senderX25519PublicKeyB64.trim() : ''
  const saltB64 = typeof cryptoHdr.salt === 'string' ? cryptoHdr.salt.trim() : ''
  const pq = cryptoHdr.pq as Record<string, unknown> | undefined
  const kemCiphertextB64 =
    pq && typeof pq.kemCiphertextB64 === 'string' && pq.kemCiphertextB64.length > 0
      ? pq.kemCiphertextB64.trim()
      : ''

  if (!senderX25519PubB64 || !saltB64) {
    console.warn('[qBEAP-decrypt] Missing sender X25519 public or salt')
    return null
  }

  if (!localX25519PrivB64) {
    console.warn(
      '[qBEAP-decrypt] Missing local X25519 private key for handshake:',
      handshakeId,
      '(re-establish handshake for native qBEAP decrypt)',
    )
    return null
  }

  try {
    const peerPub = fromBase64(senderX25519PubB64)
    const localPriv = fromBase64(localX25519PrivB64)
    if (peerPub.length !== 32 || localPriv.length !== 32) {
      console.warn('[qBEAP-decrypt] Invalid X25519 key length')
      return null
    }

    const x25519Secret = x25519.getSharedSecret(localPriv, peerPub)

    let sharedSecret: Uint8Array
    if (kemCiphertextB64) {
      if (!localMlkemSecretB64) {
        console.warn('[qBEAP-decrypt] Hybrid package requires local ML-KEM secret for handshake:', handshakeId)
        return null
      }
      const ct = fromBase64(kemCiphertextB64)
      const sk = fromBase64(localMlkemSecretB64)
      const mlkemSecret = ml_kem768.decapsulate(ct, sk)
      const hybrid = new Uint8Array(mlkemSecret.length + x25519Secret.length)
      hybrid.set(mlkemSecret, 0)
      hybrid.set(x25519Secret, mlkemSecret.length)
      sharedSecret = hybrid
    } else {
      sharedSecret = x25519Secret
    }

    const saltBytes = fromBase64(saltB64)
    const capsuleKey = await hkdfDerive(sharedSecret, saltBytes, 'BEAP v1 capsule', 32)
    const artefactKey = await hkdfDerive(sharedSecret, saltBytes, 'BEAP v1 artefact', 32)

    const payloadEnc = pkg.payloadEnc as Record<string, unknown> | undefined
    if (!payloadEnc) {
      console.warn('[qBEAP-decrypt] Missing payloadEnc')
      return null
    }

    const chunks = getPayloadChunks(payloadEnc)
    let capsuleJson: string
    if (chunks && chunks.length > 0) {
      const combined = await decryptChunkSequence(capsuleKey, chunks)
      capsuleJson = new TextDecoder().decode(combined)
    } else {
      const nonce = payloadEnc.nonce
      const ctext = payloadEnc.ciphertext
      if (typeof nonce !== 'string' || typeof ctext !== 'string') {
        console.warn('[qBEAP-decrypt] Missing payloadEnc nonce/ciphertext')
        return null
      }
      const plain = await aesGcmDecrypt(capsuleKey, nonce, ctext)
      capsuleJson = new TextDecoder().decode(plain)
    }

    if (typeof payloadEnc.sha256Plain === 'string' && payloadEnc.sha256Plain.trim()) {
      const actual = await sha256HexUtf8(capsuleJson)
      if (actual.toLowerCase() !== payloadEnc.sha256Plain.trim().toLowerCase()) {
        console.warn('[qBEAP-decrypt] Capsule sha256Plain mismatch')
        return null
      }
    }

    let capsule: Record<string, unknown>
    try {
      capsule = JSON.parse(capsuleJson) as Record<string, unknown>
    } catch {
      console.warn('[qBEAP-decrypt] Capsule JSON parse failed')
      return null
    }

    const subject = typeof capsule.subject === 'string' ? capsule.subject : typeof capsule.title === 'string' ? capsule.title : ''
    const body =
      typeof capsule.body === 'string'
        ? capsule.body
        : capsule.body && typeof capsule.body === 'object'
          ? JSON.stringify(capsule.body)
          : ''
    const transport_plaintext = typeof capsule.transport_plaintext === 'string' ? capsule.transport_plaintext : ''

    const decryptedAttachments: DecryptedQBeapContent['attachments'] = []
    const artefactsEnc = pkg.artefactsEnc
    if (Array.isArray(artefactsEnc)) {
      for (const raw of artefactsEnc) {
        const enc = raw as Record<string, unknown>
        try {
          const achunks = getArtefactChunks(enc)
          let decBytes: Uint8Array
          if (achunks && achunks.length > 0) {
            decBytes = await decryptChunkSequence(artefactKey, achunks)
          } else if (typeof enc.nonce === 'string' && typeof enc.ciphertext === 'string') {
            decBytes = await aesGcmDecrypt(artefactKey, enc.nonce, enc.ciphertext)
          } else {
            continue
          }

          const attachmentId =
            typeof enc.attachmentId === 'string'
              ? enc.attachmentId
              : typeof enc.id === 'string'
                ? enc.id
                : `att-${Date.now()}`
          const metaList = Array.isArray(capsule.attachments) ? capsule.attachments : []
          const meta = metaList.find((a: unknown) => {
            if (!a || typeof a !== 'object') return false
            const o = a as Record<string, unknown>
            return o.id === attachmentId || o.encryptedRef === attachmentId
          }) as Record<string, unknown> | undefined

          const filename = String(
            meta?.originalName ?? meta?.filename ?? meta?.name ?? enc.filename ?? 'attachment',
          ).slice(0, 500)
          const contentType = String(
            meta?.originalType ?? meta?.mimeType ?? enc.mime ?? 'application/octet-stream',
          ).slice(0, 200)
          const size =
            typeof meta?.originalSize === 'number'
              ? meta.originalSize
              : typeof enc.bytesPlain === 'number'
                ? enc.bytesPlain
                : decBytes.length

          decryptedAttachments.push({
            id: attachmentId,
            filename,
            contentType,
            size,
            bytes: Buffer.from(decBytes),
          })
        } catch (e) {
          console.warn('[qBEAP-decrypt] Artefact decrypt failed:', (e as Error)?.message ?? e)
        }
      }
    }

    let automation: DecryptedQBeapContent['automation']
    const auto = capsule.automation as Record<string, unknown> | undefined
    if (auto && Array.isArray(auto.tags)) {
      automation = {
        tags: (auto.tags as unknown[]).filter((t): t is string => typeof t === 'string'),
        tagSource: typeof auto.tagSource === 'string' ? auto.tagSource : 'encrypted',
      }
    }

    console.log('[qBEAP-decrypt] Success', {
      handshakeId,
      subjectLen: subject.length,
      bodyLen: body.length,
      attachments: decryptedAttachments.length,
    })

    return {
      subject,
      body,
      transport_plaintext,
      attachments: decryptedAttachments,
      automation,
    }
  } catch (e) {
    console.error('[qBEAP-decrypt] Decryption failed:', (e as Error)?.message ?? e)
    return null
  }
}
