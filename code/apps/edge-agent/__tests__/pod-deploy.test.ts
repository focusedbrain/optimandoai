import { describe, test, expect } from 'vitest'

import { substituteManifest, buildLaunchEnv } from '../src/pod-deploy.js'

describe('pod deploy helpers', () => {
  test('substituteManifest replaces placeholders', () => {
    const yaml = 'secret: ${POD_AUTH_SECRET}\nid: ${EDGE_POD_ID}'
    const out = substituteManifest(yaml, {
      POD_AUTH_SECRET: 'abc',
      EDGE_POD_ID: 'pod-1',
    })
    expect(out).toContain('secret: abc')
    expect(out).toContain('id: pod-1')
  })

  test('buildLaunchEnv includes required keys', () => {
    const env = buildLaunchEnv({
      podAuthSecret: 's',
      edgePrivateKeyHex: 'a'.repeat(64),
      edgePodId: 'uuid',
      ssoAttestationJwt: 'jwt',
      certTtlSeconds: 3600,
    })
    expect(env.POD_AUTH_SECRET).toBe('s')
    expect(env.SSO_ATTESTATION_JWT).toBe('jwt')
    expect(env.CERT_TTL_SECONDS).toBe('3600')
  })
})
