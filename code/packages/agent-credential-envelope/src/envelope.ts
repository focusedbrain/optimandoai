import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'

export const CREDENTIAL_ENVELOPE_VERSION = 1 as const
const HKDF_INFO = 'wrdesk-agent-credential-v1'
const NONCE_LEN = 24

export interface CredentialRelayPlaintext {
  encrypted_bundle: string
  account_key_hex: string
  wrapped_account_key?: string
  quarantine_key_hex?: string
}

export interface CredentialRelayEnvelopeV1 {
  version: typeof CREDENTIAL_ENVELOPE_VERSION
  ephemeral_public_key_b64: string
  nonce_b64: string
  ciphertext_b64: string
  associated_data: string
}

export interface AgentEncryptionKeypair {
  publicKeyB64: string
  privateKeyB64: string
}

function rawPublicFromKeyObject(key: KeyObject): Buffer {
  const spki = key.export({ type: 'spki', format: 'der' }) as Buffer
  return spki.subarray(-32)
}

function rawPrivateFromKeyObject(key: KeyObject): Buffer {
  const pkcs8 = key.export({ type: 'pkcs8', format: 'der' }) as Buffer
  return pkcs8.subarray(-32)
}

function keyObjectFromRawPublic(raw: Buffer): KeyObject {
  const prefix = Buffer.from('302a300506032b656e032100', 'hex')
  const der = Buffer.concat([prefix, raw])
  return importRawPublicKey(der)
}

function keyObjectFromRawPrivate(raw: Buffer): KeyObject {
  const prefix = Buffer.from('302e020100300506032b656e04220420', 'hex')
  const der = Buffer.concat([prefix, raw])
  return importRawPrivateKey(der)
}

function importRawPublicKey(der: Buffer): KeyObject {
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}

function importRawPrivateKey(der: Buffer): KeyObject {
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
}

export function generateAgentEncryptionKeypair(): AgentEncryptionKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    publicKeyB64: rawPublicFromKeyObject(publicKey).toString('base64'),
    privateKeyB64: rawPrivateFromKeyObject(privateKey).toString('base64'),
  }
}

function deriveAeadKey(sharedSecret: Buffer, nonce: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', sharedSecret, nonce, HKDF_INFO, 32))
}

export function wrapCredentialPlaintext(
  agentPublicKeyB64: string,
  plaintext: CredentialRelayPlaintext,
  associatedData: string,
): CredentialRelayEnvelopeV1 {
  const agentRaw = Buffer.from(agentPublicKeyB64, 'base64')
  if (agentRaw.length !== 32) {
    throw new Error('invalid_agent_public_key')
  }
  const { publicKey: ephPub, privateKey: ephPriv } = generateKeyPairSync('x25519')
  const shared = diffieHellman({
    privateKey: ephPriv,
    publicKey: keyObjectFromRawPublic(agentRaw),
  })
  const nonce = randomBytes(NONCE_LEN)
  const key = deriveAeadKey(shared, nonce)
  const iv = nonce.subarray(0, 12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const plain = Buffer.from(JSON.stringify(plaintext), 'utf8')
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  const ciphertext = Buffer.concat([enc, tag])

  return {
    version: CREDENTIAL_ENVELOPE_VERSION,
    ephemeral_public_key_b64: rawPublicFromKeyObject(ephPub).toString('base64'),
    nonce_b64: nonce.toString('base64'),
    ciphertext_b64: ciphertext.toString('base64'),
    associated_data: associatedData,
  }
}

export function unwrapCredentialEnvelope(
  agentPrivateKeyB64: string,
  envelope: CredentialRelayEnvelopeV1,
): CredentialRelayPlaintext {
  if (envelope.version !== CREDENTIAL_ENVELOPE_VERSION) {
    throw new Error('unsupported_envelope_version')
  }
  const privRaw = Buffer.from(agentPrivateKeyB64, 'base64')
  const ephRaw = Buffer.from(envelope.ephemeral_public_key_b64, 'base64')
  const nonce = Buffer.from(envelope.nonce_b64, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext_b64, 'base64')
  if (privRaw.length !== 32 || ephRaw.length !== 32 || nonce.length !== NONCE_LEN) {
    throw new Error('invalid_envelope')
  }
  if (ciphertext.length < 16) {
    throw new Error('invalid_envelope')
  }

  const shared = diffieHellman({
    privateKey: keyObjectFromRawPrivate(privRaw),
    publicKey: keyObjectFromRawPublic(ephRaw),
  })
  const key = deriveAeadKey(shared, nonce)
  const iv = nonce.subarray(0, 12)
  const tag = ciphertext.subarray(-16)
  const data = ciphertext.subarray(0, -16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(envelope.associated_data, 'utf8'))
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as CredentialRelayPlaintext
}
