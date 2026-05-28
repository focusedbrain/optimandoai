import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  unwrapCredentialEnvelope,
  type CredentialRelayEnvelopeV1,
} from '@repo/agent-credential-envelope'
import { parseAccountKeyHex, zeroizeBuffer } from '@repo/email-fetch'

import { encryptAtRest } from './accountAtRest.js'
import {
  deliverAllAccountsToMailFetcher,
  pollMailFetcherAccountStatus,
} from './credentialDelivery.js'
import type { PodManager } from './pod-manager.js'
import type { AgentAccountProvider, AgentStorage } from './storage.js'
import { EDGE_INGESTOR_HANDSHAKE_TYPE } from './edgeIngestorHandshake.js'
import type { AgentLogRingBuffer } from './log-stream/buffer.js'
import {
  handleAgentRecover,
  handleLogStreamAck,
  handleLogStreamPoll,
  type LogApiDeps,
} from './log-stream/log-api.js'
import { emitAgentLogEvent } from './log-stream/emit.js'
import { readJsonBody, sendError, sendJson } from './agent-api-http.js'

export type { AgentApiErrorBody } from './agent-api-types.js'

export interface AgentApiDeps {
  storage: AgentStorage
  podManager: PodManager
  getPodAuthSecret: () => string | null
  logBuffer: AgentLogRingBuffer
}

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7).trim() || null
}

export async function verifyAgentBearer(
  storage: AgentStorage,
  token: string | null,
  remoteAddress: string,
): Promise<boolean> {
  const access = await verifyAgentApiAccess(storage, token, remoteAddress)
  return access.ok
}

/** Bearer + edge_ingestor role-pair binding (PR4.5 / PR7). */
export async function verifyAgentApiAccess(
  storage: AgentStorage,
  token: string | null,
  remoteAddress: string,
): Promise<{ ok: true } | { ok: false; forbidden?: boolean }> {
  if (!token) {
    console.error(
      JSON.stringify({
        level: 'warn',
        source: 'agent-api',
        event: 'auth_failure',
        reason: 'missing_bearer',
        remote: remoteAddress,
      }),
    )
    return { ok: false }
  }
  const state = await storage.loadState()
  const expected = state.orchestratorP2pAuthToken ?? state.pairRecord?.orchestratorP2pAuthToken
  if (!expected || token !== expected) {
    console.error(
      JSON.stringify({
        level: 'warn',
        source: 'agent-api',
        event: 'auth_failure',
        reason: 'invalid_bearer',
        remote: remoteAddress,
      }),
    )
    return { ok: false }
  }
  const pr = state.pairRecord
  if (
    !pr ||
    pr.handshakeType !== EDGE_INGESTOR_HANDSHAKE_TYPE ||
    pr.initiatorDeviceRole !== 'host' ||
    pr.acceptorDeviceRole !== 'edge_agent'
  ) {
    console.error(
      JSON.stringify({
        level: 'warn',
        source: 'agent-api',
        event: 'auth_failure',
        reason: 'invalid_handshake_roles',
        remote: remoteAddress,
      }),
    )
    return { ok: false, forbidden: true }
  }
  return { ok: true }
}

function parseProvider(raw: unknown): AgentAccountProvider | null {
  if (raw === 'google' || raw === 'microsoft') return raw
  return null
}

