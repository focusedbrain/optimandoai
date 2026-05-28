import type { IncomingMessage, ServerResponse } from 'node:http'

import { isValidEd25519PublicKeyHex } from './pairingKeys.js'
import { normalizePairingCodeInput } from './pairingCode.js'
import type { SetupStateMachine } from './setupState.js'
import type { AgentConfig } from './config.js'
import type { AgentStorage } from './storage.js'
import { applyPairingConfirmation } from './pairingConfirm.js'

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export async function handlePairInitiate(
  req: IncomingMessage,
  res: ServerResponse,
  setup: SetupStateMachine,
  storage: AgentStorage,
  getSignedInSub: () => Promise<string | null>,
  _config: AgentConfig,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  let body: Record<string, unknown>
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const rawCode = typeof body.pairing_code === 'string' ? body.pairing_code : ''
  const pairingCode = normalizePairingCodeInput(rawCode)
  if (!pairingCode) {
    sendJson(res, 400, { error: 'invalid_code', message: 'Pairing code must be six digits' })
    return
  }

  const orchestratorSub = typeof body.orchestrator_sub === 'string' ? body.orchestrator_sub : ''
  const orchestratorPublicKey =
    typeof body.orchestrator_public_key === 'string' ? body.orchestrator_public_key : ''
  const orchestratorNonce = typeof body.orchestrator_nonce === 'string' ? body.orchestrator_nonce : ''

  if (!orchestratorSub || !orchestratorNonce) {
    sendJson(res, 400, { error: 'invalid_request' })
    return
  }
  if (!isValidEd25519PublicKeyHex(orchestratorPublicKey)) {
    sendJson(res, 400, { error: 'invalid_public_key' })
    return
  }

  const agentSub = await getSignedInSub()
  if (!agentSub) {
    sendJson(res, 403, { error: 'not_signed_in', message: 'Agent must be signed in before pairing' })
    return
  }

  const result = setup.initiatePairing({
    pairingCode,
    orchestratorSub,
    orchestratorPublicKey,
    orchestratorNonce,
    agentSignedInSub: agentSub,
  })

  if (!result.ok) {
    sendJson(res, result.httpStatus, {
      error: result.error,
      message: pairingErrorMessage(result.error),
    })
    return
  }

  const { session } = result
  const state = await storage.loadState()
  sendJson(res, 200, {
    session_id: session.sessionId,
    agent_public_key: session.agentKeypair.publicKeyHex,
    agent_nonce: session.agentNonce,
    fingerprint: session.fingerprint,
    agent_restart_epoch: session.agentRestartEpoch,
    agent_encryption_public_key_b64: state.agentEncryptionPublicKeyB64 ?? null,
    p2p_endpoint: state.p2pEndpoint ?? null,
    agent_p2p_auth_token: state.agentP2pAuthToken ?? null,
  })
}

export async function handlePairConfirm(
  req: IncomingMessage,
  res: ServerResponse,
  setup: SetupStateMachine,
  storage: AgentStorage,
  onPaired: () => void,
  config: AgentConfig,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  let body: Record<string, unknown>
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
  if (!sessionId || body.party !== 'orchestrator') {
    sendJson(res, 400, { error: 'invalid_request' })
    return
  }

  const orchestratorP2p =
    typeof body.orchestrator_p2p_auth_token === 'string' ? body.orchestrator_p2p_auth_token : ''
  let outcome: Awaited<ReturnType<typeof applyPairingConfirmation>>
  try {
    outcome = await applyPairingConfirmation(
      setup,
      storage,
      sessionId,
      'orchestrator',
      onPaired,
      config,
      orchestratorP2p,
    )
  } catch (err) {
    sendJson(res, 400, {
      error: 'invalid_request',
      message: err instanceof Error ? err.message : String(err),
    })
    return
  }
  if (outcome.status === 'session_not_found') {
    sendJson(res, 404, { error: 'session_not_found' })
    return
  }
  sendJson(res, 200, outcome)
}

export async function handlePairStatus(
  req: IncomingMessage,
  res: ServerResponse,
  setup: SetupStateMachine,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local')
  const sessionId = url.searchParams.get('session_id') ?? ''
  const session = setup.getSession()
  if (!session || session.sessionId !== sessionId) {
    sendJson(res, 404, { error: 'session_not_found' })
    return
  }
  if (session.rejected) {
    sendJson(res, 200, { status: 'rejected' })
    return
  }
  if (setup.isSessionReadyToPersist()) {
    sendJson(res, 200, { status: 'ready_to_persist' })
    return
  }
  sendJson(res, 200, {
    status: 'awaiting_confirmations',
    agent_ui_confirmed: session.agentUiConfirmed,
    orchestrator_confirmed: session.orchestratorConfirmed,
    fingerprint: session.fingerprint,
  })
}

export async function handlePairReject(
  req: IncomingMessage,
  res: ServerResponse,
  setup: SetupStateMachine,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  setup.rejectSession()
  sendJson(res, 200, { status: 'rejected' })
}

function pairingErrorMessage(code: string): string {
  switch (code) {
    case 'code_mismatch':
      return 'The pairing code does not match'
    case 'code_expired':
      return 'The pairing code has expired; regenerate on the Agent'
    case 'code_consumed':
      return 'This pairing code was already used'
    case 'sub_mismatch':
      return 'Signed-in user does not match orchestrator session'
    default:
      return 'Pairing failed'
  }
}
