import { createHash } from 'node:crypto'

/** Matches apps/edge-agent/src/fingerprint.ts (PAIRING_PROTOCOL.md). */
export function normalizeEd25519PublicKeyHex(key: string): string | null {
  const trimmed = key.trim().replace(/^ed25519:/i, '')
  if (!/^[a-f0-9]{64}$/i.test(trimmed)) return null
  return trimmed.toLowerCase()
}

export function computePairingFingerprint(
  orchestratorPublicKey: string,
  agentPublicKey: string,
  orchestratorNonce: string,
  agentNonce: string,
): string {
  const orch = normalizeEd25519PublicKeyHex(orchestratorPublicKey)
  const agent = normalizeEd25519PublicKeyHex(agentPublicKey)
  if (!orch || !agent) {
    throw new Error('invalid public key for fingerprint')
  }
  const input = Buffer.concat([
    Buffer.from(orch, 'utf8'),
    Buffer.from(agent, 'utf8'),
    Buffer.from(orchestratorNonce, 'utf8'),
    Buffer.from(agentNonce, 'utf8'),
  ])
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 16)
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`
}
