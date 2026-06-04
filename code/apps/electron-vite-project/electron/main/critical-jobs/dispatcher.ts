/**
 * CriticalJobDispatcher (Build A, Deliverable 4).
 *
 * Flow: resolve (pure) → pick first runnable executor among [primary, fallback]
 * → run under a dispatcher-level wall-clock timeout → centrally verify
 * depackage-style results (signature + safe-text) → return.
 *
 * Invariants:
 *   INV-3: no implicit degrade. A declared fallback is the only legitimate
 *     alternative; otherwise dispatch fails closed with E_NO_EXECUTOR.
 *   INV-5: logs carry jobId, kind, executor id, duration, ok/error-code only —
 *     never job input, decrypted JSON, safe-text, or artifacts.
 *
 * `dispatch()` never throws: a thrown `CriticalJobError` from an executor (e.g.
 * E_ROLE_FORBIDDEN) is caught and returned as `ok:false`.
 */

import {
  CriticalJobError,
  SAFE_TEXT_OUTPUT_KINDS,
  type CriticalJobErrorCode,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
  type ExecutorId,
  type ResultMeta,
} from './types'
import type { CriticalJobExecutor } from './executor'
import {
  resolve,
  validateResolutionTable,
  type ResolutionContext,
  type ResolutionTable,
  type ResolvedExecutor,
} from './resolution'
import { verifyDepackageResult } from './verify'

export type ExecutorRegistry = Partial<Record<ExecutorId, CriticalJobExecutor>>

const LOG_TAG = '[CRITICAL_JOB]'

export class CriticalJobDispatcher {
  constructor(
    private readonly executors: ExecutorRegistry,
    private readonly table: ResolutionTable,
    private readonly ctx: ResolutionContext,
  ) {
    // Reject illegal tables up front (INV-1 / INV-3 structural check).
    validateResolutionTable(table)
  }

  /** Pure resolution passthrough (kind, ctx) → executor (+ optional fallback). */
  resolve(kind: CriticalJobKind): ResolvedExecutor | null {
    return resolve(this.table, kind, this.ctx)
  }

  async dispatch<K extends CriticalJobKind>(
    spec: CriticalJobSpec<K>,
  ): Promise<CriticalJobResult<K>> {
    const start = Date.now()
    const resolved = this.resolve(spec.kind)
    if (!resolved) {
      return this.fail(spec, 'E_NO_EXECUTOR', `no executor resolved for kind "${spec.kind}"`, start)
    }

    const order: ExecutorId[] = [resolved.executorId]
    if (resolved.fallbackExecutorId) order.push(resolved.fallbackExecutorId)

    // Selection phase: first executor that exists, supports the kind, and is
    // available. Fallback covers unavailability/unsupported — NOT runtime errors.
    let chosen: { id: ExecutorId; executor: CriticalJobExecutor } | null = null
    for (const id of order) {
      const executor = this.executors[id]
      if (!executor) continue
      if (!executor.supports(spec.kind)) continue
      let available = false
      try {
        available = await executor.isAvailable()
      } catch {
        available = false
      }
      if (!available) continue
      chosen = { id, executor }
      break
    }

    if (!chosen) {
      return this.fail(
        spec,
        'E_NO_EXECUTOR',
        `no available executor for kind "${spec.kind}" (tried: ${order.join(', ')})`,
        start,
        order[0],
      )
    }

    // Execution phase under a dispatcher-level wall-clock ceiling.
    let raw: CriticalJobResult<K>
    try {
      raw = await this.runWithTimeout(chosen.executor, spec)
    } catch (err) {
      const code: CriticalJobErrorCode =
        err instanceof CriticalJobError ? err.code : 'E_EXECUTION_ERROR'
      const message = err instanceof Error ? err.message : String(err)
      return this.fail(spec, code, message, start, chosen.id)
    }

    // Centralized post-result verification for safe-text kinds — no executor can
    // skip it. A failing result becomes ok:false with a typed code.
    let result = raw
    if (raw.ok && SAFE_TEXT_OUTPUT_KINDS.has(spec.kind)) {
      const verdict = verifyDepackageResult(raw as CriticalJobResult<'depackage'>)
      if (!verdict.ok) {
        return this.fail(spec, verdict.code, verdict.message, start, chosen.id)
      }
      result = { ...raw, output: verdict.output as CriticalJobResult<K>['output'] }
    }

    const meta: ResultMeta = {
      executorId: chosen.id,
      flushed: result.meta?.flushed ?? 'none',
      durationMs: Date.now() - start,
    }
    this.logOk(spec, meta)
    return { ...result, meta }
  }

  private runWithTimeout<K extends CriticalJobKind>(
    executor: CriticalJobExecutor,
    spec: CriticalJobSpec<K>,
  ): Promise<CriticalJobResult<K>> {
    const ms = spec.limits.maxWallClockMs
    return new Promise<CriticalJobResult<K>>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        reject(new CriticalJobError('E_TIMEOUT', `dispatcher wall-clock exceeded (${ms}ms)`))
      }, ms)
      executor.run(spec).then(
        (r) => {
          clearTimeout(timer)
          resolvePromise(r)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }

  private fail<K extends CriticalJobKind>(
    spec: CriticalJobSpec<K>,
    code: CriticalJobErrorCode,
    message: string,
    start: number,
    executorId?: ExecutorId,
  ): CriticalJobResult<K> {
    const meta: ResultMeta = {
      executorId: executorId ?? 'none',
      flushed: 'none',
      durationMs: Date.now() - start,
    }
    // INV-5: code + ids only.
    console.warn(`${LOG_TAG} job=${spec.jobId} kind=${spec.kind} executor=${meta.executorId} ok=false code=${code}`)
    return { jobId: spec.jobId, ok: false, error: { code, message }, meta }
  }

  private logOk<K extends CriticalJobKind>(spec: CriticalJobSpec<K>, meta: ResultMeta): void {
    // INV-5: ids + counters only.
    console.log(
      `${LOG_TAG} job=${spec.jobId} kind=${spec.kind} executor=${meta.executorId} ok=true flushed=${meta.flushed} ms=${meta.durationMs}`,
    )
  }
}
