/**
 * Dev / operator repair plan for `counterparty_public_key` on poisoned handshake rows.
 * Does not run at verification time; used only by the offline repair CLI and tests.
 */
import type { HandshakeRecord } from './types'

const HEX64 = /^[0-9a-fA-F]{64}$/

export function isValidEd25519Hex64(s: string | null | undefined): boolean {
  return typeof s === 'string' && HEX64.test(s.trim())
}

export type CounterpartyInspectRow = {
  handshake_id: string
  state: string
  local_role: 'initiator' | 'acceptor'
  counterparty_public_key: string
  local_public_key: string
  counterparty_first16: string
  local_first16: string
  peer_x25519_public_key_b64: string
  peer_mlkem768_public_key_b64: string
  poison_acceptor_bound_to_self: boolean
}

export function buildInspectRow(rec: HandshakeRecord): CounterpartyInspectRow {
  const cp = rec.counterparty_public_key?.trim() ?? ''
  const loc = rec.local_public_key?.trim() ?? ''
  return {
    handshake_id: rec.handshake_id,
    state: rec.state,
    local_role: rec.local_role,
    counterparty_public_key: cp,
    local_public_key: loc,
    counterparty_first16: cp ? cp.slice(0, 16) : '(empty)',
    local_first16: loc ? loc.slice(0, 16) : '(empty)',
    peer_x25519_public_key_b64: rec.peer_x25519_public_key_b64?.trim() ? 'set' : '(empty)',
    peer_mlkem768_public_key_b64: rec.peer_mlkem768_public_key_b64?.trim() ? 'set' : '(empty)',
    poison_acceptor_bound_to_self:
      rec.local_role === 'acceptor' && isValidEd25519Hex64(cp) && isValidEd25519Hex64(loc) && cp === loc,
  }
}

function visitJson(value: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const v of value) visitJson(v, visit)
    return
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    visit(o)
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (v && (typeof v === 'object' || Array.isArray(v))) visitJson(v, visit)
    }
  }
}

/** Find `sender_public_key` (64-hex) on any object with matching `capsule_type`. */
export function collectSenderKeysForCapsuleType(
  packageJsonString: string,
  capsuleType: 'handshake-initiate' | 'handshake-accept',
): string[] {
  const out: string[] = []
  let root: unknown
  try {
    root = JSON.parse(packageJsonString) as unknown
  } catch {
    return out
  }
  visitJson(root, (o) => {
    const ct = o.capsule_type
    if (ct !== capsuleType) return
    const sp = o.sender_public_key
    if (typeof sp === 'string' && isValidEd25519Hex64(sp)) out.push(sp.trim())
  })
  return out
}

function uniqueSorted(keys: string[]): string[] {
  return Array.from(new Set(keys.map((k) => k.toLowerCase()))).sort()
}

/**
 * If `p2p_pending_beap.package_json` (one or more) still contains a copy of the wire capsule
 * (initiate or accept), we can unambiguously recover the remote Ed25519.
 * If multiple distinct keys appear for the same role, the situation is ambiguous — refuse.
 */
export function tryResolveRemoteFromP2pPackages(
  localRole: 'initiator' | 'acceptor',
  localPublicKey: string | null | undefined,
  p2pPackageJsons: string[],
):
  | { status: 'ok'; remote_ed25519: string; capsule_type: 'handshake-initiate' | 'handshake-accept' }
  | { status: 'ambiguous'; reason: string }
  | { status: 'not_found'; reason: string } {
  const local = localPublicKey?.trim() ?? ''
  const capsuleType: 'handshake-initiate' | 'handshake-accept' =
    localRole === 'acceptor' ? 'handshake-initiate' : 'handshake-accept'
  const collected: string[] = []
  for (const pj of p2pPackageJsons) {
    collected.push(...collectSenderKeysForCapsuleType(pj, capsuleType))
  }
  const u = uniqueSorted(collected)
  if (u.length === 0) {
    return { status: 'not_found', reason: `no ${capsuleType} sender_public_key in p2p_pending_beap` }
  }
  if (u.length > 1) {
    return { status: 'ambiguous', reason: `multiple distinct sender_public_key values for ${capsuleType} in p2p_pending_beap` }
  }
  const remote = u[0]!
  if (local && isValidEd25519Hex64(local) && remote === local.toLowerCase()) {
    return { status: 'ambiguous', reason: 'resolved key equals local_public_key (no repair)' }
  }
  return { status: 'ok', remote_ed25519: remote, capsule_type: capsuleType }
}

