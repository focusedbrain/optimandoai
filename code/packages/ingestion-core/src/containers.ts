/**
 * WR Handshake containers with criticality (Phase 2 — V3) [VII.3.4–3.6]
 *
 * Both core-record containers (`declarations`, `extensions`) are ORDERED
 * lists of `{ns, version, critical?, payload}` entries. Semantics:
 *
 *  - unknown non-critical entry → PRESERVE AND IGNORE (never stripped)
 *  - unknown critical entry     → VISIBLE REFUSAL naming the namespace
 *  - the container is never stripped, reordered, or partially processed
 *  - the container is covered by the core signatures (canonical.ts)
 *
 * The parser is modeled on the `p2p_signal` preserve-unknown pattern:
 * structural validation of the known shape, byte-faithful preservation of
 * everything else (unknown namespaces, extra entry keys). It is the
 * replacement for the allowlist-strip rebuild for new-format objects.
 */

import type { CanonicalJsonValue } from './canonical.js'

// ── Entry model ───────────────────────────────────────────────────────────────

export interface ContainerEntry {
  /** Namespace identifier, e.g. 'optirando.decl.capsule'. */
  ns: string
  /** Entry schema version within the namespace. */
  version: number
  /** Criticality — absent means non-critical [VII.3.5]. */
  critical?: boolean
  /** Namespace-defined payload; opaque to the container layer. */
  payload: CanonicalJsonValue
  /** Unknown extra keys are preserved verbatim (never stripped). */
  [extra: string]: CanonicalJsonValue | undefined
}

export type ContainerParseResult =
  | { ok: true; entries: ContainerEntry[] }
  | { ok: false; reason: string }

const NS_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_*-]+)+$/i
const MAX_ENTRIES = 64
const MAX_NS_LENGTH = 128

/**
 * Structurally validate a container list while PRESERVING it byte-faithfully.
 * Returns the ORIGINAL entry objects (same references) — never copies with
 * dropped keys, never reorders. Fail-closed on malformed structure.
 */
export function parseContainer(raw: unknown, containerName: string): ContainerParseResult {
  if (raw === undefined || raw === null) return { ok: true, entries: [] }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: `${containerName} must be an ordered list` }
  }
  if (raw.length > MAX_ENTRIES) {
    return { ok: false, reason: `${containerName} exceeds ${MAX_ENTRIES} entries` }
  }
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i]
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      return { ok: false, reason: `${containerName}[${i}] must be an object entry` }
    }
    const entry = e as Record<string, unknown>
    if (typeof entry.ns !== 'string' || entry.ns.length > MAX_NS_LENGTH || !NS_PATTERN.test(entry.ns)) {
      return { ok: false, reason: `${containerName}[${i}].ns is not a valid namespace` }
    }
    if (!Number.isSafeInteger(entry.version) || (entry.version as number) < 1) {
      return { ok: false, reason: `${containerName}[${i}].version must be a positive integer` }
    }
    if (entry.critical !== undefined && typeof entry.critical !== 'boolean') {
      return { ok: false, reason: `${containerName}[${i}].critical must be a boolean when present` }
    }
    if (!('payload' in entry)) {
      return { ok: false, reason: `${containerName}[${i}].payload is required` }
    }
  }
  return { ok: true, entries: raw as ContainerEntry[] }
}

// ── Namespace registry ────────────────────────────────────────────────────────

/**
 * Namespaces with implemented semantics in this build. An entry under one of
 * these may be processed; everything else is unknown for processing purposes.
 */
export const IMPLEMENTED_NAMESPACES: ReadonlySet<string> = new Set([
  // Full v2 capsule content carried as the signed core's capsule declaration
  // (Phase 2 dual-format wire; see electron handshake/canonicalCore.ts).
  'optirando.decl.capsule',
])

/**
 * Registered-but-unimplemented (reserved-inert) namespaces. Registration
 * documents intent; semantics stay unimplemented per the do-not-regress list
 * ("reserved names stay unimplemented beyond parse-level criticality
 * handling"). A CRITICAL entry under a reserved namespace is still refused —
 * we cannot honor semantics we do not implement — with the namespace named.
 *
 * `.*` suffix reserves the whole family.
 */
export const RESERVED_NAMESPACES: ReadonlySet<string> = new Set([
  // Master brief §4 do-not-regress reserved names:
  'optirando.grant.single_use',
  'optirando.grant.ttl',
  'optirando.ad.wr_ad',
  'optirando.invitation.targeted_bound',
  'optirando.credential.attachment',
  'optirando.bridge.*',
  // Phase-2 order §3 additional reservations:
  'optirando.handshake.prior_ref',
  'optirando.credential.*',
  'optirando.transport.*',
  'optirando.decl.capability',
])

function matchesFamily(ns: string, family: string): boolean {
  if (!family.endsWith('.*')) return ns === family
  const prefix = family.slice(0, -1) // keep trailing dot
  return ns.startsWith(prefix) && ns.length > prefix.length
}

export function isReservedNamespace(ns: string): boolean {
  for (const family of RESERVED_NAMESPACES) {
    if (matchesFamily(ns, family)) return true
  }
  return false
}

export function isImplementedNamespace(ns: string): boolean {
  return IMPLEMENTED_NAMESPACES.has(ns)
}

// ── Criticality evaluation [VII.3.5] ─────────────────────────────────────────

export type CriticalityVerdict =
  | { ok: true; ignoredNonCritical: string[] }
  | { ok: false; refusedNamespace: string; reserved: boolean }

/**
 * Evaluate container criticality. Non-critical entries under namespaces we
 * do not implement are preserved and ignored. The FIRST critical entry under
 * a namespace without implemented semantics produces a refusal naming that
 * namespace — reserved (registered-inert) namespaces included.
 */
export function evaluateContainerCriticality(entries: readonly ContainerEntry[]): CriticalityVerdict {
  const ignored: string[] = []
  for (const entry of entries) {
    if (isImplementedNamespace(entry.ns)) continue
    if (entry.critical === true) {
      return { ok: false, refusedNamespace: entry.ns, reserved: isReservedNamespace(entry.ns) }
    }
    ignored.push(entry.ns)
  }
  return { ok: true, ignoredNonCritical: ignored }
}
