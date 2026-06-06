/**
 * Guest↔host transport-integrity round-trip for the `depackage-email` signed
 * result (off-rig; no VM needed). The guest signs the IN-MEMORY result object;
 * the host verifies a JSON-WIRE-ROUND-TRIPPED copy. `JSON.stringify` drops
 * `undefined`-valued keys (e.g. an absent `DisplayEnvelope.from` or a sealed
 * artifact with no `filename`), so the canonical-bytes serializer MUST omit them
 * identically on both sides — otherwise the signature fails to verify on the rig.
 * This is a regression guard for exactly that determinism bug.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { runDepackageEmailJob } from '../emailDepackage'
import {
  verifyDepackageEmailResultSignature,
  type DepackageEmailJobResult,
} from '../hypervisorProvider'

function sandboxPubB64(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

function eml(headers: string[], body: string): Buffer {
  return Buffer.from([...headers, '', body].join('\r\n'), 'utf8')
}

/** Simulate the host receiving the guest's stdout: stringify then parse. */
function overTheWire(signed: DepackageEmailJobResult): DepackageEmailJobResult {
  return JSON.parse(JSON.stringify(signed)) as DepackageEmailJobResult
}

const PUB = sandboxPubB64()

describe('depackage-email signed result — guest↔host wire round-trip', () => {
  test('plain mail: signature verifies after JSON wire round-trip', () => {
    const signed = runDepackageEmailJob({
      jobId: 'sign-plain-1',
      inputBytes: eml(['Subject: hi', 'Content-Type: text/plain'], 'hello body'),
      sandboxPeerX25519PubB64: PUB,
    })
    expect(signed.result.ok).toBe(true)
    expect(typeof signed.result_signature_b64).toBe('string')
    // In-memory verifies, AND the wire-round-tripped copy verifies (the bug).
    expect(verifyDepackageEmailResultSignature(signed)).toBe(true)
    expect(verifyDepackageEmailResultSignature(overTheWire(signed))).toBe(true)
  })

  test('carrier mail (opaque package): signature verifies after wire round-trip', () => {
    const pkg = JSON.stringify({
      header: { encoding: 'qBEAP', handshake_id: 'hs-1' },
      metadata: { created_at: '2026-01-01T00:00:00Z' },
      envelope: { kem_ct: 'AAAA' },
    })
    const signed = runDepackageEmailJob({
      jobId: 'sign-carrier-1',
      inputBytes: eml(['Subject: pkg', 'Content-Type: text/plain'], pkg),
      sandboxPeerX25519PubB64: PUB,
    })
    expect(verifyDepackageEmailResultSignature(overTheWire(signed))).toBe(true)
  })

  test('structured-json (outlook) with attachment: verifies after wire round-trip', () => {
    const graph = Buffer.from(
      JSON.stringify({
        subject: 'Hi',
        body: { contentType: 'text', content: 'hello structured' },
        attachments: [
          {
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: 'a.bin',
            contentType: 'application/octet-stream',
            contentBytes: Buffer.from('SECRET').toString('base64'),
          },
        ],
      }),
      'utf8',
    )
    const signed = runDepackageEmailJob({
      jobId: 'sign-struct-1',
      inputBytes: graph,
      sandboxPeerX25519PubB64: PUB,
      inputForm: 'provider-structured-json',
      provider: 'outlook',
    })
    expect(signed.result.ok).toBe(true)
    expect(verifyDepackageEmailResultSignature(overTheWire(signed))).toBe(true)
  })

  test('worker failure verdict is signed and verifies after wire round-trip', () => {
    const big = Buffer.concat([
      Buffer.from('Subject: big\r\nContent-Type: text/plain\r\n\r\n'),
      Buffer.alloc(5000, 0x41),
    ])
    const signed = runDepackageEmailJob({
      jobId: 'sign-fail-1',
      inputBytes: big,
      sandboxPeerX25519PubB64: PUB,
      maxInputBytes: 200,
    })
    expect(signed.result.ok).toBe(false)
    expect(verifyDepackageEmailResultSignature(overTheWire(signed))).toBe(true)
  })

  test('tamper after signing is rejected (body bytes committed)', () => {
    const signed = runDepackageEmailJob({
      jobId: 'sign-tamper-1',
      inputBytes: eml(['Subject: hi', 'Content-Type: text/plain'], 'original body'),
      sandboxPeerX25519PubB64: PUB,
    })
    const wire = overTheWire(signed)
    const tampered = {
      ...wire,
      result:
        wire.result.ok && wire.result.type === 'plain'
          ? { ...wire.result, safeText: { ...wire.result.safeText, body_text: 'tampered body' } }
          : wire.result,
    } as DepackageEmailJobResult
    expect(verifyDepackageEmailResultSignature(tampered)).toBe(false)
  })
})
