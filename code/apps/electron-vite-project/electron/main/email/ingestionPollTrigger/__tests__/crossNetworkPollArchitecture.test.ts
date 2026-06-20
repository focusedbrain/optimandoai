/**
 * B1 — architecture contract: ingestion poll must not depend on same-LAN direct HTTP.
 *
 * Static checks on the production poll path (post Phase A/A6). Does not replace
 * the two-machine cross-network operator runbook — proves code structure only.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const TRIGGER_DIR = join(__dirname, '..')

function readModule(basename: string): string {
  return readFileSync(join(TRIGGER_DIR, basename), 'utf8')
}

describe('cross-network poll architecture (B1 contract)', () => {
  it('host trigger production path uses sealed relay only (no direct HTTP transport)', () => {
    const src = readModule('hostTrigger.ts')
    expect(src).not.toMatch(/sendDedicatedSandboxIngestionPollTriggerViaDirectHttp/)
    expect(src).not.toMatch(/httpIngestionPollTransport/)
    expect(src).not.toMatch(/resolveSandboxPeerDirectBeapIngestEndpoint/)
    expect(src).not.toMatch(/isGenuineTwoDeviceHostSandboxPairForTrigger/)
    expect(src).toContain('sendSealedServiceRpcViaCoordinationRelay')
    expect(src).toContain('sealServiceRpcForRelay')
  })

  it('relay send posts to coordination_url only (identity routing, not peer LAN endpoint)', () => {
    const src = readModule('relaySend.ts')
    expect(src).toContain('sendCapsuleViaCoordination')
    expect(src).toContain('coordination_url')
    expect(src).not.toMatch(/51250/)
    expect(src).not.toMatch(/resolveSandboxPeerDirectBeapIngestEndpoint/)
    expect(src).not.toMatch(/p2p_endpoint/)
  })

  it('sandbox poll receive/response is sealed relay (no HTTP dispatch module)', () => {
    const relayHandler = readModule('relayCapsuleHandler.ts')
    expect(relayHandler).toContain('handleIngestionPollRequest')
    expect(relayHandler).toContain('sendSealedServiceRpcViaCoordinationRelay')

    const resultHandler = readModule('relayResultCapsuleHandler.ts')
    expect(resultHandler).toContain('openServiceRpcPayload')
    expect(resultHandler).toContain('resolveHostIngestionPollPending')

    expect(() => readModule('dispatch.ts')).toThrow()
    expect(() => readModule('send.ts')).toThrow()
  })

  it('direct-LAN p2pServer ingest module removed (sealed relay only)', () => {
    const p2pServerPath = join(TRIGGER_DIR, '..', '..', 'p2p', 'p2pServer.ts')
    expect(existsSync(p2pServerPath)).toBe(false)
  })

  it('default p2p config targets public relay (outbound dial, not LAN peer)', () => {
    const cfg = readFileSync(join(TRIGGER_DIR, '..', '..', 'p2p', 'p2pConfig.ts'), 'utf8')
    expect(cfg).toContain("coordination_url: 'https://relay.wrdesk.com'")
    expect(cfg).toContain("coordination_ws_url: 'wss://relay.wrdesk.com/beap/ws'")
    expect(cfg).toContain('use_coordination: true')
  })
})
