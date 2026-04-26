import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getP2pRelaySignalingCircuitOpenUntilMs,
  isP2pRelaySignalingCircuitOpen,
  recordP2pRelaySignaling429Storm,
  resetP2pRelaySignalingCircuitForTests,
} from '../p2pSignalRelayCircuit'

describe('p2pSignalRelayCircuit', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetP2pRelaySignalingCircuitForTests()
  })

  it('opens after 3 storms within 60s', () => {
    vi.useFakeTimers()
    const t0 = 1_000_000
    vi.setSystemTime(t0)
    recordP2pRelaySignaling429Storm()
    recordP2pRelaySignaling429Storm()
    expect(isP2pRelaySignalingCircuitOpen()).toBe(false)
    recordP2pRelaySignaling429Storm()
    expect(isP2pRelaySignalingCircuitOpen()).toBe(true)
    expect(getP2pRelaySignalingCircuitOpenUntilMs()).toBe(t0 + 30_000)
  })

  it('drops storms older than 60s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    recordP2pRelaySignaling429Storm()
    recordP2pRelaySignaling429Storm()
    vi.setSystemTime(61_000)
    recordP2pRelaySignaling429Storm()
    expect(isP2pRelaySignalingCircuitOpen()).toBe(false)
  })
})
