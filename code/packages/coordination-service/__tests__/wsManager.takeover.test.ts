/**
 * Relay takeover of a (user, device) connection: the replaced socket closes after the new
 * one registered and must not remove the new registration (live push would miss the device).
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createWsManager } from '../src/wsManager.js'

class FakeSocket extends EventEmitter {
  terminated = false
  send(): void {}
  terminate(): void {
    this.terminated = true
    // A real socket emits 'close' asynchronously after terminate().
    setImmediate(() => this.emit('close'))
  }
}

const store = {
  getPendingCapsules: () => [],
  markPushed: () => {},
  getPendingDeviceAggregateForUser: () => [],
} as never

const identity = { userId: 'u1', email: 'a@x.test', iss: 'https://idp' } as never

describe('wsManager takeover', () => {
  it('the replaced socket closing does not deregister the new connection', async () => {
    const m = createWsManager(store)
    const first = new FakeSocket()
    const second = new FakeSocket()
    m.handleConnection(first as never, identity, 'dev-1')
    m.handleConnection(second as never, identity, 'dev-1')
    expect(first.terminated).toBe(true)
    await new Promise((r) => setImmediate(r))
    expect(m.getClientsByUser('u1').map((c) => c.ws)).toEqual([second])
  })

  it('the current socket closing deregisters it', async () => {
    const m = createWsManager(store)
    const only = new FakeSocket()
    m.handleConnection(only as never, identity, 'dev-1')
    only.emit('close')
    expect(m.getClientsByUser('u1')).toEqual([])
  })
})
