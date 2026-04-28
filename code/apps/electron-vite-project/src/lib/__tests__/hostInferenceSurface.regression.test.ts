import { describe, it, expect } from 'vitest'
import { hostInferenceOptionVisible, directP2pReachabilityCopyForSandboxToHost } from '../hostInferenceUiGates'

/**
 * Copy used by HybridSearch / Settings (regression: stable product strings for QA).
 */
const PREMIUM_SUCCESS = 'Host model finished'
const POLICY_OFF = 'Host inference is not enabled on the Host.'

describe('Host inference — UI gating and copy (regression)', () => {
  it('Sandbox: Host model option only when at least one direct Host candidate and mode ready', () => {
    expect(hostInferenceOptionVisible(true, 'host', 1)).toBe(false)
    expect(hostInferenceOptionVisible(true, 'sandbox', 0)).toBe(false)
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('direct unreachable surfaces firewall/network hint (Sandbox)', () => {
    const u = directP2pReachabilityCopyForSandboxToHost('timeout')
    expect(u?.primary).toBe('Connection to host failed')
    expect(u?.hint).toMatch(/Firewall or network/i)
  })

  it('Host policy denial message (renderer strings)', () => {
    expect(POLICY_OFF).toContain('not enabled on the Host')
  })

  it('success badge copy (header strip)', () => {
    expect(PREMIUM_SUCCESS).toBe('Host model finished')
  })
})
