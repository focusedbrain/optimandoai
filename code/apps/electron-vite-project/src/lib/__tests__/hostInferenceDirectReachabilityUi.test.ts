import { describe, it, expect } from 'vitest'
import {
  directP2pReachabilityCopyForHostToSandbox,
  directP2pReachabilityCopyForSandboxToHost,
} from '../hostInferenceUiGates'

describe('directP2pReachabilityCopyForSandboxToHost', () => {
  it('reachable is friendly', () => {
    const u = directP2pReachabilityCopyForSandboxToHost('reachable')
    expect(u.primary).toBe('Host reachable')
    expect(u.hint).toBeNull()
  })

  it('tls maps to network hint', () => {
    const u = directP2pReachabilityCopyForSandboxToHost('tls_error')
    expect(u.primary).toBe('Host not directly reachable')
    expect(u.hint).toMatch(/Firewall or network/i)
  })
})

describe('directP2pReachabilityCopyForHostToSandbox', () => {
  it('reachable shows Sandbox as reachable', () => {
    const u = directP2pReachabilityCopyForHostToSandbox('reachable')
    expect(u.primary).toBe('Sandbox reachable')
  })
})
