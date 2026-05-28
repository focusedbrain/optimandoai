import { describe, test, expect } from 'vitest'

import { sha256base64url, randomString } from '../src/pkce.js'
import { ORCHESTRATOR_OIDC, EDGE_AGENT_OIDC } from '../src/types.js'

describe('@repo/sso', () => {
  test('pkce challenge is deterministic', () => {
    expect(sha256base64url('verifier-abc')).toBe(sha256base64url('verifier-abc'))
    expect(randomString(16).length).toBeGreaterThan(10)
  })

  test('orchestrator and edge agent use distinct client ids', () => {
    expect(ORCHESTRATOR_OIDC.clientId).toBe('wrdesk-orchestrator')
    expect(EDGE_AGENT_OIDC.clientId).toBe('wrdesk-edge-agent')
    expect(ORCHESTRATOR_OIDC.issuer).toBe(EDGE_AGENT_OIDC.issuer)
  })
})
