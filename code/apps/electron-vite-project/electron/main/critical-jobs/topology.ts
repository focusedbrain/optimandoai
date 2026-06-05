/**
 * Linked-topology config for remote-handshake routing (Build C, spec 0017 §3.1).
 *
 * Deferred from Build A, lands now. `orchestrator-mode.json` gains a `linked`
 * array; each entry says "kinds K route over the internal handshake H to a node
 * playing role R". `ResolutionContext.topology` is sourced from it (replacing the
 * Build A hardcoded `{ linked: [] }`).
 *
 * Validation is the seam's key-locality memory (INV-6), mirroring
 * `validateResolutionTable`: an entry that would ship key material — `decrypt-qbeap`
 * (consumer-local) in any `jobKinds`, or any key-requiring kind (e.g.
 * `view-attachment`) linked to an `appliance` (content-key-less by design) — is
 * REJECTED. Invalid entries are dropped (fail closed: no remote routing) and
 * logged; they never silently enable an illegal route.
 */

import { KIND_METADATA, type CriticalJobKind } from './types'

export type LinkedRole = 'sandbox' | 'appliance'

export interface LinkedTopologyEntry {
  readonly role: LinkedRole
  readonly handshakeId: string
  readonly jobKinds: readonly CriticalJobKind[]
}

const VALID_KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_METADATA))

export type LinkedEntryValidation =
  | { readonly ok: true; readonly entry: LinkedTopologyEntry }
  | { readonly ok: false; readonly reason: string }

/**
 * Validate one linked entry's SHAPE and KEY-LOCALITY (INV-6). Returns a normalized
 * entry on success or a typed reason on rejection. Pure — no I/O, no throw.
 */
export function validateLinkedEntry(raw: unknown): LinkedEntryValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'entry is not an object' }
  }
  const o = raw as Record<string, unknown>
  if (o.role !== 'sandbox' && o.role !== 'appliance') {
    return { ok: false, reason: `invalid role "${String(o.role)}"` }
  }
  const role = o.role as LinkedRole
  if (typeof o.handshakeId !== 'string' || o.handshakeId.trim().length === 0) {
    return { ok: false, reason: 'handshakeId must be a non-empty string' }
  }
  if (!Array.isArray(o.jobKinds) || o.jobKinds.length === 0) {
    return { ok: false, reason: 'jobKinds must be a non-empty array' }
  }
  const kinds: CriticalJobKind[] = []
  for (const k of o.jobKinds) {
    if (typeof k !== 'string' || !VALID_KINDS.has(k)) {
      return { ok: false, reason: `unknown kind "${String(k)}"` }
    }
    const kind = k as CriticalJobKind
    const { keyLocality } = KIND_METADATA[kind]
    // INV-6: consumer-local kinds (decrypt-qbeap) must NEVER be routed anywhere —
    // any linked rule would mean shipping the consumer's handshake keys.
    if (keyLocality === 'consumer-local') {
      return { ok: false, reason: `kind "${kind}" is consumer-local; cannot be a linked jobKind (INV-6)` }
    }
    // INV-6: the appliance is content-key-less; a key-requiring kind (e.g.
    // view-attachment, custody-holder-local) must never be linked to it.
    if (role === 'appliance' && keyLocality !== 'none') {
      return { ok: false, reason: `kind "${kind}" is key-requiring and cannot be linked to an appliance (INV-6)` }
    }
    kinds.push(kind)
  }
  return { ok: true, entry: { role, handshakeId: o.handshakeId.trim(), jobKinds: kinds } }
}

/**
 * Validate a `linked` array, dropping (and logging) every invalid entry. Returns
 * only the entries that are safe to route. A whole-config parse error yields `[]`.
 */
export function validateLinkedTopology(raw: unknown): LinkedTopologyEntry[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    console.warn('[CRITICAL_JOB_TOPOLOGY] linked config is not an array — ignoring')
    return []
  }
  const out: LinkedTopologyEntry[] = []
  for (const r of raw) {
    const v = validateLinkedEntry(r)
    if (v.ok) {
      out.push(v.entry)
    } else {
      // INV-5: log the reason + ids only, never content.
      console.warn(`[CRITICAL_JOB_TOPOLOGY] dropping invalid linked entry: ${v.reason}`)
    }
  }
  return out
}

/**
 * Resolve the linked topology with env/argv override precedence:
 *   1. `WRDESK_TOPOLOGY_LINKED` env (JSON array)
 *   2. `--topology-linked=<json>` argv
 *   3. the persisted `orchestrator-mode.json` `linked` array
 * Each source is validated; invalid entries are dropped.
 */
export function loadLinkedTopology(
  persisted: unknown,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): LinkedTopologyEntry[] {
  const fromEnv = env.WRDESK_TOPOLOGY_LINKED
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return validateLinkedTopology(safeParse(fromEnv))
  }
  for (const a of argv) {
    const m = /^--topology-linked=(.+)$/.exec(a)
    if (m) return validateLinkedTopology(safeParse(m[1]))
  }
  return validateLinkedTopology(persisted)
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    console.warn('[CRITICAL_JOB_TOPOLOGY] linked override is not valid JSON — ignoring')
    return []
  }
}
