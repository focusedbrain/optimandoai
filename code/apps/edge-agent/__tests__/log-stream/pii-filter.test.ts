import { describe, expect, it } from 'vitest'
import { stampAgentLogEvent, newAgentLogEventId, resetUlidStateForTests } from '@repo/agent-log-events'
import { applyPiiFilter } from '../../src/log-stream/pii-filter.js'

describe('pii-filter', () => {
  it('allows operational fields', () => {
    resetUlidStateForTests()
    const ev = stampAgentLogEvent(
      {
        level: 'info',
        source: 'pod_manager',
        event_code: 'pod_started',
        message: 'Pod started',
        fields: { account_id: 'acct-1', http_status: 200, role: 'ingestor' },
      },
      newAgentLogEventId(),
    )
    const out = applyPiiFilter(ev, { ownEmail: 'user@example.com' })
    expect(out.ok).toBe(true)
  })

  it('drops events with foreign email in message', () => {
    resetUlidStateForTests()
    const ev = stampAgentLogEvent(
      {
        level: 'info',
        source: 'agent',
        event_code: 'test_leak',
        message: 'Mail from sender@evil.com received',
        fields: {},
      },
      newAgentLogEventId(),
    )
    const out = applyPiiFilter(ev)
    expect(out.ok).toBe(false)
    if (!out.ok && out.drop) {
      expect(out.synthetic.event_code).toBe('event_dropped_pii_filter')
      expect(out.synthetic.fields.offending_event_code).toBe('test_leak')
    }
  })

  it('treats unknown field names as suspicious', () => {
    resetUlidStateForTests()
    const ev = stampAgentLogEvent(
      {
        level: 'info',
        source: 'agent',
        event_code: 'new_field_test',
        message: 'Operational update',
        fields: { surprise_payload: 'hello' },
      },
      newAgentLogEventId(),
    )
    const out = applyPiiFilter(ev)
    expect(out.ok).toBe(false)
  })
})
