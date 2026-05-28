import type { AgentLogEvent, AgentLogEventInput, JsonScalar } from '@repo/agent-log-events'

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
const ABS_PATH_RE = /(?:^|\s)(\/(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+)/g
const WINDOWS_PATH_RE = /[A-Za-z]:\\(?:[^\\]+\\)*[^\\]+/g

/** Known-safe field name prefixes (default-deny for new names). */
const ALLOWED_FIELD_PREFIXES = [
  'account_id',
  'container',
  'role',
  'pod_',
  'edge_',
  'image_',
  'digest',
  'http_',
  'status_',
  'error_code',
  'reason',
  'count',
  'duration_',
  'report_id',
  'handshake_id',
  'event_code',
  'schema_',
  'provider',
  'state',
  'code',
  'expected',
  'actual',
  'budget',
  'replacement',
  'dropped_',
  'offending_',
  'filter_',
]

const DENY_FIELD_NAMES = new Set([
  'email',
  'subject',
  'body',
  'message_text',
  'attachment_name',
  'filename',
  'file_path',
  'path',
  'refresh_token',
  'access_token',
  'password',
  'credential',
  'oauth',
  'from_header',
  'to_header',
])

const ALLOWED_EXACT = new Set([
  'account_id',
  'report_id',
  'handshake_id',
  'container_name',
  'pod_state',
  'http_status',
  'status_code',
  'error_code',
  'reason',
  'role',
  'count',
  'dropped_count',
  'offending_source',
  'offending_event_code',
  'filter_action',
  'image_digest_expected',
  'image_digest_actual',
  'duration_ms',
])

function fieldAllowed(name: string): boolean {
  if (DENY_FIELD_NAMES.has(name)) return false
  if (ALLOWED_EXACT.has(name)) return true
  return ALLOWED_FIELD_PREFIXES.some((p) => name === p || name.startsWith(p))
}

function scanTextForForbidden(value: string, allowOwnEmail: string | null): boolean {
  const emails = value.match(EMAIL_RE) ?? []
  for (const e of emails) {
    if (allowOwnEmail && e.toLowerCase() === allowOwnEmail.toLowerCase()) continue
    return true
  }
  if (ABS_PATH_RE.test(value) || WINDOWS_PATH_RE.test(value)) return true
  const lowered = value.toLowerCase()
  if (lowered.includes('refresh_token') || lowered.includes('access_token')) return true
  if (lowered.includes('password=') || lowered.includes('bearer ')) return true
  return false
}

export type PiiFilterResult =
  | { ok: true; event: AgentLogEvent }
  | { ok: false; drop: true; synthetic: AgentLogEventInput }
  | { ok: false; drop: false; event: AgentLogEvent; redactedFields: string[] }

export function applyPiiFilter(
  event: AgentLogEvent,
  options?: { ownEmail?: string | null },
): PiiFilterResult {
  const ownEmail = options?.ownEmail ?? null

  if (scanTextForForbidden(event.message, ownEmail)) {
    return syntheticDrop(event.source, event.event_code)
  }

  const redacted: Record<string, JsonScalar> = {}
  const redactedNames: string[] = []

  for (const [key, value] of Object.entries(event.fields)) {
    if (!fieldAllowed(key)) {
      redactedNames.push(key)
      continue
    }
    if (typeof value === 'string' && scanTextForForbidden(value, ownEmail)) {
      redactedNames.push(key)
      continue
    }
    redacted[key] = value
  }

  if (redactedNames.length > 0 && Object.keys(redacted).length === 0) {
    return syntheticDrop(event.source, event.event_code)
  }

  if (redactedNames.length > 0) {
    return {
      ok: false,
      drop: false,
      event: { ...event, fields: redacted },
      redactedFields: redactedNames,
    }
  }

  return { ok: true, event }
}

function syntheticDrop(
  source: AgentLogEvent['source'],
  offendingCode: string,
): { ok: false; drop: true; synthetic: AgentLogEventInput } {
  return {
    ok: false,
    drop: true,
    synthetic: {
      level: 'warn',
      source: 'agent',
      event_code: 'event_dropped_pii_filter',
      message: 'An operational event was withheld because it may have contained sensitive content.',
      fields: {
        offending_source: String(source),
        offending_event_code: offendingCode,
        filter_action: 'dropped',
      },
    },
  }
}
