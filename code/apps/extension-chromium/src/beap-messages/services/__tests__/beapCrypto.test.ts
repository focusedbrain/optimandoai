/**
 * BEAP Crypto Unit Tests
 * 
 * Tests AEAD encryption/decryption round-trips for:
 * - Capsule payload encryption
 * - Artefact encryption
 * - Key derivation
 */

import { describe, it, expect } from 'vitest'
import {
  randomBytes,
  toBase64,
  fromBase64,
  stringToBytes,
  bytesToString,
  sha256,
  hkdfSha256,
  deriveBeapKeys,
  aeadEncrypt,
  aeadDecrypt,
  encryptCapsulePayload,
  decryptCapsulePayload,
  encryptArtefact,
  decryptArtefact,
  generateEnvelopeSalt
} from '../beapCrypto'

describe('beapCrypto', () => {
  describe('utility functions', () => {
    it('should generate random bytes of correct length', () => {
      const bytes16 = randomBytes(16)
      expect(bytes16.length).toBe(16)
      
      const bytes32 = randomBytes(32)
      expect(bytes32.length).toBe(32)
      
      // Should not be all zeros
      expect(bytes16.some(b => b !== 0)).toBe(true)
    })

    it('should round-trip base64 encoding', () => {
      const original = new Uint8Array([0, 1, 2, 255, 128, 64])
      const encoded = toBase64(original)
      const decoded = fromBase64(encoded)
      expect(decoded).toEqual(original)
    })

    it('should round-trip string encoding', () => {
      const original = 'Hello, BEAP! 🔐'
      const bytes = stringToBytes(original)
      const decoded = bytesToString(bytes)
      expect(decoded).toBe(original)
    })

    it('should compute SHA-256 hash', async () => {
      const data = stringToBytes('test')
      const hash = await sha256(data)
      // Known SHA-256 of "test"
      expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
    })
  })

  describe('key derivation', () => {
    it('should derive consistent keys from same inputs', async () => {
      const ikm = randomBytes(32)
      const salt = randomBytes(16)
      const info = 'test context'

      const key1 = await hkdfSha256(ikm, salt, info)
      const key2 = await hkdfSha256(ikm, salt, info)

      expect(key1).toEqual(key2)
      expect(key1.length).toBe(32)
    })

    it('should derive different keys from different info strings', async () => {
      const ikm = randomBytes(32)
      const salt = randomBytes(16)

      const key1 = await hkdfSha256(ikm, salt, 'capsule')
      const key2 = await hkdfSha256(ikm, salt, 'artefact')

      expect(key1).not.toEqual(key2)
    })

    // Note: X25519 key agreement tests are in x25519KeyAgreement.test.ts
    // This test validates HKDF key derivation from a shared secret
    it('should derive BEAP keys from shared secret consistently', async () => {
      // Simulate X25519 ECDH output (32 bytes)
      const sharedSecret = randomBytes(32)
      const salt = randomBytes(16)

      const keys1 = await deriveBeapKeys(sharedSecret, salt)
      const keys2 = await deriveBeapKeys(sharedSecret, salt)

      expect(keys1.capsuleKey).toEqual(keys2.capsuleKey)
      expect(keys1.artefactKey).toEqual(keys2.artefactKey)
      expect(keys1.capsuleKey.length).toBe(32)
      expect(keys1.artefactKey.length).toBe(32)
    })

    it('should derive capsule and artefact keys', async () => {
      const sharedSecret = randomBytes(32)
      const envelopeSalt = generateEnvelopeSalt()

      const { capsuleKey, artefactKey } = await deriveBeapKeys(sharedSecret, envelopeSalt)

      expect(capsuleKey.length).toBe(32)
      expect(artefactKey.length).toBe(32)
      expect(capsuleKey).not.toEqual(artefactKey)
    })
  })

  describe('AEAD encryption', () => {
    it('should encrypt and decrypt with round-trip', async () => {
      const key = randomBytes(32)
      const plaintext = stringToBytes('Secret message for BEAP')

      const encrypted = await aeadEncrypt(key, plaintext)
      expect(encrypted.nonce).toBeDefined()
      expect(encrypted.ciphertext).toBeDefined()

      const decrypted = await aeadDecrypt(key, encrypted.nonce, encrypted.ciphertext)
      expect(decrypted).toEqual(plaintext)
    })

    it('should produce different ciphertexts for same plaintext (random nonce)', async () => {
      const key = randomBytes(32)
      const plaintext = stringToBytes('Same message')

      const encrypted1 = await aeadEncrypt(key, plaintext)
      const encrypted2 = await aeadEncrypt(key, plaintext)

      // Nonces should be different
      expect(encrypted1.nonce).not.toBe(encrypted2.nonce)
      // Ciphertexts should be different
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext)
    })

    it('should fail decryption with wrong key', async () => {
      const key1 = randomBytes(32)
      const key2 = randomBytes(32)
      const plaintext = stringToBytes('Secret message')

      const encrypted = await aeadEncrypt(key1, plaintext)

      await expect(
        aeadDecrypt(key2, encrypted.nonce, encrypted.ciphertext)
      ).rejects.toThrow()
    })

    it('should fail decryption with tampered ciphertext', async () => {
      const key = randomBytes(32)
      const plaintext = stringToBytes('Secret message')

      const encrypted = await aeadEncrypt(key, plaintext)
      
      // Tamper with ciphertext
      const ciphertextBytes = fromBase64(encrypted.ciphertext)
      ciphertextBytes[0] ^= 0xFF
      const tamperedCiphertext = toBase64(ciphertextBytes)

      await expect(
        aeadDecrypt(key, encrypted.nonce, tamperedCiphertext)
      ).rejects.toThrow()
    })
  })

  describe('capsule payload encryption', () => {
    it('should encrypt and decrypt JSON payload', async () => {
      const capsuleKey = randomBytes(32)
      const payload = JSON.stringify({
        subject: 'Test Message',
        body: 'This is a secret message',
        attachments: [{ id: '1', name: 'test.pdf' }]
      })

      const encrypted = await encryptCapsulePayload(capsuleKey, payload)
      expect(encrypted.nonce).toBeDefined()
      expect(encrypted.ciphertext).toBeDefined()

      // Ciphertext should not contain plaintext
      expect(atob(encrypted.ciphertext)).not.toContain('Test Message')

      const decrypted = await decryptCapsulePayload(capsuleKey, encrypted)
      expect(decrypted).toBe(payload)

      // Parse to verify structure
      const parsed = JSON.parse(decrypted)
      expect(parsed.subject).toBe('Test Message')
      expect(parsed.body).toBe('This is a secret message')
    })
  })

  describe('artefact encryption', () => {
    it('should encrypt and decrypt artefact', async () => {
      const artefactKey = randomBytes(32)
      
      // Create a mock WEBP artefact (just some bytes)
      const mockImageData = randomBytes(1000)
      const mockBase64 = toBase64(mockImageData)
      const mockSha256 = await sha256(mockImageData)

      const artefact = {
        artefactRef: 'raster_test_p1_abc123.webp',
        attachmentId: 'att_123',
        page: 1,
        mime: 'image/webp',
        base64: mockBase64,
        sha256: mockSha256,
        width: 850,
        height: 1100,
        bytes: mockImageData.length
      }

      const encrypted = await encryptArtefact(artefactKey, artefact)
      
      // Verify encrypted structure
      expect(encrypted.artefactRef).toBe(artefact.artefactRef)
      expect(encrypted.attachmentId).toBe(artefact.attachmentId)
      expect(encrypted.page).toBe(artefact.page)
      expect(encrypted.mime).toBe(artefact.mime)
      expect(encrypted.nonce).toBeDefined()
      expect(encrypted.ciphertext).toBeDefined()
      expect(encrypted.sha256Plain).toBe(artefact.sha256)
      expect(encrypted.width).toBe(artefact.width)
      expect(encrypted.height).toBe(artefact.height)
      expect(encrypted.bytesPlain).toBe(artefact.bytes)

      // Decrypt and verify
      const decrypted = await decryptArtefact(artefactKey, encrypted)
      expect(decrypted.base64).toBe(mockBase64)
      expect(decrypted.sha256).toBe(mockSha256)
    })
  })

  describe('full encryption flow', () => {
    it('should complete end-to-end encryption/decryption cycle', async () => {
      // Simulate X25519 ECDH shared secret (in real flow, both parties derive same secret)
      // This simulates: sender ECDH(senderPrivate, receiverPublic) == receiver ECDH(receiverPrivate, senderPublic)
      const sharedSecret = randomBytes(32)

      // Generate envelope salt (would be stored in package header)
      const envelopeSalt = generateEnvelopeSalt()

      // Derive keys (sender side)
      const { capsuleKey, artefactKey } = await deriveBeapKeys(sharedSecret, envelopeSalt)

      // Encrypt capsule payload
      const capsulePayload = JSON.stringify({
        subject: 'End-to-End Test',
        body: 'This is the encrypted capsule content',
        attachments: []
      })
      const encryptedPayload = await encryptCapsulePayload(capsuleKey, capsulePayload)

      // Simulate receiver-side decryption
      // Receiver derives same keys from same shared secret (X25519 ECDH property)
      const receiverKeys = await deriveBeapKeys(sharedSecret, envelopeSalt)

      // Decrypt
      const decryptedPayload = await decryptCapsulePayload(receiverKeys.capsuleKey, encryptedPayload)
      expect(decryptedPayload).toBe(capsulePayload)

      const parsed = JSON.parse(decryptedPayload)
      expect(parsed.subject).toBe('End-to-End Test')
    })
  })
})

