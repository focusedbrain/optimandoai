/**
 * Resolution rules as pure data (Build A, Deliverable 4).
 *
 * `resolve(table, kind, ctx)` is a pure function: (kind, context) → which
 * executor (+ optional fallback) handles it. No side effects, no I/O.
 *
 * `validateResolutionTable` is the structural memory of the invariants:
 *   INV-1: `workstation → in-process` is banned outright for untrusted-content
 *          kinds, and allowed for the two validate kinds only via a transitional
 *          rule (primary OR fallback are both checked).
 *   INV-6: key-requiring kinds never route in a way that ships key material
 *          (no consumer-local → remote; no key-requiring kind on the appliance).
 *   INV-3: an explicit fallback is the ONLY legitimate degrade; absent one, the
 *          dispatcher fails closed. (There is no implicit microVM→in-process.)
 */

import {
  CriticalJobError,
  KIND_METADATA,
  TRANSITIONAL_INPROCESS_KINDS,
  UNTRUSTED_CONTENT_KINDS,
  type CriticalJobKind,
  type ExecutorId,
  type Role,
  type Tier,
} from './types'

/** Resolution context. `execOverride` is the per-machine WRDESK_CRITICAL_EXEC. */
export interface ResolutionContext {
  readonly role: Role
  readonly tier: Tier
  readonly topology: {
    readonly linked: ReadonlyArray<{
      readonly role: 'sandbox' | 'appliance'
      readonly handshakeId: string
      readonly jobKinds: readonly CriticalJobKind[]
    }>
  }
  /** Optional per-machine override of the table's chosen executor. */
  readonly execOverride?: 'in-process' | 'microvm'
}

export interface ResolvedExecutor {
  readonly executorId: ExecutorId
  readonly fallbackExecutorId?: ExecutorId
  /**
   * Marks a `workstation → in-process` rule as the transitional stand-in for
   * today's host-side validators (INV-1 refinement, Q5.2). It is legal ONLY for
   * the `TRANSITIONAL_INPROCESS_KINDS`. TRACKING: delete every transitional rule
   * when Build C topology routing + fetch relocation land.
   */
  readonly transitional?: boolean
}

export interface ResolutionRule {
  readonly role: Role
  /** Omit to match any tier; a tier-specific rule wins over a tier-agnostic one. */
  readonly tier?: Tier
  readonly perKind: Partial<Record<CriticalJobKind, ResolvedExecutor>>
}

export type ResolutionTable = readonly ResolutionRule[]

/**
 * Initial table. Encodes the §3.2 placement matrix. The workstation remote rows
 * are intentionally dead until Build C (remote stub unavailable → E_NO_EXECUTOR);
 * the workstation *validate* rows are live via a transitional in-process marker
 * (B.1) so flag-on B1 is runnable on today's single-box deployments.
 */
export const DEFAULT_RESOLUTION_TABLE: ResolutionTable = [
  {
    role: 'sandbox',
    tier: 'free',
    perKind: {
      depackage: { executorId: 'in-process' },
      'validate-decrypted-beap': { executorId: 'in-process' },
      'validate-native-beap': { executorId: 'in-process' },
      // open-link / view-attachment: unsupported (no in-process implementation).
      // decrypt-qbeap: RESERVED/unimplemented (Amendment 1) — no rule.
    },
  },
  {
    role: 'sandbox',
    tier: 'paid',
    perKind: {
      depackage: { executorId: 'microvm' }, // no fallback — fail closed if unavailable
      'validate-decrypted-beap': { executorId: 'in-process' }, // microvm later
      'validate-native-beap': { executorId: 'in-process' }, // microvm later
    },
  },
  {
    // appliance: any tier
    role: 'appliance',
    perKind: {
      depackage: { executorId: 'microvm', fallbackExecutorId: 'in-process' },
      'validate-decrypted-beap': { executorId: 'in-process' },
      // validate-native-beap routes to the consuming orchestrator; the remote
      // row activates in Build C, so it is unsupported here (fails closed).
    },
  },
  {
    // workstation: any tier.
    //  - Untrusted-content kinds route remote (stub, unavailable until Build C).
    //  - The two validate kinds run in-process via a TRANSITIONAL rule (B.1):
    //    this replicates today's reality (the forked validator subprocess /
    //    pure validateCapsule on the host) and is what makes flag-on B1 runnable
    //    without overstating today's isolation. Deleted when Build C lands.
    role: 'workstation',
    perKind: {
      depackage: { executorId: 'remote-handshake' },
      'validate-decrypted-beap': { executorId: 'in-process', transitional: true },
      'validate-native-beap': { executorId: 'in-process', transitional: true },
      'open-link': { executorId: 'remote-handshake' },
      // view-attachment → remote delivers the job TO the custody holder (sandbox);
      // legal under INV-6 (placement topology (c)).
      'view-attachment': { executorId: 'remote-handshake' },
      // decrypt-qbeap: RESERVED + INV-6 forbids routing a key-requiring job
      // remote, so it is deliberately absent from every row.
    },
  },
]

