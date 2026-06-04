/**
 * CriticalJobDispatcher — resolution → availability → run → verify, end to end,
 * with a FAKE SandboxHypervisorProvider (no real VM). Covers fail-closed
 * dispatch (INV-3), the in-process role gate surfacing (INV-1), the centralized
 * safe-text/signature gate, fallback, override, and the wall-clock timeout.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import {
  runDepackagingJob,
  type JobResult,
} from '../../depackaging-microvm/depackagingWorker'
import type { JobSpec, SandboxHypervisorProvider } from '../../depackaging-microvm/hypervisorProvider'
import { CriticalJobDispatcher, type ExecutorRegistry } from '../dispatcher'
import { InProcessExecutor } from '../executors/inProcessExecutor'
import { MicroVMExecutor } from '../executors/microVmExecutor'
import { RemoteHandshakeExecutor } from '../executors/remoteHandshakeExecutor'
import { DEFAULT_RESOLUTION_TABLE } from '../resolution'
import type { ResolutionContext } from '../resolution'
import type { CriticalJobExecutor } from '../executor'
import {
  CriticalJobError,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
  type Role,
} from '../types'

function pub(): string {
  return Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')
}

/** A fake microVM provider that runs the real (signed) worker in-process. */
class FakeProvider implements SandboxHypervisorProvider {
  readonly backendId = 'fake'
  constructor(
    private readonly available: boolean,
    private readonly mutate?: (r: JobResult) => JobResult,
  ) {}
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available)
  }
  async runJob(spec: JobSpec): Promise<JobResult> {
    const r = runDepackagingJob(spec)
    return this.mutate ? this.mutate(r) : r
  }
}

function registry(role: Role, provider: SandboxHypervisorProvider): ExecutorRegistry {
  return {
    'in-process': new InProcessExecutor(role),
    microvm: new MicroVMExecutor(provider),
    'remote-handshake': new RemoteHandshakeExecutor(),
  }
}

function ctx(role: Role, tier: 'free' | 'paid', execOverride?: 'in-process' | 'microvm'): ResolutionContext {
  return { role, tier, topology: { linked: [] }, execOverride }
}

const CUSTODY = pub()
function depackageSpec(jobId: string, ms = 5000): CriticalJobSpec<'depackage'> {
  return {
    jobId,
    kind: 'depackage',
    input: { inputBytes: Buffer.from('Subject: hi\r\n\r\ndispatched body') },
    custodyPubKeyB64: CUSTODY,
    limits: { maxWallClockMs: ms },
    flush: 'per-action',
  }
}

describe('CriticalJobDispatcher construction', () => {
  test('rejects an illegal table (workstation → in-process) at construction', () => {
    expect(
      () =>
        new CriticalJobDispatcher(
          {},
          [{ role: 'workstation', perKind: { depackage: { executorId: 'in-process' } } }],
          ctx('workstation', 'free'),
        ),
    ).toThrowError(CriticalJobError)
  })
})

describe('CriticalJobDispatcher.dispatch — happy paths', () => {
  test('paid sandbox routes depackage to microVM and passes central verification', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m1'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('microvm')
    expect(res.meta?.flushed).toBe('per-action')
    expect(res.output?.safeText.body_text).toContain('dispatched body')
  })

  test('free sandbox routes depackage to in-process', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(false)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'free'),
    )
    const res = await d.dispatch(depackageSpec('m2'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('in-process')
  })
})

describe('CriticalJobDispatcher.dispatch — fail closed (INV-3)', () => {
  test('paid sandbox depackage with microVM unavailable and NO fallback → E_NO_EXECUTOR', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(false)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m3'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
  })

  test('appliance depackage with microVM unavailable falls back to in-process', async () => {
    const d = new CriticalJobDispatcher(
      registry('appliance', new FakeProvider(false)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('appliance', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m4'))
    expect(res.ok).toBe(true)
    expect(res.meta?.executorId).toBe('in-process')
  })

  test('workstation depackage resolves to the remote stub (unavailable) → E_NO_EXECUTOR', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('workstation', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m5'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
  })

  test('unsupported kind (no rule) → E_NO_EXECUTOR', async () => {
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'free'),
    )
    const res = await d.dispatch({
      jobId: 'link1',
      kind: 'open-link',
      input: { url: 'https://x.test' },
      limits: { maxWallClockMs: 1000 },
      flush: 'per-action',
    })
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_NO_EXECUTOR')
  })
})

describe('CriticalJobDispatcher.dispatch — defense in depth & verification', () => {
  test('execOverride=in-process on workstation surfaces E_ROLE_FORBIDDEN (INV-1)', async () => {
    const d = new CriticalJobDispatcher(
      registry('workstation', new FakeProvider(true)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('workstation', 'free', 'in-process'),
    )
    const res = await d.dispatch(depackageSpec('m6'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_ROLE_FORBIDDEN')
  })

  test('central gate rejects a tampered (bad-signature) microVM result → E_SIGNATURE_INVALID', async () => {
    const tamper = (r: JobResult): JobResult =>
      r.ok && r.safeText ? { ...r, safeText: { ...r.safeText, body_text: 'mutated-after-sign' } } : r
    const d = new CriticalJobDispatcher(
      registry('sandbox', new FakeProvider(true, tamper)),
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m7'))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_SIGNATURE_INVALID')
  })
})

describe('CriticalJobDispatcher.dispatch — wall-clock timeout', () => {
  class SlowExecutor implements CriticalJobExecutor {
    readonly id = 'microvm' as const
    supports(kind: CriticalJobKind): boolean {
      return kind === 'depackage'
    }
    isAvailable(): Promise<boolean> {
      return Promise.resolve(true)
    }
    run<K extends CriticalJobKind>(_spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>> {
      return new Promise((resolve) => setTimeout(() => resolve({ jobId: 'x', ok: true } as CriticalJobResult<K>), 1000))
    }
  }
  test('a job exceeding maxWallClockMs → E_TIMEOUT', async () => {
    const d = new CriticalJobDispatcher(
      { microvm: new SlowExecutor() },
      DEFAULT_RESOLUTION_TABLE,
      ctx('sandbox', 'paid'),
    )
    const res = await d.dispatch(depackageSpec('m8', 30))
    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('E_TIMEOUT')
  })
})
