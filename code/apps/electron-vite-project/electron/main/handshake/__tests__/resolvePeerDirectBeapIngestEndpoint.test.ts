/**
 * Peer direct `/beap/ingest` resolution — stale ledger port repair (coordination :51249 → ingest :51250).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  repairStalePeerDirectBeapIngestPort,
  resolveSandboxPeerDirectBeapIngestEndpoint,
} from '../resolvePeerDirectBeapIngestEndpoint'

const getP2PConfig = vi.hoisted(() =>
  vi.fn(() => ({
    port: 51250,
    coordination_url: 'http://192.168.178.28:51249',
  })),
)

vi.mock('../../p2p/p2pConfig', () => ({
  DEFAULT_P2P_CONFIG: { port: 51249 },
  getP2PConfig: (...args: unknown[]) => getP2PConfig(...args),
}))

vi.mock('../../internalInference/p2pEndpointRepair', () => ({
  normalizeP2pIngestUrl: (s: string) => {
    const u = new URL(s.trim())
    const path = u.pathname.replace(/\/$/, '') || '/beap/ingest'
    return `${u.protocol}//${u.hostname}:${u.port}${path}`
  },
  peekHostAdvertisedMvpDirectEntry: () => null,
  ingestUrlMatchesThisDevicesMvpDirectBeap: () => false,
}))

vi.mock('../../internalInference/policy', () => ({
  p2pEndpointMvpClass: () => 'direct_lan',
}))

describe('repairStalePeerDirectBeapIngestPort', () => {
  beforeEach(() => {
    getP2PConfig.mockReturnValue({
      port: 51250,
      coordination_url: 'http://192.168.178.28:51249',
    })
  })

  it('rewrites coordination port to canonical P2P ingest port', () => {
    const out = repairStalePeerDirectBeapIngestPort(
      {},
      'http://192.168.178.29:51249/beap/ingest',
    )
    expect(out).toBe('http://192.168.178.29:51250/beap/ingest')
  })

  it('leaves already-correct ingest port unchanged', () => {
    expect(
      repairStalePeerDirectBeapIngestPort({}, 'http://192.168.178.29:51250/beap/ingest'),
    ).toBeNull()
  })
})

describe('resolveSandboxPeerDirectBeapIngestEndpoint', () => {
  beforeEach(() => {
    getP2PConfig.mockReturnValue({
      port: 51250,
      coordination_url: 'http://192.168.178.28:51249',
    })
  })

  it('prefers repaired :51250 over stale ledger :51249', () => {
    const out = resolveSandboxPeerDirectBeapIngestEndpoint(
      {},
      'hs-1',
      'http://192.168.178.29:51249/beap/ingest',
    )
    expect(out).toBe('http://192.168.178.29:51250/beap/ingest')
  })

  it('returns null when ledger is missing or not direct ingest', () => {
    expect(resolveSandboxPeerDirectBeapIngestEndpoint({}, 'hs-1', '')).toBeNull()
    expect(resolveSandboxPeerDirectBeapIngestEndpoint({}, 'hs-1', 'http://relay:51249/beap/capsule')).toBeNull()
  })
})