// Import signature functions for testing
import {
  generateEd25519KeyPair,
  ed25519Sign,
  ed25519Verify,
  createBeapSignature,
  verifyBeapSignature,
  computeContentHash,
  computeTemplateHash,
  computePolicyHash,
  computeSigningData,
  clearSigningKeyPair,
  getSigningKeyPair
} from '../beapCrypto'

describe('Ed25519 Signatures', () => {
  beforeEach(() => {
    // Clear any cached signing key
    clearSigningKeyPair()
  })

  describe('key generation', () => {
    it('should generate valid Ed25519 key pair', async () => {
      const keyPair = await generateEd25519KeyPair()
      
      expect(keyPair.privateKey).toBeDefined()
      expect(keyPair.publicKey).toBeDefined()
      expect(keyPair.keyId).toBeDefined()
      
      // Private key should be 32 bytes (44 base64 chars with padding)
      expect(keyPair.privateKey.length).toBe(44)
      // Public key should be 32 bytes
      expect(keyPair.publicKey.length).toBe(44)
      // Key ID should be 16 hex chars
      expect(keyPair.keyId.length).toBe(16)
    })

    it('should generate different keys each time', async () => {
      const keyPair1 = await generateEd25519KeyPair()
      const keyPair2 = await generateEd25519KeyPair()
      
      expect(keyPair1.privateKey).not.toBe(keyPair2.privateKey)
      expect(keyPair1.publicKey).not.toBe(keyPair2.publicKey)
      expect(keyPair1.keyId).not.toBe(keyPair2.keyId)
    })
  })

  describe('signing and verification', () => {
    it('should sign and verify data', async () => {
      const keyPair = await generateEd25519KeyPair()
      const message = stringToBytes('Test message for signing')
      
      const signature = await ed25519Sign(keyPair.privateKey, message)
      expect(signature).toBeDefined()
      expect(signature.length).toBe(88) // 64 bytes = 88 base64 chars
      
      const isValid = await ed25519Verify(keyPair.publicKey, signature, message)
      expect(isValid).toBe(true)
    })

    it('should fail verification with wrong public key', async () => {
      const keyPair1 = await generateEd25519KeyPair()
      const keyPair2 = await generateEd25519KeyPair()
      const message = stringToBytes('Test message')
      
      const signature = await ed25519Sign(keyPair1.privateKey, message)
      const isValid = await ed25519Verify(keyPair2.publicKey, signature, message)
      
      expect(isValid).toBe(false)
    })

    it('should fail verification with tampered message', async () => {
      const keyPair = await generateEd25519KeyPair()
      const message = stringToBytes('Original message')
      const tampered = stringToBytes('Tampered message')
      
      const signature = await ed25519Sign(keyPair.privateKey, message)
      const isValid = await ed25519Verify(keyPair.publicKey, signature, tampered)
      
      expect(isValid).toBe(false)
    })
  })

  describe('BEAP signature', () => {
    it('should create and verify BEAP signature', async () => {
      const keyPair = await generateEd25519KeyPair()
      const data = stringToBytes('BEAP package signing data')
      
      const sig = await createBeapSignature(keyPair, data)
      
      expect(sig.algorithm).toBe('Ed25519')
      expect(sig.signature).toBeDefined()
      expect(sig.keyId).toBe(keyPair.keyId)
      expect(sig.publicKey).toBe(keyPair.publicKey)
      
      const isValid = await verifyBeapSignature(sig, data)
      expect(isValid).toBe(true)
    })

    it('should get or create signing key pair', async () => {
      const keyPair1 = await getSigningKeyPair()
      const keyPair2 = await getSigningKeyPair()
      
      // Should return same key pair
      expect(keyPair1.keyId).toBe(keyPair2.keyId)
      expect(keyPair1.publicKey).toBe(keyPair2.publicKey)
    })
  })
})

