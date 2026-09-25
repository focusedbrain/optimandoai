/**
 * The product route to the WR Code surface. `handleHandshakeRPC` owns the
 * wrc.* cases; the main-process dispatchers (renderer RPC and the extension
 * WebSocket) are the only production callers. Every WR Code effect requires a
 * signed-in account, so both routes must check the SSO session first and must
 * not honour the caller-supplied `skipVaultContext` escape the handshake.*
 * route has.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const mainSource = readFileSync(join(here, '..', '..', '..', 'main.ts'), 'utf8')
const ipcSource = readFileSync(join(here, '..', '..', 'handshake', 'ipc.ts'), 'utf8')

function wrcRouteBlocks(): string[] {
  const blocks: string[] = []
  const marker = /startsWith\('wrc\.'\)/g
  for (const m of mainSource.matchAll(marker)) {
    const start = m.index ?? 0
    const end = mainSource.indexOf('handleHandshakeRPC', start)
    blocks.push(mainSource.slice(start, end))
  }
  return blocks
}

describe('wrc.* product route', () => {
  it('exists in both main-process dispatchers', () => {
    expect(wrcRouteBlocks()).toHaveLength(2)
  })

  it('checks the SSO session before dispatch and has no skipVaultContext escape', () => {
    for (const block of wrcRouteBlocks()) {
      expect(block).toMatch(/if \(!getCurrentSession\(\)\)/)
      expect(block).toMatch(/No active session/)
      expect(block).not.toMatch(/skipVaultContext/)
    }
  })

  it('routes to the five WR Code methods the dispatcher implements', () => {
    for (const method of [
      'wrc.captureReference',
      'wrc.detectReferences',
      'wrc.submitReference',
      'wrc.acceptReference',
      'wrc.resolvePublisher',
    ]) {
      expect(ipcSource).toContain(`case '${method}':`)
    }
  })
})
