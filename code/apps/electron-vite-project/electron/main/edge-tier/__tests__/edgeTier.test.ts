/**
 * Edge tier — unit tests (P3.8)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { generateEdgeKeypair, verifyEdgeKeypairRoundTrip } from '../keygen.js'
import {
  _setSettingsPathForTest,
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  setEdgeTierEnabled,
  DEFAULT_EDGE_TIER_SETTINGS,
} from '../settings.js'
import { parseJwksResponse, refreshJwksCache, getCachedJwksJson } from '../jwks.js'
import { clearDiscoveryCache } from '../../../../src/auth/discovery.js'
import {
  encryptEdgePrivateKeyHex,
  decryptEdgePrivateKeyHex,
} from '../keyStorage.js'
import { requestSsoAttestation } from '../attestation.js'

describe('generateEdgeKeypair', () => {
  test('produces a valid Ed25519 keypair (sign/verify round-trip)', () => {
    const keypair = generateEdgeKeypair()
    expect(keypair.privateKeyHex).toHaveLength(64)
    expect(keypair.publicKeyHex).toHaveLength(64)
    expect(keypair.publicKeyClaim).toMatch(/^ed25519:[0-9a-f]{64}$/)
    expect(keypair.podId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(verifyEdgeKeypairRoundTrip(keypair)).toBe(true)
  })
})

describe('edge private key encryption', () => {
  const vault = {
    deriveApplicationKey: () => Buffer.alloc(32, 7),
  }

  test('encrypt/decrypt round-trip', () => {
    const plain = 'ab'.repeat(32)
    const enc = encryptEdgePrivateKeyHex(plain, vault)
    expect(enc).not.toContain(plain)
    expect(decryptEdgePrivateKeyHex(enc, vault)).toBe(plain)
  })
})

describe('JWKS fetch and cache', () => {
  let tempDir: string

  beforeEach(() => {
    clearDiscoveryCache()
    tempDir = mkdtempSync(join(tmpdir(), 'edge-tier-jwks-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    saveEdgeTierSettings({ ...DEFAULT_EDGE_TIER_SETTINGS })
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  test('parseJwksResponse accepts valid JWKS', () => {
    const jwks = parseJwksResponse({ keys: [{ kty: 'RSA', kid: 'test' }] })
    expect(jwks.keys).toHaveLength(1)
  })

  test('refreshJwksCache fetches and persists JWKS', async () => {
    const sample = { keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'kc-1' }] }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('.well-known/openid-configuration')) {
          return {
            ok: true,
            json: async () => ({
              authorization_endpoint: 'https://auth.example/realms/x/protocol/openid-connect/auth',
              token_endpoint: 'https://auth.example/realms/x/protocol/openid-connect/token',
              jwks_uri: 'https://auth.example/realms/x/protocol/openid-connect/certs',
              issuer: 'https://auth.wrdesk.com/realms/wrdesk',
            }),
          }
        }
        return { ok: true, json: async () => sample }
      }),
    )

    const json = await refreshJwksCache()
    expect(JSON.parse(json)).toEqual(sample)
    expect(getCachedJwksJson(loadEdgeTierSettings())).toBe(json)
  })
})

describe('requestSsoAttestation (stub mode)', () => {
  const prev = process.env['BEAP_ATTESTATION_STUB']

  beforeEach(() => {
    process.env['BEAP_ATTESTATION_STUB'] = '1'
  })

  afterEach(() => {
    if (prev === undefined) delete process.env['BEAP_ATTESTATION_STUB']
    else process.env['BEAP_ATTESTATION_STUB'] = prev
  })

  test('returns JWT binding podId and public key', async () => {
    const keypair = generateEdgeKeypair()
    const { jwt } = await requestSsoAttestation(
      keypair.publicKeyHex,
      keypair.podId,
      'header.payload.sig',
    )
    expect(jwt.split('.')).toHaveLength(3)
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'))
    expect(payload.pod_id).toBe(keypair.podId)
    expect(payload.edge_pubkey).toBe(keypair.publicKeyClaim)
  })
})

describe('setEdgeTierEnabled', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'edge-tier-settings-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('persists enabled flag', () => {
    expect(loadEdgeTierSettings().enabled).toBe(false)
    setEdgeTierEnabled(true)
    expect(loadEdgeTierSettings().enabled).toBe(true)
  })
})