describe('Content Hashing', () => {
  it('should compute consistent content hash', async () => {
    const body = 'Test message body'
    const attachments = [
      { originalName: 'file1.pdf', originalSize: 1000 },
      { originalName: 'file2.pdf', originalSize: 2000 }
    ]
    
    const hash1 = await computeContentHash(body, attachments)
    const hash2 = await computeContentHash(body, attachments)
    
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64) // SHA-256 hex
  })

  it('should compute different hash for different content', async () => {
    const hash1 = await computeContentHash('Body 1', [])
    const hash2 = await computeContentHash('Body 2', [])
    
    expect(hash1).not.toBe(hash2)
  })

  it('should compute consistent template hash', async () => {
    const hash1 = await computeTemplateHash('beap-v1', '1.0.0')
    const hash2 = await computeTemplateHash('beap-v1', '1.0.0')
    
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64)
  })

  it('should compute consistent policy hash', async () => {
    const policy = { requiresEncryptedMessage: true }
    
    const hash1 = await computePolicyHash(policy)
    const hash2 = await computePolicyHash(policy)
    
    expect(hash1).toBe(hash2)
    expect(hash1.length).toBe(64)
  })

  it('should compute signing data deterministically', async () => {
    const header = { version: '1.0', encoding: 'qBEAP', timestamp: 1234567890 }
    const payload = 'base64ciphertext'
    const artefacts = [{ artefactRef: 'ref1', sha256Plain: 'hash1' }]
    
    const data1 = await computeSigningData(header, payload, artefacts)
    const data2 = await computeSigningData(header, payload, artefacts)
    
    expect(data1).toEqual(data2)
  })
})

