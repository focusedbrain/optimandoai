import { randomUUID } from 'node:crypto'

import { generateAgentEncryptionKeypair } from '@repo/agent-credential-envelope'

import { buildP2pEndpoint, type AgentConfig } from './config.js'
import type { AgentStorage } from './storage.js'

/** Ensure X25519 encryption keypair and Agent P2P bearer exist (after SSO, before pairing). */
export async function ensureAgentCrypto(
  storage: AgentStorage,
  config: AgentConfig,
): Promise<void> {
  const state = await storage.loadState()
  let next = { ...state }
  let changed = false

  if (!next.agentEncryptionPublicKeyB64 || !next.agentEncryptionPrivateKeyB64) {
    const kp = generateAgentEncryptionKeypair()
    next.agentEncryptionPublicKeyB64 = kp.publicKeyB64
    next.agentEncryptionPrivateKeyB64 = kp.privateKeyB64
    changed = true
  }

  if (!next.agentP2pAuthToken) {
    next.agentP2pAuthToken = randomUUID()
    changed = true
  }

  const endpoint = buildP2pEndpoint(config)
  if (next.p2pEndpoint !== endpoint) {
    next.p2pEndpoint = endpoint
    changed = true
  }

  if (state.phase === 'paired' && state.pairRecord && !state.pairRecord.agentEncryptionPublicKeyB64) {
    next.encryptionKeyMigrationRequired = true
    changed = true
  }

  if (changed) {
    await storage.saveState(next)
  }
}

/** Backfill pair record encryption + P2P fields for PR4-era pairs. */
export async function migratePairRecordCrypto(
  storage: AgentStorage,
  config: AgentConfig,
): Promise<boolean> {
  const state = await storage.loadState()
  if (state.phase !== 'paired' || !state.pairRecord) return false
  const pr = state.pairRecord
  if (
    pr.agentEncryptionPublicKeyB64 &&
    pr.p2pEndpoint &&
    pr.agentP2pAuthToken &&
    pr.orchestratorP2pAuthToken
  ) {
    return false
  }
  await ensureAgentCrypto(storage, config)
  const fresh = await storage.loadState()
  if (!fresh.agentEncryptionPublicKeyB64 || !fresh.agentP2pAuthToken) return false

  await storage.saveState({
    ...fresh,
    pairRecord: {
      ...pr,
      agentEncryptionPublicKeyB64: fresh.agentEncryptionPublicKeyB64,
      p2pEndpoint: fresh.p2pEndpoint ?? buildP2pEndpoint(config),
      agentP2pAuthToken: fresh.agentP2pAuthToken,
      orchestratorP2pAuthToken: pr.orchestratorP2pAuthToken ?? fresh.orchestratorP2pAuthToken ?? '',
    },
    encryptionKeyMigrationRequired: !pr.agentEncryptionPublicKeyB64,
  })
  return true
}
