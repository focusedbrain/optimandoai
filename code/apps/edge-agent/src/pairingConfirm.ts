import type { AgentConfig } from './config.js'
import { buildP2pEndpoint } from './config.js'
import type { SetupStateMachine } from './setupState.js'
import type { AgentStorage } from './storage.js'
import { buildEdgeIngestorHandshakeFromPairing } from './edgeIngestorHandshake.js'
import { markPaired } from './storageHelpers.js'
import { emitAgentLogEvent } from './log-stream/emit.js'

export type ConfirmResult =
  | { status: 'awaiting_confirmations' }
  | { status: 'paired'; fingerprint: string }
  | { status: 'session_not_found' }

export async function applyPairingConfirmation(
  setup: SetupStateMachine,
  storage: AgentStorage,
  sessionId: string,
  party: 'orchestrator' | 'agent_ui',
  onPaired: () => void,
  config: AgentConfig,
  orchestratorP2pAuthToken?: string,
): Promise<ConfirmResult> {
  const ok =
    party === 'orchestrator'
      ? setup.confirmOrchestrator(sessionId)
      : setup.confirmAgentUi(sessionId)
  if (!ok) return { status: 'session_not_found' }

  if (party === 'orchestrator' && orchestratorP2pAuthToken?.trim()) {
    const prev = await storage.loadState()
    await storage.saveState({
      ...prev,
      orchestratorP2pAuthToken: orchestratorP2pAuthToken.trim(),
    })
  }

  if (!setup.isSessionReadyToPersist()) {
    return { status: 'awaiting_confirmations' }
  }

  const session = setup.completePairing()
  if (!session) return { status: 'session_not_found' }

  const handshake = buildEdgeIngestorHandshakeFromPairing({
    orchestratorSub: session.orchestratorSub,
    orchestratorPublicKey: session.orchestratorPublicKey,
    agentPublicKey: session.agentKeypair.publicKeyHex,
    orchestratorNonce: session.orchestratorNonce,
    agentNonce: session.agentNonce,
    fingerprint: session.fingerprint,
  })

  const state = await storage.loadState()
  const encPub = state.agentEncryptionPublicKeyB64
  const agentP2p = state.agentP2pAuthToken
  const p2pEndpoint = state.p2pEndpoint ?? buildP2pEndpoint(config)
  if (!encPub || !agentP2p) {
    throw new Error('Agent encryption keys not ready — sign in again')
  }
  const orchToken = orchestratorP2pAuthToken?.trim() ?? state.orchestratorP2pAuthToken ?? ''
  if (party === 'orchestrator' && !orchToken) {
    throw new Error('orchestrator_p2p_auth_token required')
  }

  await markPaired(storage, {
    pairRecord: {
      handshakeId: handshake.handshake_id,
      handshakeType: handshake.handshake_type,
      orchestratorSub: handshake.orchestrator_sub,
      orchestratorPublicKey: handshake.orchestrator_public_key,
      agentPublicKey: handshake.agent_public_key,
      orchestratorNonce: handshake.orchestrator_nonce,
      agentNonce: handshake.agent_nonce,
      fingerprint: handshake.fingerprint,
      confirmedAt: handshake.confirmed_at,
      initiatorDeviceRole: handshake.initiator_device_role,
      acceptorDeviceRole: handshake.acceptor_device_role,
      agentEncryptionPublicKeyB64: encPub,
      p2pEndpoint,
      agentP2pAuthToken: agentP2p,
      orchestratorP2pAuthToken: orchToken,
    },
    ssoSub: session.orchestratorSub,
    orchestratorP2pAuthToken: orchToken || state.orchestratorP2pAuthToken,
    encryptionKeyMigrationRequired: false,
  })
  emitAgentLogEvent({
    level: 'info',
    source: 'pairing',
    event_code: 'pairing_completed',
    message: 'Edge verification server pairing completed.',
    fields: { handshake_id: handshake.handshake_id },
  })
  onPaired()
  return { status: 'paired', fingerprint: session.fingerprint }
}
