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
import { computeEnvelopeAadBytes } from './beapEnvelopeAad'

const wc = webcrypto as Crypto

/** Set `WR_QBEAP_DECRYPT_DEBUG=1` for hex previews and full HKDF inner-envelope derivation logs. */
const QBEAP_DBG = process.env.WR_QBEAP_DECRYPT_DEBUG === '1'

function hexPreview(u8: Uint8Array, maxBytes = 8): string {
  return Buffer.from(u8).toString('hex').slice(0, maxBytes * 2) + '...'
}

/** HKDF labels — must match extension / sender exactly. */
const HKDF_CAPSULE = 'BEAP v1 capsule'
const HKDF_ARTEFACT = 'BEAP v1 artefact'
const HKDF_INNER_ENVELOPE = 'BEAP v2 inner-envelope'

function logGcmDecryptInputs(label: string, nonceB64: string, ciphertextB64: string, tagB64?: string) {
  let nonceBytes: Buffer
  let ciphertextBytes: Buffer
  try {
    nonceBytes = Buffer.from(fromBase64(nonceB64))
    ciphertextBytes = Buffer.from(fromBase64(ciphertextB64))
  } catch {
    console.warn('[qBEAP-decrypt] AES-GCM input (decode failed):', label)
    return
  }
  console.log(`[qBEAP-decrypt] AES-GCM input (${label}):`, {
    nonceLen: nonceBytes.length,
    ciphertextLen: ciphertextBytes.length,
    nonceHex: QBEAP_DBG ? nonceBytes.toString('hex') : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
    ciphertextStart: QBEAP_DBG ? ciphertextBytes.toString('hex').substring(0, 32) + '...' : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
  })
  if (nonceBytes.length !== 12) {
    console.error('[qBEAP-decrypt] NONCE LENGTH WRONG:', label, nonceBytes.length, 'expected 12')
  }
  if (tagB64 && String(tagB64).trim()) {
    try {
      const tagBytes = Buffer.from(fromBase64(String(tagB64).trim()))
      console.log('[qBEAP-decrypt] SEPARATE TAG:', label, 'length:', tagBytes.length)
    } catch {
      /* ignore */
    }
  }
}

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

/**
 * AES-256-GCM decrypt. WebCrypto expects the 16-byte auth tag appended to ciphertext.
 * If the package stores tag separately (`tag` / `authTag` base64), it is concatenated after ciphertext bytes.
 */