/** Find the most specific rule for a context (tier-specific beats tier-agnostic). */
function lookupRule(table: ResolutionTable, ctx: ResolutionContext): ResolutionRule | null {
  let tierAgnostic: ResolutionRule | null = null
  for (const rule of table) {
    if (rule.role !== ctx.role) continue
    if (rule.tier === ctx.tier) return rule
    if (rule.tier === undefined && tierAgnostic === null) tierAgnostic = rule
  }
  return tierAgnostic
}

/**
 * Pure resolution. Returns the resolved executor (+ optional fallback), or null
 * if the (kind, context) is unsupported. When `execOverride` is set, it replaces
 * the chosen executor ONLY for kinds the table already supports in this context
 * (so unsupported kinds stay unsupported), and drops any fallback.
 */
export function resolve(
  table: ResolutionTable,
  kind: CriticalJobKind,
  ctx: ResolutionContext,
): ResolvedExecutor | null {
  const rule = lookupRule(table, ctx)
  if (!rule) return null
  const base = rule.perKind[kind]
  if (!base) return null
  if (ctx.execOverride) {
    return { executorId: ctx.execOverride }
  }
  return base
}

/**
 * Structural memory of INV-1 + INV-6 (Q5). Rejects, with
 * `CriticalJobError('E_INVALID_TABLE')`, any table where:
 *
 *   INV-1 (absolute): `workstation → in-process` (primary OR fallback) for an
 *     untrusted-content kind (`depackage`/`open-link`/`view-attachment`). No
 *     marker can legalize it.
 *   INV-1 (transitional): `workstation → in-process` for any kind OTHER than the
 *     two `TRANSITIONAL_INPROCESS_KINDS`, or for those without `transitional:true`.
 *   INV-6: a `consumer-local` kind (`decrypt-qbeap`) routed to `remote-handshake`
 *     (primary OR fallback) or placed in an appliance rule; OR any key-requiring
 *     kind (`consumer-local`/`custody-holder-local`) placed in an appliance rule
 *     (the appliance is content-key-less). `view-attachment → remote-handshake`
 *     from workstation is LEGAL (it delivers the job to the custody holder).
 *
 * Call once when a dispatcher is constructed.
 */
export function validateResolutionTable(table: ResolutionTable): void {
  const reject = (msg: string): never => {
    throw new CriticalJobError('E_INVALID_TABLE', msg)
  }

  for (const rule of table) {
    for (const [k, resolved] of Object.entries(rule.perKind)) {
      if (!resolved) continue
      const kind = k as CriticalJobKind
      const { keyLocality } = KIND_METADATA[kind]
      const usesInProcess =
        resolved.executorId === 'in-process' || resolved.fallbackExecutorId === 'in-process'
      const usesRemote =
        resolved.executorId === 'remote-handshake' ||
        resolved.fallbackExecutorId === 'remote-handshake'

      // ── INV-6: key-locality ────────────────────────────────────────────────
      if (rule.role === 'appliance' && keyLocality !== 'none') {
        reject(
          `INV-6 violation: role=appliance kind="${kind}" is key-requiring; ` +
            'the appliance is content-key-less',
        )
      }
      if (keyLocality === 'consumer-local' && usesRemote) {
        reject(
          `INV-6 violation: kind="${kind}" is consumer-local and must never route ` +
            'to remote-handshake (would ship key material)',
        )
      }

      // ── INV-1: workstation in-process ───────────────────────────────────────
      if (rule.role === 'workstation' && usesInProcess) {
        const transitionalOk =
          TRANSITIONAL_INPROCESS_KINDS.has(kind) && resolved.transitional === true
        if (UNTRUSTED_CONTENT_KINDS.has(kind)) {
          reject(
            `INV-1 violation (absolute): role=workstation untrusted-content kind ` +
              `"${kind}" resolves to in-process`,
          )
        }
        if (!transitionalOk) {
          reject(
            `INV-1 violation: role=workstation kind="${kind}" resolves to in-process ` +
              'without a permitted transitional marker',
          )
        }
      }
    }
  }
}
