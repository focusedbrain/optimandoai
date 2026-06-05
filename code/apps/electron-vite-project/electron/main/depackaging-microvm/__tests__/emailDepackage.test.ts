/**
 * B2 Phase 1 worker tests: typed result union, HTML→SafeText derivation (R1),
 * verbatim carrier extraction (R3), opaque package channel, and the INV-7
 * failure taxonomy + C4 hardening.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { depackageEmail } from '../emailDepackage'
import { htmlToSafeText } from '../htmlToText'

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
const PBEAP_PKG = JSON.stringify({
  header: { encoding: 'pBEAP' },
  metadata: { created_at: '2026-01-01T00:00:00Z' },
  payload: 'eyJzdWJqZWN0IjoiaGkifQ==',
})

describe('B2 worker — plain mail', () => {
  test('text/plain only → type plain, body verbatim, no packages', () => {
    const r = depackageEmail(
      eml(['Subject: Hi', 'Content-Type: text/plain; charset=utf-8'], 'Hello plain world'),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.type).toBe('plain')
    if (r.type !== 'plain') return
    expect(r.safeText.body_text).toContain('Hello plain world')
    expect(r.artifacts.length).toBe(0)
  })

  test('HTML-only → body derived via htmlToSafeText (R1), HTML sealed as artifact', () => {
    const html = '<h1>Title</h1><p>Hello <a href="https://example.com/x">link</a></p>'
    const r = depackageEmail(
      eml(['Subject: H', 'Content-Type: text/html; charset=utf-8'], html),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok || r.type !== 'plain') return
    // body equals the R1 derivation (modulo SafeText discipline, which is a no-op here)
    expect(r.safeText.body_text).toBe(htmlToSafeText(html))
    // original HTML preserved as a sealed artifact
    expect(r.artifacts.length).toBe(1)
    expect(r.artifacts[0].content_type).toBe('text/html')
  })

  test('multipart/alternative → text/plain preferred over HTML (parity)', () => {
    const b = 'BOUND'
    const body = [
      `--${b}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain leg wins',
      `--${b}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML leg</p>',
      `--${b}--`,
      '',
    ].join('\r\n')
    const r = depackageEmail(
      eml(['Subject: Alt', `Content-Type: multipart/alternative; boundary="${b}"`], body),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok || r.type !== 'plain') return
    expect(r.safeText.body_text).toContain('Plain leg wins')
    expect(r.safeText.body_text).not.toContain('HTML leg')
    expect(r.artifacts.length).toBe(1) // HTML sealed
  })
})

describe('B2 worker — carrier extraction (R3)', () => {
  test('qBEAP body package → beap-carrier, opaque package bytes byte-identical', () => {
    const r = depackageEmail(
      eml(['Subject: pkg', 'Content-Type: text/plain; charset=utf-8'], QBEAP_PKG),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok || r.type !== 'beap-carrier') return
    expect(r.packages.length).toBe(1)
    expect(r.packages[0].encodingHint).toBe('qBEAP')
    expect(Buffer.from(r.packages[0].bytesB64, 'base64').toString('utf8')).toBe(QBEAP_PKG)
  })

  test('.beap attachment (pBEAP) → extracted to opaque channel, not sealed', () => {
    const b = 'B2'
    const body = [
      `--${b}`,
      'Content-Type: text/plain',
      '',
      'see attached',
      `--${b}`,
      'Content-Type: application/vnd.beap+json; name="msg.beap"',
      'Content-Disposition: attachment; filename="msg.beap"',
      '',
      PBEAP_PKG,
      `--${b}--`,
      '',
    ].join('\r\n')
    const r = depackageEmail(
      eml(['Subject: c', `Content-Type: multipart/mixed; boundary="${b}"`], body),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // body text present → mixed
    expect(r.type).toBe('mixed')
    if (r.type !== 'mixed') return
    expect(r.packages.length).toBe(1)
    expect(r.packages[0].encodingHint).toBe('pBEAP')
    expect(Buffer.from(r.packages[0].bytesB64, 'base64').toString('utf8')).toBe(PBEAP_PKG)
    // the .beap package is NOT among the sealed artifacts
    expect(r.artifacts.length).toBe(0)
  })

  test('plain mail WITH a normal .json attachment is NOT a carrier (not ambiguous)', () => {
    const b = 'B3'
    const body = [
      `--${b}`,
      'Content-Type: text/plain',
      '',
      'hello',
      `--${b}`,
      'Content-Type: application/json; name="data.json"',
      'Content-Disposition: attachment; filename="data.json"',
      '',
      '{"just":"data"}',
      `--${b}--`,
      '',
    ].join('\r\n')
    const r = depackageEmail(
      eml(['Subject: j', `Content-Type: multipart/mixed; boundary="${b}"`], body),
      PUB,
    )
    expect(r.ok).toBe(true)
    if (!r.ok || r.type !== 'plain') return
    expect(r.artifacts.length).toBe(1) // json sealed as artifact
  })
})

describe('B2 worker — INV-7 failure taxonomy + C4 hardening', () => {
  test('input over maxInputBytes fails closed (E_LIMITS_EXCEEDED), not truncated', () => {
    const big = Buffer.concat([
      Buffer.from('Subject: big\r\nContent-Type: text/plain\r\n\r\n'),
      Buffer.alloc(2000, 0x41),
    ])
    const r = depackageEmail(big, PUB, { maxInputBytes: 100 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_LIMITS_EXCEEDED')
  })

  test('ambiguous carrier (.beap attachment that is not a valid package) → quarantine', () => {
    const b = 'B4'
    const body = [
      `--${b}`,
      'Content-Type: text/plain',
      '',
      'hi',
      `--${b}`,
      'Content-Type: application/x-beap; name="weird.beap"',
      'Content-Disposition: attachment; filename="weird.beap"',
      '',
      'not-a-json-package',
      `--${b}--`,
      '',
    ].join('\r\n')
    const r = depackageEmail(
      eml(['Subject: a', `Content-Type: multipart/mixed; boundary="${b}"`], body),
      PUB,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_AMBIGUOUS_CLASSIFICATION')
  })

  test('package-shaped body with UNKNOWN encoding → ambiguous (INV-7), not plain', () => {
    const weird = JSON.stringify({ header: { encoding: 'xBEAP' }, metadata: {}, payload: 'x' })
    const r = depackageEmail(
      eml(['Subject: w', 'Content-Type: text/plain'], weird),
      PUB,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_AMBIGUOUS_CLASSIFICATION')
  })
})
