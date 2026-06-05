/**
 * InProcessExecutor — role gate (INV-1) and supported-kind behavior.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { CriticalJobError, type CriticalJobSpec } from '../types'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

const depackageSpec: CriticalJobSpec<'depackage'> = {
  jobId: 'd1',
  kind: 'depackage',
  input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody') },
  custodyPubKeyB64: pub(),
  limits: { maxWallClockMs: 5000 },
  flush: 'per-action',
}

describe('InProcessExecutor INV-1 role gate', () => {
  test('throws E_ROLE_FORBIDDEN on role=workstation for untrusted-content (depackage)', async () => {
    const exec = new InProcessExecutor('workstation')
    await expect(exec.run(depackageSpec)).rejects.toMatchObject({
      code: 'E_ROLE_FORBIDDEN',
    })
    await expect(exec.run(depackageSpec)).rejects.toBeInstanceOf(CriticalJobError)
  })

  test('permits a transitional validate kind on role=workstation (INV-1 refinement, Q5)', async () => {
    const exec = new InProcessExecutor('workstation')
    const spec: CriticalJobSpec<'validate-native-beap'> = {
      jobId: 'vnb-ws',
      kind: 'validate-native-beap',
      input: { candidate: { kind: 'qbeap' } as never },
      limits: { maxWallClockMs: 5000 },
      flush: 'session',
    }
    // Must NOT throw E_ROLE_FORBIDDEN; validateCapsule is a pure host call.
    const res = await exec.run(spec)
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('in-process')
  })

  test('runs depackage on role=sandbox', async () => {
    const exec = new InProcessExecutor('sandbox')
    const res = await exec.run(depackageSpec)
    expect(res.ok).toBe(true)
    expect(res.output?.safeText.schema).toBe('safe-text/v1')
    expect(res.result_signature_b64).toBeTruthy()
    expect(res.meta?.executorId).toBe('in-process')
  })

  test('runs depackage on role=appliance', async () => {
    const exec = new InProcessExecutor('appliance')
    const res = await exec.run(depackageSpec)
    expect(res.ok).toBe(true)
  })
})

describe('InProcessExecutor supports()', () => {
  const exec = new InProcessExecutor('sandbox')
  test('supports depackage + both validators', () => {
    expect(exec.supports('depackage')).toBe(true)
    expect(exec.supports('validate-decrypted-beap')).toBe(true)
    expect(exec.supports('validate-native-beap')).toBe(true)
  })
  test('does NOT support link/attachment in this build', () => {
    expect(exec.supports('open-link')).toBe(false)
    expect(exec.supports('view-attachment')).toBe(false)
  })
  test('does NOT support the RESERVED decrypt-qbeap kind (INV-6, unimplemented)', () => {
    expect(exec.supports('decrypt-qbeap')).toBe(false)
  })
})
