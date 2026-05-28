import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'

export interface PodIdentityKeypair {
  readonly podId: string
  readonly publicKeyHex: string
  readonly privateKeyHex: string
}

/** Fresh Ed25519 pod identity (32-byte seed hex + raw public key hex). */
export function generatePodIdentityKeypair(): PodIdentityKeypair {
  const seed = randomBytes(32)
  const { publicKey } = generateKeyPairSync('ed25519', { seed })
  const pubDer = publicKey.export({ type: 'spki', format: 'der' })
  return {
    podId: randomUUID(),
    publicKeyHex: pubDer.subarray(-32).toString('hex'),
    privateKeyHex: seed.toString('hex'),
  }
}
