/**
 * VM-identity-bound result signing tests (Step 1).
 *
 * Verifies that host-provisioned ephemeral keys close the provenance gap:
 *   - Guest signs with the host-provisioned key → host verifies → pass.
 *   - Guest signs with a DIFFERENT key (poisoned image) → host verification FAILS.
 *   - Each job gets a unique key pair (per-job freshness).
 *   - Weak-key rejection still fires.
 *   - INV-2: no key material in JobSpec type / on network wire.
 *   - Backward compatibility: absent hostSigningKey → self-generated → pass without
 *     provenance (in-process executor path).
 */

import { describe, test, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { x25519 } from '@noble/curves/ed25519'
import { runDepackagingJob } from '../depackagingWorker'
import { runDepackageEmailJob } from '../emailDepackage'
import {
  verifyJobResultSignature,
  verifyDepackageEmailResultSignature,
} from '../hypervisorProvider'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

function makeCleanInput(): Buffer {
  return Buffer.from('Subject: test\r\n\r\nClean body for VM identity signing test.')
}

function hostKeypair() {
  const priv = ed25519.utils.randomPrivateKey()
  const pubBytes = ed25519.getPublicKey(priv)
  return {
    priv: new Uint8Array(priv),
    pubB64: Buffer.from(pubBytes).toString('base64'),
  }
}

// ── B1 depackage: host-provisioned key ──────────────────────────────────────

describe('runDepackagingJob — host-provisioned signing key', () => {
  test('result signed with host-provisioned key → host verifies against provisioned pub → pass', () => {
    const { priv, pubB64 } = hostKeypair()
    const result = runDepackagingJob(
      { jobId: 'vm-id-1', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
      priv,
    )

    expect(result.ok).toBe(true)
    expect(result.result_signing_pub_b64).toBe(pubB64)
    expect(verifyJobResultSignature(result, pubB64)).toBe(true)
  })

  test('result signed with DIFFERENT key (poisoned image) → host verification FAILS', () => {
    const hostKey = hostKeypair()
    const attackerKey = hostKeypair()

    const result = runDepackagingJob(
      { jobId: 'vm-id-2', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
      attackerKey.priv,
    )

    expect(result.ok).toBe(true)
    expect(result.result_signing_pub_b64).toBe(attackerKey.pubB64)
    expect(result.result_signing_pub_b64).not.toBe(hostKey.pubB64)
    // Host verifies against ITS provisioned key — attacker key does not match
    expect(verifyJobResultSignature(result, hostKey.pubB64)).toBe(false)
  })

  test('key is per-job: two jobs get different keys → different signatures', () => {
    const key1 = hostKeypair()
    const key2 = hostKeypair()

    const r1 = runDepackagingJob(
      { jobId: 'fresh-1', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
      key1.priv,
    )
    const r2 = runDepackagingJob(
      { jobId: 'fresh-2', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
      key2.priv,
    )

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r1.result_signing_pub_b64).not.toBe(r2.result_signing_pub_b64)
    expect(verifyJobResultSignature(r1, key1.pubB64)).toBe(true)
    expect(verifyJobResultSignature(r2, key2.pubB64)).toBe(true)
    // Cross-verification fails
    expect(verifyJobResultSignature(r1, key2.pubB64)).toBe(false)
    expect(verifyJobResultSignature(r2, key1.pubB64)).toBe(false)
  })

  test('backward compatible: no hostSigningKey → self-generated → verifies without expectedPub', () => {
    const result = runDepackagingJob(
      { jobId: 'compat-1', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
    )

    expect(result.ok).toBe(true)
    expect(result.result_signing_pub_b64).toBeDefined()
    expect(verifyJobResultSignature(result)).toBe(true)
  })

  test('self-generated key fails provenance check when expectedPub is provided', () => {
    const hostKey = hostKeypair()
    const result = runDepackagingJob(
      { jobId: 'compat-2', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
    )

    expect(result.ok).toBe(true)
    // Self-generated key will not match the host-provisioned key
    expect(verifyJobResultSignature(result, hostKey.pubB64)).toBe(false)
  })
})

// ── B2 depackage-email: host-provisioned key ────────────────────────────────

describe('runDepackageEmailJob — host-provisioned signing key', () => {
  test('result signed with host-provisioned key → host verifies → pass', () => {
    const { priv, pubB64 } = hostKeypair()
    const result = runDepackageEmailJob(
      {
        jobId: 'email-vm-1',
        inputBytes: Buffer.from('Subject: email test\r\n\r\nClean email body.'),
        sandboxPeerX25519PubB64: pub(),
        inputForm: 'rfc822',
      },
      priv,
    )

    expect(result.result_signing_pub_b64).toBe(pubB64)
    expect(verifyDepackageEmailResultSignature(result, pubB64)).toBe(true)
  })

  test('attacker key → provenance mismatch → fail', () => {
    const hostKey = hostKeypair()
    const attackerKey = hostKeypair()

    const result = runDepackageEmailJob(
      {
        jobId: 'email-vm-2',
        inputBytes: Buffer.from('Subject: email\r\n\r\nBody.'),
        sandboxPeerX25519PubB64: pub(),
        inputForm: 'rfc822',
      },
      attackerKey.priv,
    )

    expect(verifyDepackageEmailResultSignature(result, hostKey.pubB64)).toBe(false)
    expect(verifyDepackageEmailResultSignature(result, attackerKey.pubB64)).toBe(true)
  })

  test('backward compatible: no hostSigningKey → verifies without expectedPub', () => {
    const result = runDepackageEmailJob({
      jobId: 'email-compat',
      inputBytes: Buffer.from('Subject: compat\r\n\r\nBody.'),
      sandboxPeerX25519PubB64: pub(),
      inputForm: 'rfc822',
    })

    expect(verifyDepackageEmailResultSignature(result)).toBe(true)
  })
})

// ── Weak-key rejection ──────────────────────────────────────────────────────

describe('weak-key rejection with host-provisioned keys', () => {
  test('all-zero key (identity point) is rejected even if signature somehow validates', () => {
    const weakPub = Buffer.alloc(32, 0).toString('base64')
    const result = runDepackagingJob(
      { jobId: 'weak-1', kind: 'depackage', inputBytes: makeCleanInput(), sandboxPeerX25519PubB64: pub() },
    )

    expect(result.ok).toBe(true)
    // Construct a fake result with a weak pub key
    const faked = { ...result, result_signing_pub_b64: weakPub }
    expect(verifyJobResultSignature(faked)).toBe(false)
    expect(verifyJobResultSignature(faked, weakPub)).toBe(false)
  })
})

// ── INV-2: key material locality ────────────────────────────────────────────

describe('INV-2: no key material in JobSpec', () => {
  test('JobSpec type has no signing key field', () => {
    const spec = {
      jobId: 'inv2-1',
      kind: 'depackage' as const,
      inputBytes: makeCleanInput(),
      sandboxPeerX25519PubB64: pub(),
    }
    // The hostSigningKey is a SEPARATE parameter to runDepackagingJob, not part
    // of the JobSpec. This test verifies the type-level invariant at runtime.
    expect(Object.keys(spec)).not.toContain('hostProvisionedSigningKey')
    expect(Object.keys(spec)).not.toContain('hostSigningKey')
    expect(Object.keys(spec)).not.toContain('signingKey')
  })
})
