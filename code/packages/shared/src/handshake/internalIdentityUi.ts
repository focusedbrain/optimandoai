/**
 * Pure UI helpers for internal (same-account) handshakes: Host vs Sandbox, device ids, labels.
 * Used by Electron dashboard and extension BEAP builder — no I/O.
 *
 * User-facing labels use computer/device name, orchestrator role (Host/Sandbox), and
 * 6-digit pairing id. Coordination UUIDs are for debug/advanced only.
 */

export type OrchestratorKind = 'host' | 'sandbox'

/** Minimal shape for deriving peer/local orchestrator display (matches ledger + rpcTypes). */
export interface InternalIdentitySource {
  handshake_type?: 'internal' | 'standard' | null
  local_role: 'initiator' | 'acceptor'
  initiator_device_role?: OrchestratorKind | null
  acceptor_device_role?: OrchestratorKind | null
  initiator_device_name?: string | null
  acceptor_device_name?: string | null
  initiator_coordination_device_id?: string | null
  acceptor_coordination_device_id?: string | null
  internal_peer_device_id?: string | null
  internal_peer_device_role?: OrchestratorKind | null
  internal_peer_computer_name?: string | null
  /** 6-digit decimal pairing code (no dash) — user-facing id when present */
  internal_peer_pairing_code?: string | null
  internal_coordination_identity_complete?: boolean
  internal_coordination_repair_needed?: boolean
}

export function isInternalHandshake(r: Pick<InternalIdentitySource, 'handshake_type'>): boolean {
  return r.handshake_type === 'internal'
}

export function localOrchestratorKind(r: InternalIdentitySource): OrchestratorKind | null {
  return r.local_role === 'initiator' ? r.initiator_device_role ?? null : r.acceptor_device_role ?? null
}

export function peerOrchestratorKind(r: InternalIdentitySource): OrchestratorKind | null {
  return r.local_role === 'initiator' ? r.acceptor_device_role ?? null : r.initiator_device_role ?? null
}

/** User-facing label for a host/sandbox role. */
export function orchestratorUserLabel(kind: OrchestratorKind | null | undefined): string {
  if (kind === 'host') return 'Host orchestrator'
  if (kind === 'sandbox') return 'Sandbox orchestrator'
  return 'Role not set'
}

export function shortDeviceIdForUi(id: string, head = 10, tail = 6): string {
  const t = id.trim()
  if (!t) return ''
  if (t.length <= head + tail + 2) return t
  return `${t.slice(0, head)}…${t.slice(-tail)}`
}

export function peerCoordinationDeviceId(r: InternalIdentitySource): string | null {
  const raw = r.local_role === 'initiator' ? r.acceptor_coordination_device_id : r.initiator_coordination_device_id
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s || null
}

export function localCoordinationDeviceId(r: InternalIdentitySource): string | null {
  const raw = r.local_role === 'initiator' ? r.initiator_coordination_device_id : r.acceptor_coordination_device_id
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s || null
}

/**
 * Stable technical id for the peer: coordination id first, else legacy internal_peer_device_id.
 * For UI, use only in debug/advanced — not as a primary label.
 */
export function peerStableIdentifier(r: InternalIdentitySource): { kind: 'coordination' | 'legacy_peer' | 'unknown'; text: string } {
  const c = peerCoordinationDeviceId(r)
  if (c) return { kind: 'coordination', text: c }
  const leg = typeof r.internal_peer_device_id === 'string' ? r.internal_peer_device_id.trim() : ''
  if (leg) return { kind: 'legacy_peer', text: leg }
  return { kind: 'unknown', text: 'unknown / pending repair' }
}

export function peerDeviceDisplayName(r: InternalIdentitySource): string | null {
  const n = r.local_role === 'initiator' ? r.acceptor_device_name : r.initiator_device_name
  return n?.trim() || null
}

/**
 * Best-effort human computer/device name for the **peer** (Host/Sandbox perspective).
 */
export function peerDisplayComputerName(r: InternalIdentitySource): string {
  const c = r.internal_peer_computer_name?.trim()
  if (c) return c
  const d = peerDeviceDisplayName(r)
  if (d) return d
  return 'Unknown device'
}

/** Format 6-digit storage form to "123-456" for display; null if not exactly six digits. */
export function formatPairingCodeForDisplay(code: string | null | undefined): string | null {
  const t = (code ?? '').replace(/\D/g, '')
  if (t.length !== 6) return null
  return `${t.slice(0, 3)}-${t.slice(3, 6)}`
}

/**
 * Primary user-facing line (peer perspective):
 * "<computer/device name> — <Host orchestrator|Sandbox orchestrator>"
 */
export function formatInternalPrimaryLine(r: InternalIdentitySource): string | null {
  if (!isInternalHandshake(r)) return null
  const name = peerDisplayComputerName(r)
  const peerK = peerOrchestratorKind(r)
  return `${name} — ${orchestratorUserLabel(peerK)}`
}

/**
 * Secondary line: "ID: 123-456" when a valid pairing code exists.
 */
export function formatInternalPairingIdLine(r: InternalIdentitySource): string | null {
  if (!isInternalHandshake(r)) return null
  const formatted = formatPairingCodeForDisplay(r.internal_peer_pairing_code)
  if (!formatted) return null
  return `ID: ${formatted}`
}

/**
 * @deprecated Prefer {@link formatInternalPrimaryLine} + {@link formatInternalPairingIdLine} for two-line UIs.
 * Single-line list hint: same as {@link formatInternalPrimaryLine} (no UUID, no old "orchestrator · uuid" format).
 */
export function formatInternalListSubtitle(r: InternalIdentitySource): string | null {
  return formatInternalPrimaryLine(r)
}

/**
 * One-line + optional pairing, for tooltips and package summary (no coordination UUIDs).
 */
export function formatInternalBeapTargetSummary(r: InternalIdentitySource): string | null {
  if (!isInternalHandshake(r)) return null
  const primary = formatInternalPrimaryLine(r)
  if (!primary) return null
  const idLine = formatInternalPairingIdLine(r)
  return idLine ? `${primary} — ${idLine}` : primary
}

export function internalIdentityNeedsAttention(r: InternalIdentitySource): boolean {
  if (!isInternalHandshake(r)) return false
  if (r.internal_coordination_repair_needed) return true
  if (r.internal_coordination_identity_complete === false) return true
  return false
}
