/**
 * Pure UI helpers for internal (same-account) handshakes: Host vs Sandbox, device ids, labels.
 * Used by Electron dashboard and extension BEAP builder — no I/O.
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
 * Stable id for the peer: coordination id first, else legacy internal_peer_device_id, else unknown placeholder.
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

/** One line for list rows: "Sandbox orchestrator · abcd…wxyz" */
export function formatInternalListSubtitle(r: InternalIdentitySource): string | null {
  if (!isInternalHandshake(r)) return null
  const peerK = peerOrchestratorKind(r)
  const sid = peerStableIdentifier(r)
  const idPart = sid.kind === 'unknown' ? sid.text : shortDeviceIdForUi(sid.text)
  return `${orchestratorUserLabel(peerK)} · ${idPart}`
}

/**
 * Obvious private-mode send target: peer orchestrator + names + full device id for internal handshakes.
 */
export function formatInternalBeapTargetSummary(r: InternalIdentitySource): string | null {
  if (!isInternalHandshake(r)) return null
  const peerK = peerOrchestratorKind(r)
  const sid = peerStableIdentifier(r)
  const dname = peerDeviceDisplayName(r)
  const comp = r.internal_peer_computer_name?.trim()
  const idLine = sid.kind === 'unknown' ? sid.text : sid.text
  const bits: string[] = [
    `Target: ${orchestratorUserLabel(peerK)}`,
  ]
  if (dname) bits.push(`“${dname}”`)
  if (comp) bits.push(`PC: ${comp}`)
  bits.push(`Device ID: ${idLine}`)
  return bits.join(' — ')
}

export function internalIdentityNeedsAttention(r: InternalIdentitySource): boolean {
  if (!isInternalHandshake(r)) return false
  if (r.internal_coordination_repair_needed) return true
  if (r.internal_coordination_identity_complete === false) return true
  return false
}
