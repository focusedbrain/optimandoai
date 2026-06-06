/**
 * Build 2b safe-slice — live pBEAP trust wiring.
 *
 * Proves the live path no longer silently trusts pBEAP: classification is
 * explicit and NEVER `verified_bound` unless the sender is bound to a known
 * counterparty AND the signature verifies over real signing bytes. Today the
 * call sites pass no signing bytes => `unverified_public` with a precise reason.
 */

import { describe, test, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { classifyLivePbeapTrust, pbeapTrustMetadata } from '../livePbeapTrust'
import type { KnownCounterparty } from '../pbeapTrust'

describe('classifyLivePbeapTrust — stop blind-trusting pBEAP', () => {
  test('no header / garbage header => unverified_public (no fingerprint)', () => {
    expect(classifyLivePbeapTrust({ header: undefined }).level).toBe('unverified_public')
    expect(classifyLivePbeapTrust({ header: 42 }).level).toBe('unverified_public')
    expect(classifyLivePbeapTrust({ header: { sender_fingerprint: null } }).reason).toBe('no_sender_fingerprint')
  })

  test('fingerprint but no signature => unverified_public(no_signature)', () => {
    const r = classifyLivePbeapTrust({ header: { sender_fingerprint: 'deadbeef' } })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toBe('no_signature')
  })

  test('today: signature present but signing bytes unavailable => unverified_public', () => {
    const r = classifyLivePbeapTrust({
      header: { sender_fingerprint: 'deadbeef', signature_b64: Buffer.from(new Uint8Array(64)).toString('base64') },
    })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toBe('signing_bytes_unavailable')
  })

  test('a self-signed signature does NOT bind without a known counterparty', () => {
    const priv = ed25519.utils.randomPrivateKey()
    const signingBytes = new TextEncoder().encode('canonical pbeap bytes')
    const sig = ed25519.sign(signingBytes, priv)
    const r = classifyLivePbeapTrust({
      header: { sender_fingerprint: 'fp-self', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: [], // not a known handshake counterparty
      signingBytes,
    })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toBe('no_handshake_for_fingerprint')
  })

  test('verified_bound ONLY when bound to a known counterparty AND signature verifies', () => {
    const priv = ed25519.utils.randomPrivateKey()
    const pub = ed25519.getPublicKey(priv)
    const signingBytes = new TextEncoder().encode('canonical pbeap bytes')
    const sig = ed25519.sign(signingBytes, priv)
    const counterparties: KnownCounterparty[] = [
      { handshakeId: 'hs-1', fingerprint: 'fp-known', ed25519PublicKey: pub },
    ]
    const r = classifyLivePbeapTrust({
      header: { sender_fingerprint: 'fp-known', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: counterparties,
      signingBytes,
    })
    expect(r.level).toBe('verified_bound')
    expect(r.boundHandshakeId).toBe('hs-1')

    // Tampered signing bytes under the same counterparty must NOT verify.
    const bad = classifyLivePbeapTrust({
      header: { sender_fingerprint: 'fp-known', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: counterparties,
      signingBytes: new TextEncoder().encode('tampered'),
    })
    expect(bad.level).toBe('unverified_public')
    expect(bad.reason).toBe('signature_did_not_verify_under_counterparty_key')
  })

  test('pbeapTrustMetadata projects a persistable, explicit record', () => {
    const md = pbeapTrustMetadata(classifyLivePbeapTrust({ header: { sender_fingerprint: 'x' } }))
    expect(md.pbeap_trust.level).toBe('unverified_public')
    expect(typeof md.pbeap_trust.reason).toBe('string')
    expect(md.pbeap_trust.bound_handshake_id).toBeNull()
    // Crucially: there is no longer a passive "trust_note" claiming trust.
    expect(JSON.stringify(md)).not.toContain('trust_note')
  })
})
