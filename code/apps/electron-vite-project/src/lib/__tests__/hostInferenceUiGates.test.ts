import { describe, it, expect } from 'vitest'
import {
  hostInferenceDirectUnavailableMessage,
  hostInferenceOptionVisible,
  hostInferenceSelectorMultiple,
  hostInferenceSetupMessageVisible,
} from '../hostInferenceUiGates'

describe('hostInferenceUiGates', () => {
  it('hides option on Host orchestrator', () => {
    expect(hostInferenceOptionVisible(true, 'host', 1)).toBe(false)
  })

  it('shows option on Sandbox with active direct Host', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('shows setup when no Host', () => {
    expect(hostInferenceSetupMessageVisible(true, 'sandbox', false, 0)).toBe(true)
  })

  it('multiple hosts => selector (more than one)', () => {
    expect(hostInferenceSelectorMultiple(true, 'sandbox', 2)).toBe(true)
    expect(hostInferenceSelectorMultiple(true, 'sandbox', 1)).toBe(false)
  })

  it('direct unavailable text', () => {
    expect(hostInferenceDirectUnavailableMessage(false)).toMatch(/P2P unavailable|network|firewall/i)
    expect(hostInferenceDirectUnavailableMessage(true)).toBeNull()
  })
})