export type RepairPlanResult =
  | { kind: 'noop'; message: string }
  | { kind: 'apply'; remote_ed25519: string; source: string; poison_acceptor_bound_to_self: boolean }
  | { kind: 'refuse'; reason: string; hint?: string }

/**
 * Proposes a `counterparty_public_key` update without performing I/O. Runtime verifier is unchanged.
 */
export function planCounterpartyRepair(
  rec: HandshakeRecord,
  p2pPackageJsons: string[],
  opts?: { remoteEd25519Override?: string },
): RepairPlanResult {
  const cp = rec.counterparty_public_key?.trim() ?? ''
  const loc = rec.local_public_key?.trim() ?? ''
  const inspect = buildInspectRow(rec)

  if (opts?.remoteEd25519Override) {
    const o = opts.remoteEd25519Override.trim().toLowerCase()
    if (!isValidEd25519Hex64(o)) {
      return { kind: 'refuse', reason: '--remote-hex must be 64 hex characters' }
    }
    if (cp && o === cp.toLowerCase()) {
      return { kind: 'noop', message: 'counterparty_public_key already matches --remote-hex' }
    }
    return { kind: 'apply', remote_ed25519: o, source: 'explicit --remote-hex', poison_acceptor_bound_to_self: inspect.poison_acceptor_bound_to_self }
  }

  if (cp && isValidEd25519Hex64(loc) && cp === loc) {
    const r = tryResolveRemoteFromP2pPackages(rec.local_role, loc, p2pPackageJsons)
    if (r.status === 'ok') {
      if (r.remote_ed25519 === cp.toLowerCase()) {
        return { kind: 'refuse', reason: 'P2P-derived key matches poisoned self-entry — still ambiguous' }
      }
      return {
        kind: 'apply',
        remote_ed25519: r.remote_ed25519,
        source: `p2p_pending_beap (${r.capsule_type} sender_public_key)`,
        poison_acceptor_bound_to_self: true,
      }
    }
    if (r.status === 'ambiguous') {
      return { kind: 'refuse', reason: r.reason, hint: 're-run with --remote-hex <64-hex> from the initiator device, or clear row and re-handshake' }
    }
    return { kind: 'refuse', reason: r.reason, hint: 'pass --remote-hex if you have the correct remote Ed25519' }
  }

  if (!cp) {
    const r = tryResolveRemoteFromP2pPackages(rec.local_role, loc, p2pPackageJsons)
    if (r.status === 'ok') {
      return {
        kind: 'apply',
        remote_ed25519: r.remote_ed25519,
        source: `p2p_pending_beap (${r.capsule_type} sender_public_key)`,
        poison_acceptor_bound_to_self: false,
      }
    }
    if (r.status === 'ambiguous') {
      return { kind: 'refuse', reason: r.reason, hint: 'use --remote-hex' }
    }
    return { kind: 'refuse', reason: 'empty counterparty and no p2p package with sender key', hint: 'use --remote-hex' }
  }

  if (isValidEd25519Hex64(cp) && isValidEd25519Hex64(loc) && cp !== loc) {
    return {
      kind: 'refuse',
      reason: 'counterparty differs from local but may still be a legitimate peer key — not auto-rewritten',
      hint: 'if verify fails, re-run with --remote-hex or delete the handshake and restart',
    }
  }

  return { kind: 'refuse', reason: 'record shape not eligible for automatic repair', hint: 'use --remote-hex' }
}

export function printInspectLine(row: CounterpartyInspectRow): string {
  return [
    `handshake_id=${row.handshake_id}`,
    `state=${row.state}`,
    `local_role=${row.local_role}`,
    `cp_first16=${row.counterparty_first16}`,
    `local_first16=${row.local_first16}`,
    `peer_x25519=${row.peer_x25519_public_key_b64}`,
    `peer_mlkem=${row.peer_mlkem768_public_key_b64}`,
    `poison_acceptor_self=${row.poison_acceptor_bound_to_self}`,
  ].join(' ')
}
