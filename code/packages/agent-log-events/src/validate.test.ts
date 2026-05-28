import { describe, expect, it } from 'vitest'
import { newAgentLogEventId, resetUlidStateForTests } from './ulid.js'
import {
  AgentLogValidationError,
  stampAgentLogEvent,
  validateAgentLogEventInput,
} from './validate.js'

describe('agent-log-events validate', () => {
  it('accepts every valid level', () => {
    for (const level of ['debug', 'info', 'warn', 'error', 'critical'] as const) {
      expect(() =>
        validateAgentLogEventInput({
          level,
          source: 'agent',
          event_code: 'test',
          message: 'ok',
          fields: {},
        }),
      ).not.toThrow()
    }
  })

  it('rejects unknown level and nested fields', () => {
    expect(() =>
      validateAgentLogEventInput({
        level: 'fatal' as 'info',
        source: 'agent',
        event_code: 'x',
        message: 'x',
        fields: {},
      }),
    ).toThrow(AgentLogValidationError)

    expect(() =>
      validateAgentLogEventInput({
        level: 'info',
        source: 'agent',
        event_code: 'x',
        message: 'x',
        fields: { nested: { a: 1 } as unknown as string },
      }),
    ).toThrow(AgentLogValidationError)
  })

  it('stamps event_id, timestamp, schema_version', () => {
    resetUlidStateForTests()
    const id = newAgentLogEventId(1_700_000_000_000)
    const ev = stampAgentLogEvent(
      {
        level: 'info',
        source: 'pod_manager',
        event_code: 'pod_started',
        message: 'Pod started',
        fields: { count: 1 },
      },
      id,
      new Date('2026-05-25T12:00:00.000Z'),
    )
    expect(ev.event_id).toBe(id)
    expect(ev.schema_version).toBe(1)
    expect(ev.timestamp_iso).toBe('2026-05-25T12:00:00.000Z')
  })

  it('event_id is unique within a session', () => {
    resetUlidStateForTests()
    const a = newAgentLogEventId()
    const b = newAgentLogEventId()
    expect(a).not.toBe(b)
  })
})
