/**
 * Deterministic qBEAP fixtures for in-process vs pod crypto parity tests.
 * Key material matches packages/beap-pod depackager round-trip tests.
 */

import { webcrypto } from 'node:crypto'
import { x25519 } from '@noble/curves/ed25519'
import {
  hkdfDerive,
  computeEnvelopeAadBytes,
  toBase64,
  type LocalBeapPackage,
} from '@beap-pod/depackagePipeline'

export { toBase64 }

const wc = webcrypto as Crypto

export const RECEIVER_PRIV = new Uint8Array(32).fill(0x22)
export const SENDER_PRIV = new Uint8Array(32).fill(0x11)
export const SENDER_PUB = x25519.getPublicKey(SENDER_PRIV)
export const HANDSHAKE_ID = 'test-hs-crypto-parity'

async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await wc.subtle.importKey('raw', Buffer.from(keyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
  ])
  const algo =
    aad && aad.length > 0
      ? { name: 'AES-GCM' as const, iv: Buffer.from(iv), additionalData: Buffer.from(aad) }
      : { name: 'AES-GCM' as const, iv: Buffer.from(iv) }
  const ct = await wc.subtle.encrypt(algo, key, Buffer.from(plaintext))
  return new Uint8Array(ct)
}

export async function buildQbeapPackage(options: {
  capsuleBody: string
  subject?: string
  transportPlaintext?: string
}): Promise<LocalBeapPackage> {
  const salt = new Uint8Array(32).fill(0xab)
  const sharedSecret = x25519.getSharedSecret(SENDER_PRIV, x25519.getPublicKey(RECEIVER_PRIV))
  const capsuleKey = await hkdfDerive(sharedSecret, salt, 'BEAP v1 capsule', 32)

  const headerBase = {
    version: '1.0',
    encoding: 'qBEAP',
    encryption_mode: 'direct',
    timestamp: 1704067200000,
    sender_fingerprint: 'test-sender-fp-parity',
    template_hash: 'a'.repeat(64),
    policy_hash: 'b'.repeat(64),
    content_hash: 'c'.repeat(64),
    receiver_binding: { handshake_id: HANDSHAKE_ID },
    crypto: {
      suiteId: 'x25519-hkdf-aes256gcm',
      salt: toBase64(salt),
      handshake_id: HANDSHAKE_ID,
      senderX25519PublicKeyB64: toBase64(SENDER_PUB),
    },
  }

  const aadBytes = computeEnvelopeAadBytes(headerBase)
  const capsuleJson = JSON.stringify({
    subject: options.subject ?? 'Parity test subject',
    body: options.capsuleBody,
    transport_plaintext: options.transportPlaintext ?? 'plain preview',
  })
  const nonce = new Uint8Array(12).fill(0xcd)
  const ciphertext = await aesGcmEncrypt(
    capsuleKey,
    nonce,
    new TextEncoder().encode(capsuleJson),
    aadBytes,
  )

  return {
    ...headerBase,
    header: headerBase,
    metadata: { created_at: 1704067200000, test: true },
    payloadEnc: {
      nonce: toBase64(nonce),
      ciphertext: toBase64(ciphertext),
    },
    signature: {
      signature: Buffer.alloc(64).toString('base64'),
      algorithm: 'Ed25519',
      keyId: 'test-key',
    },
  }
}

export interface QbeapFixture {
  name: string
  packageJson: string
  handshakeId: string
  receiverPrivB64: string
  expectedSubject: string
  expectedBody: string
}

export async function loadFixtures(): Promise<QbeapFixture[]> {
  const specs = [
    { name: 'text-only', body: 'Hello from qBEAP parity!', subject: 'Text only' },
    { name: 'empty-body', body: '', subject: 'Empty body edge case' },
    { name: 'large-body', body: 'x'.repeat(4096), subject: 'Large body' },
    {
      name: 'transport-preview',
      body: '<p>HTML body</p>',
      subject: 'With transport',
      transportPlaintext: 'Preview line for transport',
    },
  ]

  const fixtures: QbeapFixture[] = []
  for (const spec of specs) {
    const pkg = await buildQbeapPackage({
      capsuleBody: spec.body,
      subject: spec.subject,
      transportPlaintext: spec.transportPlaintext,
    })
    fixtures.push({
      name: spec.name,
      packageJson: JSON.stringify(pkg),
      handshakeId: HANDSHAKE_ID,
      receiverPrivB64: toBase64(RECEIVER_PRIV),
      expectedSubject: spec.subject,
      expectedBody: spec.body,
    })
  }
  return fixtures
}