export async function handleCredentialRelay(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AgentApiDeps,
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'method_not_allowed', 'POST required')
    return
  }

  let body: Record<string, unknown>
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>
  } catch {
    sendError(res, 400, 'invalid_json', 'Body must be JSON')
    return
  }

  const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name : accountId
  const provider = parseProvider(body.provider)
  const envelope = body.envelope as CredentialRelayEnvelopeV1 | undefined

  if (!accountId || !provider || !envelope) {
    sendError(res, 400, 'invalid_request', 'account_id, provider, and envelope required')
    return
  }

  const state = await deps.storage.loadState()
  if (state.phase !== 'paired') {
    sendError(res, 409, 'not_paired', 'Agent is not paired')
    return
  }

  const privateKey = state.agentEncryptionPrivateKeyB64
  if (!privateKey) {
    sendError(res, 503, 'encryption_key_missing', 'Agent encryption key not configured')
    return
  }

  let plaintext: ReturnType<typeof unwrapCredentialEnvelope>
  try {
    plaintext = unwrapCredentialEnvelope(privateKey, envelope)
  } catch {
    sendError(res, 400, 'invalid_envelope', 'Could not decrypt credential envelope')
    return
  }

  if (envelope.associated_data !== `account:${accountId}`) {
    sendError(res, 400, 'invalid_envelope', 'associated_data mismatch')
    return
  }

  let keyBuf: Buffer | null = null
  try {
    keyBuf = parseAccountKeyHex(plaintext.account_key_hex)
    const accountKeyEncB64 = await encryptAtRest(deps.storage, plaintext.account_key_hex)
    const accounts = { ...(state.accounts ?? {}) }
    accounts[accountId] = {
      accountId,
      displayName,
      provider,
      encryptedBundle: plaintext.encrypted_bundle,
      accountKeyEncB64,
      wrappedAccountKey: plaintext.wrapped_account_key,
      updatedAt: new Date().toISOString(),
      lastRemoteState: 'awaiting_key',
    }
    await deps.storage.saveState({ ...state, accounts })
    emitAgentLogEvent({
      level: 'info',
      source: 'agent',
      event_code: 'account_credentials_received',
      message: 'Mail account credentials were stored on the verification server.',
      fields: { account_id: accountId, provider },
    })
    sendJson(res, 200, { status: 'stored', account_id: accountId })
  } catch (err) {
    sendError(
      res,
      400,
      'invalid_credentials',
      err instanceof Error ? err.message : String(err),
    )
  } finally {
    if (keyBuf) zeroizeBuffer(keyBuf)
  }
}

