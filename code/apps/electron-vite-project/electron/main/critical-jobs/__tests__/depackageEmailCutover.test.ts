/**
 * B2 dev-box cutover proofs (in-process resolution): the live adapter routes a
 * `depackage-email` job through the dispatcher and returns the typed union, and
 * every INV-7 failure class fails CLOSED through the seam (never an inline parse).
 * Also pins INV-1: an untrusted-content kind NEVER runs in-process on workstation.
 *
 * These are the dev-box analogue of exit criterion 2 (the rig microVM e2e is
 * exit criterion 3, gated on Phase 0 / the mini-PC).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { dispatchDepackageEmail } from '../liveDepackageCutover'

function sandboxPubB64(): string {
  const priv = x25519.utils.randomPrivateKey()
  return Buffer.from(x25519.getPublicKey(priv)).toString('base64')
}
const PUB = sandboxPubB64()

function eml(headers: string[], parts: string): Buffer {
  return Buffer.from([...headers, '', parts].join('\r\n'), 'utf8')
}

const QBEAP_PKG = JSON.stringify({
  header: { encoding: 'qBEAP', handshake_id: 'hs-1' },
  metadata: { created_at: '2026-01-01T00:00:00Z' },
  envelope: { kem_ct: 'AAAA' },
})

describe('B2 dev-box cutover — sandbox role (in-process)', () => {
  beforeAll(() => { process.env.WRDESK_ROLE = 'sandbox' })
  afterAll(() => { delete process.env.WRDESK_ROLE })

  test('plain mail → dispatch ok, typed union plain', async () => {
    const out = await dispatchDepackageEmail(
      eml(['Subject: Hi', 'Content-Type: text/plain'], 'hello body'),
      PUB,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) return
    expect(out.result.type).toBe('plain')
  })

  test('carrier mail → typed union beap-carrier with opaque package', async () => {
    const out = await dispatchDepackageEmail(
      eml(['Subject: pkg', 'Content-Type: text/plain'], QBEAP_PKG),
      PUB,
    )
    expect(out.ok).toBe(true)
    if (!out.ok || !out.result.ok) return
    expect(out.result.type).toBe('beap-carrier')
    if (out.result.type !== 'beap-carrier') return
    expect(out.result.packages.length).toBe(1)
    expect(Buffer.from(out.result.packages[0].bytesB64, 'base64').toString('utf8')).toBe(QBEAP_PKG)
  })

  test('INV-7: over-limit input fails closed with typed worker code', async () => {
    const big = Buffer.concat([
      Buffer.from('Subject: big\r\nContent-Type: text/plain\r\n\r\n'),
      Buffer.alloc(5000, 0x41),
    ])
    const out = await dispatchDepackageEmail(big, PUB, 200)
    expect(out.ok).toBe(true) // dispatch succeeded; worker produced a verdict
    if (!out.ok) return
    expect(out.result.ok).toBe(false)
    if (out.result.ok) return
    expect(out.result.code).toBe('E_LIMITS_EXCEEDED')
  })

  test('INV-7: ambiguous carrier classification fails closed', async () => {
    const weird = JSON.stringify({ header: { encoding: 'xBEAP' }, metadata: {}, payload: 'x' })
    const out = await dispatchDepackageEmail(eml(['Subject: w', 'Content-Type: text/plain'], weird), PUB)
    expect(out.ok).toBe(true)
    if (!out.ok || out.result.ok) return
    expect(out.result.code).toBe('E_AMBIGUOUS_CLASSIFICATION')
  })
})

describe('B2 cutover — INV-1 workstation ban', () => {
  beforeAll(() => { process.env.WRDESK_ROLE = 'workstation' })
  afterAll(() => { delete process.env.WRDESK_ROLE })

  test('depackage-email NEVER runs in-process on workstation (fails closed)', async () => {
    const out = await dispatchDepackageEmail(
      eml(['Subject: Hi', 'Content-Type: text/plain'], 'hello'),
      PUB,
    )
    // Routed to the remote stub (unavailable until Build C) → dispatch fails
    // closed; it is NEVER parsed in-process on the workstation.
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(['E_EXECUTOR_UNAVAILABLE', 'E_NO_EXECUTOR', 'E_UNSUPPORTED_KIND']).toContain(out.code)
  })
})
