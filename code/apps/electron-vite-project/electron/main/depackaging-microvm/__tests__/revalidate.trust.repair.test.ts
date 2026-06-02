/**
 * Receive-side re-validation, pBEAP trust classification, and legacy re-pair.
 */

import { describe, test, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { x25519 } from '@noble/curves/ed25519'
import { validateSafeText, SAFE_TEXT_SCHEMA } from '../safeText'
import { classifyPbeapTrust } from '../pbeapTrust'
import { assessSandboxKeyReadiness, ERR_HANDSHAKE_LOCAL_KEY_MISSING } from '../legacyRepair'

describe('receive-side allowlist re-validation', () => {
  const good = { schema: SAFE_TEXT_SCHEMA, subject: 'hi', body_text: 'body', attachment_refs: [] }

  test('accepts a well-formed closed schema', () => {
    expect(validateSafeText(good).ok).toBe(true)
  })

  test('rejects any unexpected top-level key (allowlist, not denylist)', () => {
    const r = validateSafeText({ ...good, html_body: '<script>x</script>' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unexpected_key/)
  })

  test('rejects wrong schema tag', () => {
    expect(validateSafeText({ ...good, schema: 'other' }).ok).toBe(false)
  })

  test('rejects control characters smuggled into text fields', () => {
    expect(validateSafeText({ ...good, body_text: 'a\u0000b' }).ok).toBe(false)
    expect(validateSafeText({ ...good, subject: 'x\u202Ey' }).ok).toBe(false)
  })

  test('rejects malformed attachment refs', () => {
    expect(validateSafeText({ ...good, attachment_refs: ['not-a-uuid'] }).ok).toBe(false)
  })
})

describe('pBEAP trust — never silently trust', () => {
  const signingBytes = new Uint8Array(Buffer.from('canonical-signing-data'))

  function counterparty(fp: string) {
    const priv = ed25519.utils.randomPrivateKey()
    const pub = ed25519.getPublicKey(priv)
    return { priv, pub, record: { handshakeId: 'h1', fingerprint: fp, ed25519PublicKey: pub } }
  }

  test('no signature → unverified_public', () => {
    const r = classifyPbeapTrust({ header: { sender_fingerprint: 'fp' }, knownCounterparties: [], signingBytes })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toBe('no_signature')
  })

  test('valid signature bound to a known counterparty → verified_bound', () => {
    const cp = counterparty('fp-known')
    const sig = ed25519.sign(signingBytes, cp.priv)
    const r = classifyPbeapTrust({
      header: { sender_fingerprint: 'fp-known', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: [cp.record],
      signingBytes,
    })
    expect(r.level).toBe('verified_bound')
    expect(r.boundHandshakeId).toBe('h1')
  })

  test('valid self-signature with NO known counterparty → unverified_public (self-signing is not identity)', () => {
    const cp = counterparty('fp-stranger')
    const sig = ed25519.sign(signingBytes, cp.priv)
    const r = classifyPbeapTrust({
      header: { sender_fingerprint: 'fp-stranger', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: [], // no handshake binds this sender
      signingBytes,
    })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toBe('no_handshake_for_fingerprint')
  })

  test('signature that does not verify under counterparty key → unverified_public', () => {
    const cp = counterparty('fp-known')
    const other = counterparty('fp-known')
    const sig = ed25519.sign(signingBytes, other.priv) // signed by a different key
    const r = classifyPbeapTrust({
      header: { sender_fingerprint: 'fp-known', signature_b64: Buffer.from(sig).toString('base64') },
      knownCounterparties: [cp.record],
      signingBytes,
    })
    expect(r.level).toBe('unverified_public')
    expect(r.reason).toMatch(/did_not_verify/)
  })
})

describe('legacy (pre-v50) re-pair affordance', () => {
  test('fully-keyed handshake is ready for custody', () => {
    const pub = Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
    const r = assessSandboxKeyReadiness({ id: 'h2', peer_x25519_public_key_b64: pub })
    expect(r.ready).toBe(true)
  })

  test('pre-v50 handshake surfaces a re-pair affordance, does not silently fail', () => {
    const r = assessSandboxKeyReadiness({ id: 'h-legacy', deviceName: 'Mini PC', peer_x25519_public_key_b64: null })
    expect(r.ready).toBe(false)
    if (!r.ready) {
      expect(r.code).toBe(ERR_HANDSHAKE_LOCAL_KEY_MISSING)
      expect(r.repair.action).toBe('re_pair_sandbox')
      expect(r.repair.handshakeId).toBe('h-legacy')
      expect(r.repair.message.length).toBeGreaterThan(0)
    }
  })
})
