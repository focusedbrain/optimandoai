import { generateKeyPairSync } from 'node:crypto'

export interface PairingKeypair {
  readonly publicKeyHex: string
  readonly privateKeyPkcs8Hex: string
}

export function generatePairingKeypair(): PairingKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' })
  return {
    publicKeyHex: pubDer.subarray(-32).toString('hex'),
    privateKeyPkcs8Hex: privDer.toString('hex'),
  }
}

export function isValidEd25519PublicKeyHex(key: string): boolean {
  const trimmed = key.trim().replace(/^ed25519:/i, '')
  return /^[a-f0-9]{64}$/i.test(trimmed)
}