export async function handleCredentialActivate(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: AgentApiDeps,
): Promise<void> {
  const state = await deps.storage.loadState()
  if (state.phase !== 'paired') {
    sendError(res, 409, 'not_paired', 'Agent is not paired')
    return
  }
  if (state.haltedByAnomaly) {
    sendError(res, 503, 'agent_halted', 'Agent is halted by anomaly')
    return
  }

  try {
    await deps.podManager.activateCredentials()
    emitAgentLogEvent({
      level: 'info',
      source: 'agent',
      event_code: 'account_activated',
      message: 'Stored mail accounts were activated on the verification pod.',
      fields: { pod_state: deps.podManager.getState() },
    })
    sendJson(res, 200, {
      status: 'activate_started',
      pod_state: deps.podManager.getState(),
    })
  } catch (err) {
    sendError(
      res,
      409,
      'pod_start_failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}

export async function handleCredentialRevoke(
  accountId: string,
  res: ServerResponse,
  deps: AgentApiDeps,
): Promise<void> {
  const state = await deps.storage.loadState()
  if (!state.accounts?.[accountId]) {
    sendError(res, 404, 'account_not_found', 'No credentials for this account')
    return
  }
  const accounts = { ...state.accounts }
  delete accounts[accountId]
  await deps.storage.saveState({ ...state, accounts })
  try {
    await deps.podManager.activateCredentials()
  } catch {
    /* pod may be stopped */
  }
  emitAgentLogEvent({
    level: 'info',
    source: 'agent',
    event_code: 'account_credentials_revoked',
    message: 'Mail account credentials were revoked on the verification server.',
    fields: { account_id: accountId },
  })
  sendJson(res, 200, { status: 'revoked', account_id: accountId })
}

export async function handleAccountsStatus(
  res: ServerResponse,
  deps: AgentApiDeps,
): Promise<void> {
  const state = await deps.storage.loadState()
  const podAuth = deps.getPodAuthSecret()
  const remoteById = new Map<string, Record<string, unknown>>()

  if (deps.podManager.getState() === 'running' && podAuth) {
    const remote = await pollMailFetcherAccountStatus(podAuth)
    for (const row of remote) {
      const id = typeof row.account_id === 'string' ? row.account_id : ''
      if (id) remoteById.set(id, row)
    }
  }

  const accounts = Object.values(state.accounts ?? {}).map((a) => {
    const remote = remoteById.get(a.accountId)
    return {
      account_id: a.accountId,
      display_name: a.displayName,
      provider: a.provider,
      has_credentials: true,
      remote_state:
        (typeof remote?.state === 'string' ? remote.state : a.lastRemoteState) ?? 'awaiting_key',
      last_fetch_at:
        typeof remote?.last_fetch_at === 'string' ? remote.last_fetch_at : a.lastFetchAt,
      last_error: typeof remote?.last_error === 'string' ? remote.last_error : a.lastError,
    }
  })

  sendJson(res, 200, {
    pod_state: deps.podManager.getState(),
    accounts,
    encryption_key_migration_required: state.encryptionKeyMigrationRequired ?? false,
    agent_encryption_public_key_b64: state.agentEncryptionPublicKeyB64 ?? null,
  })
}

export async function routeAgentApi(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AgentApiDeps,
): Promise<boolean> {
  const url = req.url?.split('?')[0] ?? '/'
  const remote = req.socket.remoteAddress ?? 'unknown'

  if (!url.startsWith('/agent/')) return false

  const bearer = extractBearer(req)
  const access = await verifyAgentApiAccess(deps.storage, bearer, remote)
  if (!access.ok) {
    if (url === '/agent/recover' && req.method === 'POST') {
      emitAgentLogEvent({
        level: 'warn',
        source: 'recovery',
        event_code: 'recovery_rejected',
        message: 'Recovery rejected because the request was not authorized.',
        fields: { reason: 'unauthorized' },
      })
    }
    if (access.forbidden) {
      sendError(res, 403, 'forbidden', 'Handshake role binding rejected this request')
    } else {
      sendError(res, 401, 'unauthorized', 'Bearer token required')
    }
    return true
  }

  const logDeps = deps as LogApiDeps

  if (url === '/agent/log-stream/poll') {
    await handleLogStreamPoll(req, res, logDeps)
    return true
  }
  if (url === '/agent/log-stream/ack' && req.method === 'POST') {
    await handleLogStreamAck(req, res, logDeps)
    return true
  }
  if (url === '/agent/recover' && req.method === 'POST') {
    await handleAgentRecover(req, res, logDeps)
    return true
  }

  if (url === '/agent/credentials/relay') {
    await handleCredentialRelay(req, res, deps)
    return true
  }
  if (url === '/agent/credentials/activate' && req.method === 'POST') {
    await handleCredentialActivate(req, res, deps)
    return true
  }
  const revokeMatch = url.match(/^\/agent\/credentials\/([^/]+)$/)
  if (revokeMatch && req.method === 'DELETE') {
    await handleCredentialRevoke(revokeMatch[1]!, res, deps)
    return true
  }
  if (url === '/agent/accounts/status' && req.method === 'GET') {
    await handleAccountsStatus(res, deps)
    return true
  }
  if (url === '/agent/edge/status' && req.method === 'GET') {
    const state = await deps.storage.loadState()
    const pod = deps.podManager.getStatus()
    const hex = pod.edgePublicKeyHex ?? state.edgePublicKeyHex ?? null
    sendJson(res, 200, {
      edge_pod_id: pod.edgePodId ?? state.edgePodId ?? null,
      edge_public_key_hex: hex,
      edge_public_key: hex ? `ed25519:${hex}` : null,
      pod_state: pod.state,
    })
    return true
  }

  sendError(res, 404, 'not_found', 'Unknown agent API path')
  return true
}

export async function afterPodRunningDeliverCredentials(deps: AgentApiDeps): Promise<void> {
  await deliverAllAccountsToMailFetcher(deps.storage, deps.getPodAuthSecret())
}
