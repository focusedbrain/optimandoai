/**
 * Resolution rules as pure data (Build A, Deliverable 4).
 *
 * `resolve(table, kind, ctx)` is a pure function: (kind, context) → which
 * executor (+ optional fallback) handles it. No side effects, no I/O.
 *
 * `validateResolutionTable` enforces the structural invariants:
 *   INV-1: no `workstation` row may resolve (primary OR fallback) to in-process.
 *   INV-3: an explicit fallback is the ONLY legitimate degrade; absent one, the
 *          dispatcher fails closed. (There is no implicit microVM→in-process.)
 */

import {
  CriticalJobError,
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
}

export interface ResolutionRule {
  readonly role: Role
  /** Omit to match any tier; a tier-specific rule wins over a tier-agnostic one. */
  readonly tier?: Tier
  readonly perKind: Partial<Record<CriticalJobKind, ResolvedExecutor>>
}

export type ResolutionTable = readonly ResolutionRule[]

/**
 * Initial table. Encodes the §3.2 placement matrix. Workstation rows are
 * intentionally dead until Build C (remote stub unavailable → E_NO_EXECUTOR);
 * they exist so the table already expresses the target topologies and so the
 * validator can prove "workstation never resolves to in-process" structurally.
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
    // workstation: any tier — everything routes remote (stub, unavailable here).
    role: 'workstation',
    perKind: {
      depackage: { executorId: 'remote-handshake' },
      'validate-decrypted-beap': { executorId: 'remote-handshake' },
      'validate-native-beap': { executorId: 'remote-handshake' },
      'open-link': { executorId: 'remote-handshake' },
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
 * Reject any table that violates INV-1 (no workstation → in-process, primary or
 * fallback). Throws `CriticalJobError('E_INVALID_TABLE')`. Call once when a
 * dispatcher is constructed.
 */
export function validateResolutionTable(table: ResolutionTable): void {
  for (const rule of table) {
    if (rule.role !== 'workstation') continue
    for (const [kind, resolved] of Object.entries(rule.perKind)) {
      if (!resolved) continue
      if (resolved.executorId === 'in-process' || resolved.fallbackExecutorId === 'in-process') {
        throw new CriticalJobError(
          'E_INVALID_TABLE',
          `INV-1 violation: role=workstation kind="${kind}" resolves to in-process`,
        )
      }
    }
  }
}
