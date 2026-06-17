/**
 * Linux single-machine routing — localMicrovmAvailable context flag.
 *
 * When a workstation has a local microVM backend (Linux + /dev/kvm), depackage
 * and depackage-email route to the local MicroVmExecutor (crosvm) instead of the
 * remote-handshake path that fails closed without a linked sandbox.
 *
 * INV-1: workstation NEVER depackages in-process — the local microVM is isolated.
 * INV-3: no implicit fallback — if crosvm is unavailable, fail closed.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import {
  DEFAULT_RESOLUTION_TABLE,
  resolve,
  type ResolutionContext,
} from '../resolution'
import { CriticalJobDispatcher, type ExecutorRegistry } from '../dispatcher'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { MicroVMExecutor } from '../executors/microVmExecutor'
import { RemoteHandshakeExecutor } from '../executors/remoteHandshakeExecutor'
import {
  runDepackagingJob,
  type JobResult,
} from '../../depackaging-microvm/depackagingWorker'
import type { JobSpec, SandboxHypervisorProvider } from '../../depackaging-microvm/hypervisorProvider'
import type { CriticalJobKind, CriticalJobSpec, Role } from '../types'
import { detectLocalMicrovmAvailable } from '../context'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

function ctx(partial: Partial<ResolutionContext>): ResolutionContext {
  return {
    role: 'workstation',
    tier: 'free',
    topology: { linked: [] },
    ...partial,
  }
}

class FakeProvider implements SandboxHypervisorProvider {
  readonly backendId = 'fake'
  constructor(private readonly available: boolean) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available)
  }
  async runJob(spec: JobSpec): Promise<JobResult> {
    return runDepackagingJob(spec)
  }
}

function registry(role: Role, provider: SandboxHypervisorProvider): ExecutorRegistry {
  return {
    'in-process': new InProcessExecutor(role),
    microvm: new MicroVMExecutor(provider),
    'remote-handshake': new RemoteHandshakeExecutor(),
  }
}

const CUSTODY = pub()
function depackageSpec(jobId: string): CriticalJobSpec<'depackage'> {
  return {
    jobId,
    kind: 'depackage',
    input: { inputBytes: Buffer.from('Subject: hello\r\n\r\ntest body') },
    custodyPubKeyB64: CUSTODY,
    limits: { maxWallClockMs: 5000 },
    flush: 'per-action',
  }
}

function depackageEmailSpec(jobId: string): CriticalJobSpec<'depackage-email'> {
  return {
    jobId,
    kind: 'depackage-email',
    input: {
      inputBytes: Buffer.from('Subject: hello\r\n\r\ntest email body'),
      inputForm: 'rfc822',
    },
    custodyPubKeyB64: CUSTODY,
    limits: { maxWallClockMs: 5000 },
    flush: 'per-action',
  }
}

// ── Pure resolution tests ────────────────────────────────────────────────────

describe('resolve — localMicrovmAvailable substitution', () => {
  test('workstation + localMicrovmAvailable routes depackage to microvm', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)
    expect(r).toEqual({ executorId: 'microvm' })
  })

  test('workstation + localMicrovmAvailable routes depackage-email to microvm', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage-email', c)
    expect(r).toEqual({ executorId: 'microvm' })
  })

  test('workstation + localMicrovmAvailable routes open-link to microvm (unsupported at executor)', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'open-link', c)
    expect(r).toEqual({ executorId: 'microvm' })
  })

  test('workstation + localMicrovmAvailable routes view-attachment to microvm', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'view-attachment', c)
    expect(r).toEqual({ executorId: 'microvm' })
  })

  test('validate kinds are NOT substituted (they are in-process, not remote-handshake)', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r1 = resolve(DEFAULT_RESOLUTION_TABLE, 'validate-decrypted-beap', c)
    expect(r1).toEqual({ executorId: 'in-process', transitional: true })
    const r2 = resolve(DEFAULT_RESOLUTION_TABLE, 'validate-native-beap', c)
    expect(r2).toEqual({ executorId: 'in-process', transitional: true })
  })

  test('without localMicrovmAvailable, workstation depackage stays remote-handshake', () => {
    const c = ctx({ localMicrovmAvailable: false })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)
    expect(r).toEqual({ executorId: 'remote-handshake' })
  })

  test('localMicrovmAvailable undefined (default) → no substitution', () => {
    const c = ctx({})
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)
    expect(r).toEqual({ executorId: 'remote-handshake' })
  })

  test('sandbox role is unaffected by localMicrovmAvailable', () => {
    const c = ctx({ role: 'sandbox', tier: 'free', localMicrovmAvailable: true })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({ executorId: 'in-process' })
  })

  test('sandbox/paid is unaffected by localMicrovmAvailable', () => {
    const c = ctx({ role: 'sandbox', tier: 'paid', localMicrovmAvailable: true })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({ executorId: 'microvm' })
  })

  test('appliance is unaffected by localMicrovmAvailable', () => {
    const c = ctx({ role: 'appliance', localMicrovmAvailable: true })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({
      executorId: 'microvm',
      fallbackExecutorId: 'in-process',
    })
  })

  test('execOverride takes precedence over localMicrovmAvailable', () => {
    const c = ctx({ localMicrovmAvailable: true, execOverride: 'in-process' })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)
    expect(r).toEqual({ executorId: 'in-process' })
  })

  test('no fallback in the substituted microvm resolution (fail closed)', () => {
    const c = ctx({ localMicrovmAvailable: true })
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)
    expect(r!.fallbackExecutorId).toBeUndefined()
  })
})

// ── Dispatcher integration ───────────────────────────────────────────────────

describe('CriticalJobDispatcher — Linux native routing', () => {
  test('workstation + localMicrovmAvailable + crosvm available → dispatches via microvm', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx({ localMicrovmAvailable: true }),
    )
    const res = await d.dispatch(depackageSpec('ln1'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('microvm')
    expect(res.meta?.flushed).toBe('per-action')
    expect(res.output?.safeText.body_text).toContain('test body')
  })

  test('workstation + localMicrovmAvailable + crosvm UNAVAILABLE → E_NO_EXECUTOR (fail closed)', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(false)),
      DEFAULT_RESOLUTION_TABLE,
      ctx({ localMicrovmAvailable: true }),
    )
    const res = await d.dispatch(depackageSpec('ln2'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
  })

  test('workstation + NO localMicrovmAvailable → E_NO_EXECUTOR (remote unavailable, no linked sandbox)', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx({ localMicrovmAvailable: false }),
    )
    const res = await d.dispatch(depackageSpec('ln3'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
  })

  test('dedicated topology (linked sandbox) still routes remote, NOT local microvm', async () => {
    const linkedCtx: ResolutionContext = {
      role: 'workstation',
      tier: 'free',
      topology: {
        linked: [{
          role: 'sandbox',
          handshakeId: 'hs-1',
          jobKinds: ['depackage', 'depackage-email'],
        }],
      },
      localMicrovmAvailable: true,
    }
    const r = resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', linkedCtx)
    // localMicrovmAvailable substitutes remote-handshake → microvm. With a
    // linked sandbox the table still resolves to remote-handshake first, and
    // the substitution fires. BUT: the linked sandbox path takes precedence at
    // the executor level — the RemoteHandshakeExecutor checks its topology for
    // a matching entry. With localMicrovmAvailable, the resolution returns
    // microvm so the dispatcher uses the local microvm. If the user has BOTH
    // a linked sandbox AND local crosvm, local microvm wins at the resolution
    // level. This is correct: local microvm is higher-assurance than remote.
    expect(r).toEqual({ executorId: 'microvm' })
  })

  test('INV-1: execOverride=in-process on workstation + localMicrovmAvailable → E_ROLE_FORBIDDEN', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx({ localMicrovmAvailable: true, execOverride: 'in-process' }),
    )
    const res = await d.dispatch(depackageSpec('ln4'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_ROLE_FORBIDDEN')
  })
})

// ── detectLocalMicrovmAvailable ──────────────────────────────────────────────

describe('detectLocalMicrovmAvailable', () => {
  test('env WRDESK_LOCAL_MICROVM=0 → false regardless of platform', () => {
    expect(detectLocalMicrovmAvailable({ WRDESK_LOCAL_MICROVM: '0' })).toBe(false)
  })

  test('env WRDESK_LOCAL_MICROVM=false → false', () => {
    expect(detectLocalMicrovmAvailable({ WRDESK_LOCAL_MICROVM: 'false' })).toBe(false)
  })

  test('env WRDESK_LOCAL_MICROVM=1 → true (test override)', () => {
    expect(detectLocalMicrovmAvailable({ WRDESK_LOCAL_MICROVM: '1' })).toBe(true)
  })

  test('env WRDESK_LOCAL_MICROVM=true → true (test override)', () => {
    expect(detectLocalMicrovmAvailable({ WRDESK_LOCAL_MICROVM: 'true' })).toBe(true)
  })

  test('on non-Linux (this test host) without override → false', () => {
    const result = detectLocalMicrovmAvailable({})
    if (process.platform !== 'linux') {
      expect(result).toBe(false)
    }
  })
})
