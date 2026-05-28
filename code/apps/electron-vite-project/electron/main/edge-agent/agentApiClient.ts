/**
 * HTTP client for Edge Agent application API (PR6) over P2P endpoint.
 */

import type { CredentialRelayEnvelopeV1 } from '@repo/agent-credential-envelope'

import type { EdgeReplica } from '../edge-tier/settings.js'
import { isAgentEdgeReplica } from '../edge-tier/settings.js'
import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess.js'
import { resolveAgentConnection } from './resolveAgentConnection.js'

export interface AgentApiResponse {
  readonly status: number
  readonly json: Record<string, unknown>
}

export class AgentApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'AgentApiError'
  }
}

async function loadConnection(replica: EdgeReplica, dbOverride?: unknown) {
  const db = dbOverride ?? (await getHandshakeDbForInternalInference())
  if (!db) throw new Error('Handshake database unavailable for Agent API')
  return resolveAgentConnection(replica, db)
}

export async function agentApiRequest(
  replica: EdgeReplica,
  method: string,
  path: string,
  body?: unknown,
  dbOverride?: unknown,
): Promise<AgentApiResponse> {
  if (!isAgentEdgeReplica(replica)) {
    throw new Error('Replica is not an Agent deployment')
  }
  const conn = await loadConnection(replica, dbOverride)
  const url = `${conn.p2pEndpoint.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.orchestratorBearerToken}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = { error: 'invalid_json', message: 'Agent returned non-JSON body' }
  }
  return { status: res.status, json }
}

export async function relayCredentialsToAgent(
  replica: EdgeReplica,
  payload: {
    account_id: string
    display_name: string
    provider: 'google' | 'microsoft'
    envelope: CredentialRelayEnvelopeV1
  },
): Promise<void> {
  const res = await agentApiRequest(replica, 'POST', '/agent/credentials/relay', payload)
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'relay_failed'),
      res.status,
      String(res.json.message ?? `relay HTTP ${res.status}`),
    )
  }
}

export async function activateAgentCredentials(replica: EdgeReplica): Promise<void> {
  const res = await agentApiRequest(replica, 'POST', '/agent/credentials/activate')
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'activate_failed'),
      res.status,
      String(res.json.message ?? `activate HTTP ${res.status}`),
    )
  }
}

export async function revokeAgentCredentials(
  replica: EdgeReplica,
  accountId: string,
): Promise<void> {
  const res = await agentApiRequest(replica, 'DELETE', `/agent/credentials/${encodeURIComponent(accountId)}`)
  if (res.status !== 200 && res.status !== 404) {
    throw new AgentApiError(
      String(res.json.error ?? 'revoke_failed'),
      res.status,
      String(res.json.message ?? `revoke HTTP ${res.status}`),
    )
  }
}

export async function fetchAgentAccountsStatus(replica: EdgeReplica): Promise<Record<string, unknown>> {
  const res = await agentApiRequest(replica, 'GET', '/agent/accounts/status')
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'status_failed'),
      res.status,
      String(res.json.message ?? `status HTTP ${res.status}`),
    )
  }
  return res.json
}

export async function pollAgentLogStream(
  replica: EdgeReplica,
  opts: { after_event_id?: string | null; max_count?: number },
): Promise<{
  events: unknown[]
  next_after_event_id: string | null
  has_more: boolean
}> {
  const params = new URLSearchParams()
  if (opts.after_event_id) params.set('after_event_id', opts.after_event_id)
  if (opts.max_count) params.set('max_count', String(opts.max_count))
  const q = params.toString()
  const res = await agentApiRequest(replica, 'GET', `/agent/log-stream/poll${q ? `?${q}` : ''}`)
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'poll_failed'),
      res.status,
      String(res.json.message ?? `poll HTTP ${res.status}`),
    )
  }
  return {
    events: Array.isArray(res.json.events) ? res.json.events : [],
    next_after_event_id:
      typeof res.json.next_after_event_id === 'string' ? res.json.next_after_event_id : null,
    has_more: Boolean(res.json.has_more),
  }
}

export async function ackAgentLogStream(
  replica: EdgeReplica,
  throughEventId: string,
): Promise<void> {
  const res = await agentApiRequest(replica, 'POST', '/agent/log-stream/ack', {
    through_event_id: throughEventId,
  })
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'ack_failed'),
      res.status,
      String(res.json.message ?? `ack HTTP ${res.status}`),
    )
  }
}

export async function requestAgentRecover(
  replica: EdgeReplica,
  reason: string,
): Promise<Record<string, unknown>> {
  const res = await agentApiRequest(replica, 'POST', '/agent/recover', { reason })
  if (res.status !== 200) {
    throw new AgentApiError(
      String(res.json.error ?? 'recover_failed'),
      res.status,
      String(res.json.message ?? `recover HTTP ${res.status}`),
    )
  }
  return res.json
}
