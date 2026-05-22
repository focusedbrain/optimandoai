import { describe, expect, it } from 'vitest'
import {
  notifyBeapDeliveryAck,
  resetBeapDeliveryAckWaitersForTests,
  waitForBeapDeliveryAck,
} from '../beapDeliveryAck'

describe('beapDeliveryAck', () => {
  it('waitForBeapDeliveryAck resolves when notify fires for the handshake', async () => {
    resetBeapDeliveryAckWaitersForTests()
    const p = waitForBeapDeliveryAck('hs-ack-1', 5000)
    notifyBeapDeliveryAck('hs-ack-1', 'row-42')
    await expect(p).resolves.toBe('row-42')
  })

  it('waitForBeapDeliveryAck times out when no notify', async () => {
    resetBeapDeliveryAckWaitersForTests()
    await expect(waitForBeapDeliveryAck('hs-miss', 30)).resolves.toBeNull()
  })

  it('waitForBeapDeliveryAck resolves from cache when notify arrived before waiter', async () => {
    resetBeapDeliveryAckWaitersForTests()
    notifyBeapDeliveryAck('hs-early', 'row-early')
    await expect(waitForBeapDeliveryAck('hs-early', 100)).resolves.toBe('row-early')
  })
})
