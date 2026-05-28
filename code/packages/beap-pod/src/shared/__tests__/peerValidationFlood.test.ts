import { describe, test, expect, beforeEach } from 'vitest'

import {
  recordPeerValidationFailure,
  resetPeerValidationFloodForTests,
  peerIdFromTransport,
} from '../peerValidationFlood.js'
import { PEER_VALIDATION_FLOOD_MAX } from '../failurePolicy.js'

describe('peerValidationFlood', () => {
  beforeEach(() => {
    resetPeerValidationFloodForTests()
  })

  test('peerIdFromTransport combines address and message id', () => {
    expect(peerIdFromTransport('1.2.3.4', 'msg-1')).toBe('1.2.3.4|msg-1')
  })

  test(`returns peer_validation_flood after ${PEER_VALIDATION_FLOOD_MAX} failures`, () => {
    const peer = 'peer-a'
    const t0 = 1_000_000
    for (let i = 0; i < PEER_VALIDATION_FLOOD_MAX - 1; i++) {
      expect(recordPeerValidationFailure(peer, t0 + i)).toBeNull()
    }
    expect(recordPeerValidationFailure(peer, t0 + PEER_VALIDATION_FLOOD_MAX - 1)).toBe(
      'peer_validation_flood',
    )
  })

  test('counter resets outside window', () => {
    const peer = 'peer-b'
    const t0 = 0
    for (let i = 0; i < PEER_VALIDATION_FLOOD_MAX; i++) {
      recordPeerValidationFailure(peer, t0 + i)
    }
    expect(recordPeerValidationFailure(peer, 120_000)).toBeNull()
  })
})
