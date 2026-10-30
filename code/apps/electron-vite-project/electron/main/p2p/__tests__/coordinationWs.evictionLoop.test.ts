/**
 * Regression: relay WebSocket eviction loop.
 *
 * The relay keeps one connection per (user, device) and terminates the older one when a
 * second arrives (`packages/coordination-service/src/wsManager.ts`). A second connect()
 * from the same client (e.g. the outbound queue's delivery-ack ensure while the first
 * socket was still opening) used to create a second socket; the evicted socket's close
 * then cleared the shared reference and started another connect — reconnecting about
 * once a second forever. This test runs the real client against a loopback server with
 * the relay's eviction rule.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createCoordinationWsClient } from '../coordinationWs'
import type { P2PConfig } from '../p2pConfig'

function startEvictingRelay(): Promise<{
  port: number
  connections: () => number
  open: () => number
  lastDeviceId: () => string
  close: () => Promise<void>
}> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    const byKey = new Map<string, ServerSocket>()
    let total = 0
    let lastKey = 'default'
    wss.on('connection', (sock, req) => {
      total++
      const key = new URL(req.url ?? '/', 'http://x').searchParams.get('device_id') ?? 'default'
      if (total === 1) lastKey = key
      byKey.get(key)?.terminate()
      byKey.set(key, sock)
      sock.on('close', () => {
        if (byKey.get(key) === sock) byKey.delete(key)
      })
    })
    wss.on('listening', () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        connections: () => total,
        open: () => [...wss.clients].filter((c) => c.readyState === c.OPEN).length,
        lastDeviceId: () => lastKey,
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate()
            wss.close(() => r())
          }),
      })
    })
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('coordination WebSocket — no eviction loop', () => {
  let cleanup: Array<() => unknown> = []
  afterEach(async () => {
    for (const c of cleanup.reverse()) await c()
    cleanup = []
  })

  it('concurrent connect() calls keep exactly one socket and stop reconnecting', async () => {
    const relay = await startEvictingRelay()
    cleanup.push(relay.close)
    const config = {
      use_coordination: true,
      coordination_enabled: true,
      coordination_url: '',
      coordination_ws_url: `ws://127.0.0.1:${relay.port}/beap/ws`,
    } as unknown as P2PConfig
    const client = createCoordinationWsClient(config, () => null, () => undefined, async () => 'tok')
    cleanup.push(() => client.disconnect())

    // Startup connect plus two "ensure connected" calls while the first is still opening.
    await Promise.allSettled([client.connect(), client.connect(), client.connect()])
    await sleep(300)
    // And again once it is open.
    await client.connect()

    // The client reconnects after 1 s on any unplanned close; a loop would show up here.
    await sleep(3500)
    expect(relay.connections()).toBe(1)
    expect(relay.open()).toBe(1)
    expect(client.isConnected()).toBe(true)
  }, 15_000)

  it('after a real server-side close the client reconnects once, not in a loop', async () => {
    const relay = await startEvictingRelay()
    cleanup.push(relay.close)
    const config = {
      use_coordination: true,
      coordination_enabled: true,
      coordination_url: '',
      coordination_ws_url: `ws://127.0.0.1:${relay.port}/beap/ws`,
    } as unknown as P2PConfig
    const client = createCoordinationWsClient(config, () => null, () => undefined, async () => 'tok')
    cleanup.push(() => client.disconnect())

    await client.connect()
    await sleep(200)
    // Another socket with the client's device id evicts the client once (as a second app
    // instance or a relay-side takeover would). The client reconnects once, evicting the
    // other socket in turn, and then stays put.
    const { default: WebSocket } = await import('ws')
    const other = new WebSocket(`ws://127.0.0.1:${relay.port}/beap/ws?device_id=${encodeURIComponent(relay.lastDeviceId())}`)
    cleanup.push(() => other.close())
    await sleep(3500)
    expect(relay.connections()).toBe(3)
    expect(client.isConnected()).toBe(true)
  }, 15_000)
})
