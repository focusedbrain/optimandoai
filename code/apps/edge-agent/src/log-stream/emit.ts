import {
  newAgentLogEventId,
  stampAgentLogEvent,
  type AgentLogEvent,
  type AgentLogEventInput,
} from '@repo/agent-log-events'

import type { AgentStorage } from '../storage.js'
import { applyPiiFilter } from './pii-filter.js'
import type { AgentLogRingBuffer } from './buffer.js'

let buffer: AgentLogRingBuffer | null = null
let storage: AgentStorage | null = null

export function bindAgentLogStream(deps: {
  ringBuffer: AgentLogRingBuffer
  agentStorage: AgentStorage
}): void {
  buffer = deps.ringBuffer
  storage = deps.agentStorage
}

export function emitAgentLogEvent(
  input: AgentLogEventInput,
  options?: { skipBuffer?: boolean },
): void {
  const stamped = stampAgentLogEvent(input, newAgentLogEventId())
  void persistEvent(stamped, options?.skipBuffer)
}

async function persistEvent(event: AgentLogEvent, skipBuffer?: boolean): Promise<void> {
  let ownEmail: string | null = null
  if (storage) {
    try {
      const state = await storage.loadState()
      ownEmail = state.ssoEmail ?? null
    } catch {
      /* ignore */
    }
  }

  const filtered = applyPiiFilter(event, { ownEmail })
  const toWrite: AgentLogEvent[] = []

  if (filtered.ok) {
    toWrite.push(filtered.event)
  } else if (filtered.drop) {
    const syn = stampAgentLogEvent(filtered.synthetic, newAgentLogEventId())
    const synFiltered = applyPiiFilter(syn, { ownEmail })
    if (synFiltered.ok) toWrite.push(synFiltered.event)
    else if (!synFiltered.drop && 'event' in synFiltered) toWrite.push(synFiltered.event)
  } else {
    toWrite.push(filtered.event)
  }

  for (const ev of toWrite) {
    writeStderr(ev)
    if (!skipBuffer && buffer) {
      buffer.appendEvent(ev).catch((err) => {
        console.error(
          JSON.stringify({
            level: 'error',
            source: 'log-stream',
            event: 'buffer_append_failed',
            message: String(err),
          }),
        )
      })
    }
  }
}

function writeStderr(ev: AgentLogEvent): void {
  const line = JSON.stringify({
    type: 'agent_log_event',
    ...ev,
  })
  if (ev.level === 'error' || ev.level === 'critical') {
    console.error(line)
  } else if (ev.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}