async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  nonceB64: string,
  ciphertextB64: string,
  aad?: Uint8Array,
  tagB64?: string,
): Promise<Uint8Array> {
  const key = await wc.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const iv = fromBase64(nonceB64)
  let data = Buffer.from(fromBase64(ciphertextB64))
  if (tagB64 && String(tagB64).trim()) {
    const tag = fromBase64(String(tagB64).trim())
    data = Buffer.concat([data, Buffer.from(tag)])
  }
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
  tag?: string
  authTag?: string
  gcmTag?: string
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
    const tagExtra =
      typeof chunk.tag === 'string'
        ? chunk.tag
        : typeof chunk.authTag === 'string'
          ? chunk.authTag
          : typeof chunk.gcmTag === 'string'
            ? chunk.gcmTag
            : undefined
    const plain = await aesGcmDecrypt(key, chunk.nonce, chunk.ciphertext, aad, tagExtra)
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

  const receiverX25519InHeader =
    typeof cryptoHdr.receiverX25519PublicKeyB64 === 'string' ? cryptoHdr.receiverX25519PublicKeyB64.trim() : ''
  const receiverMlkemInHeader =
    pq && typeof pq.receiverMlkemPublicKeyB64 === 'string' ? pq.receiverMlkemPublicKeyB64.trim() : ''

  const peLog = pkg.payloadEnc as Record<string, unknown> | undefined
  const chLog = peLog?.chunking as Record<string, unknown> | undefined
  console.log(
    '[qBEAP-decrypt] Package header.crypto:',
    JSON.stringify({
      hasPq: !!pq,
      kemCiphertextLen: kemCiphertextB64.length,
      senderX25519Len: senderX25519PubB64.length,
      saltLen: saltB64.length,
      hasPayloadEnc: !!peLog,
      payloadNonceLen: typeof peLog?.nonce === 'string' ? peLog.nonce.length : 0,
      payloadCiphertextLen: typeof peLog?.ciphertext === 'string' ? peLog.ciphertext.length : 0,
      hasChunking: !!(chLog && Array.isArray(chLog.chunks)),
      chunkCount: Array.isArray(chLog?.chunks) ? (chLog.chunks as unknown[]).length : 0,
      topLevelChunkCount: Array.isArray(peLog?.chunks) ? (peLog.chunks as unknown[]).length : 0,
      artefactCount: Array.isArray(pkg.artefactsEnc) ? pkg.artefactsEnc.length : 0,
      hasInnerEnvelope: typeof (pkg as Record<string, unknown>).innerEnvelopeCiphertext === 'string',
      hasSeparatePayloadTag: !!(peLog && (typeof peLog.tag === 'string' || typeof peLog.authTag === 'string')),
    }),
  )

  console.log('[qBEAP-decrypt] Key material:', {
    hasLocalX25519Priv: !!localX25519PrivB64,
    localX25519PrivLen: localX25519PrivB64?.length,
    hasLocalMlkemSecret: !!localMlkemSecretB64,
    localMlkemSecretLen: localMlkemSecretB64?.length,
    peerX25519PubLen: hs.peer_x25519_public_key_b64?.length,
    peerMlkemPubLen: hs.peer_mlkem768_public_key_b64?.length,
  })
  // === DIAGNOSTIC: Compare sender's peer key to our local key ===
  // The sender encrypted using their peer_x25519_public_key_b64 for us
  // which should equal our local_x25519_public_key_b64.
  // The sender put their OWN device public key in the header.
  // We don't have the sender's peer_* here, but we can check what
  // the sender SHOULD have used by looking at our own local public key
  // and the handshake state.
  console.log('[qBEAP-decrypt] KEY IDENTITY CHECK:', JSON.stringify({
    ourLocalX25519Pub: hs.local_x25519_public_key_b64?.substring(0, 24),
    ourLocalX25519PrivExists: !!hs.local_x25519_private_key_b64,
    ourLocalMlkemPub: hs.local_mlkem768_public_key_b64?.substring(0, 24),
    ourLocalMlkemSecExists: !!hs.local_mlkem768_secret_key_b64,
    theirPeerX25519Pub: hs.peer_x25519_public_key_b64?.substring(0, 24),
    theirPeerMlkemPub: hs.peer_mlkem768_public_key_b64?.substring(0, 24),
    headerSenderX25519: senderX25519PubB64 ? senderX25519PubB64.substring(0, 24) : undefined,
    handshakeId,
    ourRole: hs.local_role || (hs as { role?: string }).role || 'unknown',
  }))
  console.log('[qBEAP-decrypt] Key match check:', {
    receiverX25519InHeader: receiverX25519InHeader ? `${receiverX25519InHeader.slice(0, 12)}…` : 'NOT IN HEADER',
    ourLocalX25519PubLen: hs.local_x25519_public_key_b64?.length,
    x25519Match:
      receiverX25519InHeader && hs.local_x25519_public_key_b64
        ? receiverX25519InHeader === hs.local_x25519_public_key_b64.trim()
        : null,
    receiverMlkemInHeader: receiverMlkemInHeader ? `${receiverMlkemInHeader.slice(0, 12)}…` : 'NOT IN HEADER',
    ourLocalMlkemPubLen: hs.local_mlkem768_public_key_b64?.length,
    mlkemMatch:
      receiverMlkemInHeader && hs.local_mlkem768_public_key_b64
        ? receiverMlkemInHeader === hs.local_mlkem768_public_key_b64.trim()
        : null,
  })

  // ── Receiver-side identity check ────────────────────────────────────────────
  // The sender's key in the header MUST match what we recorded as our peer's key
  // when the handshake was established. Any mismatch means ECDH will produce a
  // wrong shared secret → AES-GCM auth tag will never verify. Hard-reject now
  // so the error is deterministic and the log is actionable.
  {
    const hsPeerX25519 = hs.peer_x25519_public_key_b64?.trim() ?? ''
    const match = hsPeerX25519 && senderX25519PubB64
      ? hsPeerX25519 === senderX25519PubB64
      : null
    console.log('[qBEAP-decrypt] RECEIVER KEY CHECK:', JSON.stringify({
      handshakeId,
      hsPeerX25519: hsPeerX25519.substring(0, 24) || 'NULL',
      headerSenderX25519: senderX25519PubB64.substring(0, 24) || 'NULL',
      match,
    }))
    if (hsPeerX25519 && senderX25519PubB64 && !match) {
      console.error(
        '[qBEAP-decrypt] ERR_HEADER_SENDER_KEY_MISMATCH:',
        'header.senderX25519 ≠ hs.peer_x25519. ECDH would produce wrong shared secret.',
        'Re-establish handshake to resync peer keys.',
        { handshakeId, hsPeerX25519Prefix: hsPeerX25519.substring(0, 24), headerPrefix: senderX25519PubB64.substring(0, 24) },
      )
      return null
    }
  }

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

  let cryptoStep = 'init'
  try {
    cryptoStep = 'x25519-load'
    const peerPub = fromBase64(senderX25519PubB64)
    const localPriv = fromBase64(localX25519PrivB64)
    if (peerPub.length !== 32 || localPriv.length !== 32) {
      console.warn('[qBEAP-decrypt] Invalid X25519 key length')
      return null
    }

    cryptoStep = 'x25519-dh'
    const x25519Secret = x25519.getSharedSecret(localPriv, peerPub)
    console.log('[qBEAP-decrypt] X25519 result:', {
      secretLength: x25519Secret.length,
      secretHex: QBEAP_DBG ? hexPreview(x25519Secret) : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
    })

    let sharedSecret: Uint8Array
    if (kemCiphertextB64) {
      if (!localMlkemSecretB64) {
        console.warn('[qBEAP-decrypt] Hybrid package requires local ML-KEM secret for handshake:', handshakeId)
        return null
      }
      cryptoStep = 'mlkem-decapsulate'
      const ct = fromBase64(kemCiphertextB64)
      const sk = fromBase64(localMlkemSecretB64)
      const mlkemSecret = ml_kem768.decapsulate(ct, sk)
      console.log('[qBEAP-decrypt] ML-KEM decapsulate result:', {
        secretLength: mlkemSecret.length,
        secretHex: QBEAP_DBG ? hexPreview(mlkemSecret) : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
      })
      cryptoStep = 'hybrid-concat'
      const hybrid = new Uint8Array(mlkemSecret.length + x25519Secret.length)
      hybrid.set(mlkemSecret, 0)
      hybrid.set(x25519Secret, mlkemSecret.length)
      sharedSecret = hybrid
      console.log('[qBEAP-decrypt] Hybrid secret (ML-KEM || X25519):', {
        length: hybrid.length,
        hex: QBEAP_DBG ? hexPreview(hybrid, 16) : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
      })
    } else {
      sharedSecret = x25519Secret
      console.log('[qBEAP-decrypt] X25519-only shared secret (no PQ ciphertext), length:', sharedSecret.length)
    }

    cryptoStep = 'hkdf'
    const saltBytes = fromBase64(saltB64)
    const capsuleKey = await hkdfDerive(sharedSecret, saltBytes, HKDF_CAPSULE, 32)
    const artefactKey = await hkdfDerive(sharedSecret, saltBytes, HKDF_ARTEFACT, 32)
    const innerEnvelopeKey = await hkdfDerive(sharedSecret, saltBytes, HKDF_INNER_ENVELOPE, 32)
    console.log('[qBEAP-decrypt] Derived keys:', {
      capsuleKeyLen: capsuleKey.length,
      artefactKeyLen: artefactKey.length,
      innerEnvelopeKeyLen: innerEnvelopeKey.length,
      capsuleKeyHex: QBEAP_DBG ? hexPreview(capsuleKey) : '(set WR_QBEAP_DECRYPT_DEBUG=1)',
      hkdfLabels: [HKDF_CAPSULE, HKDF_ARTEFACT, HKDF_INNER_ENVELOPE],
    })
    void innerEnvelopeKey

    /** Per canon A.3.054.10 — same bytes as extension `encryptCapsulePayloadChunked` / `encryptChunks` AAD. */
    let envelopeAadBytes: Uint8Array | undefined
    try {
      const aad = computeEnvelopeAadBytes(header as Record<string, unknown>)
      envelopeAadBytes = aad.length > 0 ? aad : undefined
      console.log('[qBEAP-decrypt] Envelope AAD length:', aad.length)
    } catch (e) {
      console.warn('[qBEAP-decrypt] computeEnvelopeAadBytes failed:', (e as Error)?.message ?? e)
    }

    const payloadEnc = pkg.payloadEnc as Record<string, unknown> | undefined
    if (!payloadEnc) {
      console.warn('[qBEAP-decrypt] Missing payloadEnc')
      return null
    }

    const chunks = getPayloadChunks(payloadEnc)
    let capsuleJson: string
    if (chunks && chunks.length > 0) {
      const sorted = [...chunks].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const c0 = sorted[0] as EncryptedChunk & Record<string, unknown>
      const c0tag =
        typeof c0.tag === 'string'
          ? c0.tag
          : typeof c0.authTag === 'string'
            ? c0.authTag
            : typeof c0.gcmTag === 'string'
              ? c0.gcmTag
              : undefined
      console.log(
        '[qBEAP-decrypt] Chunk 0 structure:',
        JSON.stringify({
          hasNonce: !!c0.nonce,
          nonceLen: typeof c0.nonce === 'string' ? c0.nonce.length : 0,
          hasCiphertext: !!c0.ciphertext,
          ciphertextLen: typeof c0.ciphertext === 'string' ? c0.ciphertext.length : 0,
          hasTag: !!c0.tag,
          tagLen: typeof c0.tag === 'string' ? c0.tag.length : 0,
          hasAuthTag: !!c0.authTag,
          authTagLen: typeof c0.authTag === 'string' ? c0.authTag.length : 0,
          hasSha256Cipher: !!c0.sha256Cipher,
          index: c0.index,
          allKeys: c0 && typeof c0 === 'object' ? Object.keys(c0) : [],
        }),
      )
      cryptoStep = 'aes-gcm-capsule-chunks'
      logGcmDecryptInputs('capsule-chunk-0', c0.nonce, c0.ciphertext, c0tag)
      const combined = await decryptChunkSequence(capsuleKey, chunks, envelopeAadBytes)
      capsuleJson = new TextDecoder().decode(combined)
    } else {
      const nonce = payloadEnc.nonce
      const ctext = payloadEnc.ciphertext
      if (typeof nonce !== 'string' || typeof ctext !== 'string') {
        console.warn('[qBEAP-decrypt] Missing payloadEnc nonce/ciphertext')
        return null
      }
      const tagB64 =
        typeof payloadEnc.tag === 'string'
          ? payloadEnc.tag
          : typeof payloadEnc.authTag === 'string'
            ? payloadEnc.authTag
            : undefined
      cryptoStep = 'aes-gcm-capsule-single'
      logGcmDecryptInputs('capsule-payload', nonce, ctext, tagB64)
      const plain = await aesGcmDecrypt(capsuleKey, nonce, ctext, envelopeAadBytes, tagB64)
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
            decBytes = await decryptChunkSequence(artefactKey, achunks, envelopeAadBytes)
          } else if (typeof enc.nonce === 'string' && typeof enc.ciphertext === 'string') {
            const aTag =
              typeof enc.tag === 'string'
                ? enc.tag
                : typeof enc.authTag === 'string'
                  ? enc.authTag
                  : typeof (enc as EncryptedChunk).gcmTag === 'string'
                    ? (enc as EncryptedChunk).gcmTag
                    : undefined
            decBytes = await aesGcmDecrypt(artefactKey, enc.nonce, enc.ciphertext, envelopeAadBytes, aTag)
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
    console.error('[qBEAP-decrypt] Decryption failed at step:', cryptoStep, (e as Error)?.message ?? e)
    return null
  }
}
