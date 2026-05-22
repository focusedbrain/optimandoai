import { describe, it, expect } from 'vitest'
import { parseDirectIngestHttpAck } from '../p2pTransport'

describe('parseDirectIngestHttpAck', () => {
  it('parses persisted_inbox and row_id', () => {
    const ack = parseDirectIngestHttpAck(
      JSON.stringify({ accepted: true, persisted_inbox: true, row_id: 'row-abc', correlation_id: 'c1' }),
    )
    expect(ack?.persisted_inbox).toBe(true)
    expect(ack?.row_id).toBe('row-abc')
  })

  it('returns null for invalid JSON', () => {
    expect(parseDirectIngestHttpAck('not-json')).toBeNull()
  })
})
