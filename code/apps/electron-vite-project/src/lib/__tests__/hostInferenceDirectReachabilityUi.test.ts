import { describe, it, expect } from 'vitest'
import {
  directP2pReachabilityCopyForHostToSandbox,
  directP2pReachabilityCopyForSandboxToHost,
} from '../hostInferenceUiGates'

describe('directP2pReachabilityCopyForSandboxToHost', () => {
  it('reachable does not show a banner', () => {
    expect(directP2pReachabilityCopyForSandboxToHost('reachable')).toBeNull()
  })

  it('null / unknown does not show a banner', () => {
    expect(directP2pReachabilityCopyForSandboxToHost(null)).toBeNull()
    expect(directP2pReachabilityCopyForSandboxToHost('unknown')).toBeNull()
  })

  it('tls maps to failure copy + network hint', () => {
    const u = directP2pReachabilityCopyForSandboxToHost('tls_error')
    expect(u?.primary).toBe('Connection to host failed')
    expect(u?.hint).toMatch(/Firewall or network/i)
  })
})

describe('directP2pReachabilityCopyForHostToSandbox', () => {
  it('reachable does not show a banner', () => {
    expect(directP2pReachabilityCopyForHostToSandbox('reachable')).toBeNull()
  })
})
