import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logHostAiTransportDecideListLine,
  resetHostAiTransportDecideDedupeForTests,
} from '../hostAiTransportDecideLog'

describe('logHostAiTransportDecideListLine', () => {
  beforeEach(() => {
    resetHostAiTransportDecideDedupeForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    resetHostAiTransportDecideDedupeForTests()
  })

  it('suppresses a second line in the same second when the decision fingerprint matches', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logHostAiTransportDecideListLine({
      handshakeId: 'hs-1',
      decisionFingerprint: 'a|b|c',
      line: '[HOST_AI_TRANSPORT_DECIDE] first chain=aaa',
    })
    logHostAiTransportDecideListLine({
      handshakeId: 'hs-1',
      decisionFingerprint: 'a|b|c',
      line: '[HOST_AI_TRANSPORT_DECIDE] second chain=bbb',
    })
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0][0])).toContain('chain=aaa')
  })

  it('allows another line when the fingerprint changes in the same second', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    logHostAiTransportDecideListLine({
      handshakeId: 'hs-1',
      decisionFingerprint: 'x',
      line: 'one',
    })
    logHostAiTransportDecideListLine({
      handshakeId: 'hs-1',
      decisionFingerprint: 'y',
      line: 'two',
    })
    expect(log).toHaveBeenCalledTimes(2)
  })
})
