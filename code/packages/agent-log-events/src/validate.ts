import {
  AGENT_LOG_SCHEMA_VERSION,
  type AgentLogEvent,
  type AgentLogEventInput,
  type AgentLogLevel,
  type AgentLogSource,
  type JsonScalar,
} from './types.js'

const LEVELS = new Set<AgentLogLevel>(['debug', 'info', 'warn', 'error', 'critical'])

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

export class AgentLogValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentLogValidationError'
  }
}

function isScalar(value: unknown): value is JsonScalar {
  const t = typeof value
  return value === null || t === 'string' || t === 'number' || t === 'boolean'
}

function assertScalarFields(fields: Record<string, unknown>, path = 'fields'): void {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && typeof value === 'object') {
      throw new AgentLogValidationError(`${path}.${key} must be a scalar, not an object or array`)
    }
    if (!isScalar(value)) {
      throw new AgentLogValidationError(`${path}.${key} must be a scalar`)
    }
  }
}

export function validateAgentLogEventInput(input: AgentLogEventInput): void {
  if (!LEVELS.has(input.level)) {
    throw new AgentLogValidationError(`invalid level: ${String(input.level)}`)
  }
  if (!input.source || typeof input.source !== 'string') {
    throw new AgentLogValidationError('source is required')
  }
  if (!input.event_code?.trim()) {
    throw new AgentLogValidationError('event_code is required')
  }
  if (!input.message?.trim()) {
    throw new AgentLogValidationError('message is required')
  }
  assertScalarFields(input.fields as Record<string, unknown>)
}

export function stampAgentLogEvent(input: AgentLogEventInput, eventId: string, now?: Date): AgentLogEvent {
  validateAgentLogEventInput(input)
  return {
    ...input,
    event_id: eventId,
    timestamp_iso: (now ?? new Date()).toISOString(),
    schema_version: AGENT_LOG_SCHEMA_VERSION,
    fields: { ...input.fields },
  }
}

export function parseAgentLogEventLine(line: string): AgentLogEvent | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    if (raw.schema_version !== AGENT_LOG_SCHEMA_VERSION) return null
    if (typeof raw.event_id !== 'string') return null
    if (typeof raw.timestamp_iso !== 'string') return null
    if (!LEVELS.has(raw.level as AgentLogLevel)) return null
    if (typeof raw.source !== 'string') return null
    if (typeof raw.event_code !== 'string') return null
    if (typeof raw.message !== 'string') return null
    if (typeof raw.fields !== 'object' || raw.fields === null || Array.isArray(raw.fields)) return null
    assertScalarFields(raw.fields as Record<string, unknown>)
    return raw as unknown as AgentLogEvent
  } catch {
    return null
  }
}

/** Quick scan for obvious PII patterns in message + field string values (pre-filter). */
export function containsObviousEmailLeak(text: string): boolean {
  return EMAIL_RE.test(text)
}

export function isAllowedAgentLogSource(source: string): source is AgentLogSource {
  if (
    source === 'agent' ||
    source === 'supervisor' ||
    source === 'pod_manager' ||
    source === 'sso' ||
    source === 'pairing' ||
    source === 'recovery'
  ) {
    return true
  }
  return source.startsWith('pod:')
}
