import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AgentLogEvent } from '@repo/agent-log-events'

import type { AgentApiDeps } from '../agent-api.js'
import { sendError, readJsonBody, sendJson } from '../agent-api-http.js'
import type { AgentLogRingBuffer } from './buffer.js'
import { emitAgentLogEvent } from './emit.js'
export interface LogApiDeps extends AgentApiDeps {
  logBuffer: AgentLogRingBuffer
}

function parseQuery(url: string): URLSearchParams {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  return new URLSearchParams(q)
}

export async function handleLogStreamPoll(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LogApiDeps,
): Promise<void> {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method_not_allowed', 'GET required')
    return
  }
  const params = parseQuery(req.url ?? '')
  const after = params.get('after_event_id')?.trim() || null
  let maxCount = Number(params.get('max_count') ?? 100)
  if (!Number.isFinite(maxCount) || maxCount < 1) maxCount = 100
  maxCount = Math.min(500, Math.floor(maxCount))

  const events = await deps.logBuffer.peekEvents(maxCount, after)
  const hasMore = events.length >= maxCount
  const nextAfter = events.length > 0 ? events[events.length - 1]!.event_id : after

  sendJson(res, 200, {
    events: events as AgentLogEvent[],
    next_after_event_id: hasMore ? nextAfter : null,
    has_more: hasMore,
  })
}

export async function handleLogStreamAck(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LogApiDeps,
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
  const through = typeof body.through_event_id === 'string' ? body.through_event_id.trim() : ''
  if (!through) {
    sendError(res, 400, 'invalid_request', 'through_event_id required')
    return
  }
  await deps.logBuffer.acknowledgeEvents(through)
  sendJson(res, 200, { status: 'acked', through_event_id: through })
}

export async function handleAgentRecover(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LogApiDeps,
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'method_not_allowed', 'POST required')
    return
  }

  let reason = 'user initiated recovery'
  try {
    const body = (await readJsonBody(req)) as Record<string, unknown>
    if (typeof body.reason === 'string' && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 500)
    }
  } catch {
    /* optional body */
  }

  const podState = deps.podManager.getState()
  const halted =
    podState === 'replacement_exhausted' || podState === 'halted_by_anomaly'

  emitAgentLogEvent({
    level: 'info',
    source: 'recovery',
    event_code: 'recovery_requested',
    message: 'Orchestrator requested pod recovery.',
    fields: { reason, pod_state: podState },
  })

  if (!halted) {
    emitAgentLogEvent({
      level: 'warn',
      source: 'recovery',
      event_code: 'recovery_rejected',
      message: 'Recovery rejected because the pod is not halted.',
      fields: { reason: 'pod_not_halted', pod_state: podState },
    })
    sendError(res, 409, 'pod_not_halted', `Pod state is ${podState}; recovery only applies when halted`)
    return
  }

  try {
    await deps.podManager.recoverFromHalt()
    emitAgentLogEvent({
      level: 'info',
      source: 'recovery',
      event_code: 'recovery_succeeded',
      message: 'Pod recovery started after orchestrator request.',
      fields: { reason },
    })
    sendJson(res, 200, { status: 'recovery_started', pod_state: deps.podManager.getState() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    emitAgentLogEvent({
      level: 'error',
      source: 'recovery',
      event_code: 'recovery_failed',
      message: 'Pod recovery failed to start.',
      fields: { reason: msg },
    })
    sendError(res, 500, 'recovery_failed', msg)
  }
}
