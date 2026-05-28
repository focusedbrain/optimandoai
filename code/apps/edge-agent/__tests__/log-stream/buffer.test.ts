import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { stampAgentLogEvent, newAgentLogEventId, resetUlidStateForTests } from '@repo/agent-log-events'
import { AgentLogRingBuffer } from '../../src/log-stream/buffer.js'
import { bindAgentLogStream } from '../../src/log-stream/emit.js'

describe('AgentLogRingBuffer', () => {
  const dirs: string[] = []

  beforeEach(() => {
    resetUlidStateForTests()
  })

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  function makeEvent(code: string) {
    return stampAgentLogEvent(
      {
        level: 'info',
        source: 'agent',
        event_code: code,
        message: `Event ${code}`,
        fields: { count: 1 },
      },
      newAgentLogEventId(),
    )
  }

  it('append and peek round-trip with encryption', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-log-buf-'))
    dirs.push(dir)
    const buf = new AgentLogRingBuffer(dir)
    const a = makeEvent('a')
    const b = makeEvent('b')
    await buf.appendEvent(a)
    await buf.appendEvent(b)

    const peek = await buf.peekEvents(10, null)
    expect(peek.map((e) => e.event_code).sort()).toEqual(['a', 'b'])

    const raw = await readFile(join(dir, 'log-buffer', 'events.enc.jsonl'), 'utf8')
    expect(raw.includes('"event_code":"a"')).toBe(false)
  })

  it('ack removes events from subsequent peek', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-log-buf-'))
    dirs.push(dir)
    const buf = new AgentLogRingBuffer(dir)
    const a = makeEvent('ack_a')
    const b = makeEvent('ack_b')
    await buf.appendEvent(a)
    await buf.appendEvent(b)
    await buf.acknowledgeEvents(a.event_id)
    const peek = await buf.peekEvents(10, null)
    expect(peek.map((e) => e.event_code)).toEqual(['ack_b'])
  })

  it('skips corrupted trailing line on recovery', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-log-buf-'))
    dirs.push(dir)
    const buf = new AgentLogRingBuffer(dir)
    await buf.appendEvent(makeEvent('ok'))
    const path = join(dir, 'log-buffer', 'events.enc.jsonl')
    const { appendFileSync } = await import('node:fs')
    appendFileSync(path, 'not-valid-base64-gcm\n')
    await buf.recoverPartialTrailingLine()
    const peek = await buf.peekEvents(5, null)
    expect(peek).toHaveLength(1)
  })
})
