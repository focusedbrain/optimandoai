/**
 * Resolution-context sourcing (Build A, Deliverable 4) — DELIBERATELY MINIMAL.
 *
 * Scoping for this build:
 *   - role: `WRDESK_ROLE` env / `--role` argv override (accepts workstation |
 *     sandbox | appliance — appliance is accepted as a value, NO appliance
 *     behavior is wired here), else mapped from the persisted orchestrator mode
 *     (`host` → workstation, `sandbox` → sandbox).
 *   - tier: caller-supplied (mapped pro/publisher/enterprise → 'paid'); full
 *     JWT-derived `resolveTier` wiring lands with the live-path build. Defaults
 *     to 'free' when not supplied.
 *   - execOverride: `WRDESK_CRITICAL_EXEC=in-process|microvm` per-machine
 *     override of the table's chosen executor.
 *   - topology: `{ linked: [] }`. Persistence of linked topology ships with the
 *     RemoteHandshakeExecutor build (Build C), not now.
 *
 * This is the ONLY seam module that reads env/argv/persisted mode; the dispatcher
 * itself takes a ResolutionContext explicitly and stays pure-testable.
 */

import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import type { Role, Tier } from './types'
import type { ResolutionContext } from './resolution'

const VALID_ROLES: ReadonlySet<string> = new Set(['workstation', 'sandbox', 'appliance'])

function parseArgvRole(argv: readonly string[]): Role | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--role' && i + 1 < argv.length && VALID_ROLES.has(argv[i + 1])) {
      return argv[i + 1] as Role
    }
    const m = /^--role=(.+)$/.exec(a)
    if (m && VALID_ROLES.has(m[1])) return m[1] as Role
  }
  return null
}

function roleFromMode(): Role {
  // `host` is the workstation product role; `sandbox` maps straight through.
  try {
    return getOrchestratorMode().mode === 'sandbox' ? 'sandbox' : 'workstation'
  } catch {
    return 'workstation'
  }
}

export function resolveRole(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): Role {
  const fromEnv = env.WRDESK_ROLE
  if (fromEnv && VALID_ROLES.has(fromEnv)) return fromEnv as Role
  const fromArgv = parseArgvRole(argv)
  if (fromArgv) return fromArgv
  return roleFromMode()
}

function resolveExecOverride(
  env: NodeJS.ProcessEnv = process.env,
): 'in-process' | 'microvm' | undefined {
  const v = env.WRDESK_CRITICAL_EXEC
  if (v === 'in-process' || v === 'microvm') return v
  return undefined
}

export interface BuildContextOptions {
  /** Coarse tier; defaults to 'free' (full JWT wiring deferred to the live build). */
  tier?: Tier
  env?: NodeJS.ProcessEnv
  argv?: readonly string[]
}

export function buildResolutionContext(opts: BuildContextOptions = {}): ResolutionContext {
  const env = opts.env ?? process.env
  const argv = opts.argv ?? process.argv
  return {
    role: resolveRole(env, argv),
    tier: opts.tier ?? 'free',
    topology: { linked: [] },
    execOverride: resolveExecOverride(env),
  }
}
