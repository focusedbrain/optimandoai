/**
 * Prompt 4 — topology auto-wire.
 *
 * When an internal handshake reaches ACTIVE (both sides identity-complete), the
 * HOST node automatically gains a `linked[]` entry in `orchestrator-mode.json`
 * that points to the sandbox peer via that handshake and declares that it covers
 * `depackage-email`. This makes `resolveIngestionOwnership()` return
 * `owner: 'sandbox'` / `hostShouldReadPoll: false` WITHOUT any manual config.
 *
 * On revoke/expiry the entry is removed and the decision reverts to
 * `owner: 'host'` (single-machine / legacy inert-courier path).
 *
 * Role-precedence invariant (enforced here):
 *   Boot-flag role (`orchestrator-mode.json` .mode) is a CAPABILITY gate — the
 *   ledger is authoritative per active handshake. If the two disagree the system
 *   fails LOUDLY (throws `TopologyRoleConflictError`) and refuses to wire.
 *   "Never silently pick a winner."
 *
 * Out of scope: the sandbox node does NOT need a self-referential linked entry;
 * `resolveIngestionOwnership` detects sandbox-mode from `orchestratorModeStore`
 * directly (Prompt 4 extension to ingestionOwnership.ts).
 */

import { listHandshakeRecords } from './db'
import { HandshakeState, type HandshakeRecord } from './types'
import {
  getOrchestratorMode,
  addLinkedTopologyEntry,
  removeLinkedTopologyEntry,
  type LinkedTopologyConfigEntry,
} from '../orchestrator/orchestratorModeStore'

/** Thrown when the persisted mode conflicts with the ledger role for a handshake. */
export class TopologyRoleConflictError extends Error {
  readonly code = 'E_TOPOLOGY_ROLE_CONFLICT' as const
  constructor(
    public readonly handshakeId: string,
    public readonly persistedMode: 'host' | 'sandbox',
    public readonly ledgerRole: 'host' | 'sandbox',
  ) {
    super(
      `Topology role conflict for handshake ${handshakeId}: ` +
        `orchestrator-mode.json says "${persistedMode}" but the ledger says this device is "${ledgerRole}". ` +
        `Boot-flag role is a capability gate — the ledger is authoritative. Refusing to auto-wire. ` +
        `Resolve by correcting orchestrator-mode.json or the handshake device roles.`,
    )
    this.name = 'TopologyRoleConflictError'
  }
}

/** Min job kinds to declare on the linked entry for email depackaging. */
const EMAIL_DEPACKAGE_KINDS: LinkedTopologyConfigEntry['jobKinds'] = ['depackage-email']

/**
 * Derive which role this local device plays in a given internal handshake record.
 * Returns `null` if the roles are not set / identity incomplete.
 */
function localDeviceRoleInHandshake(record: HandshakeRecord): 'host' | 'sandbox' | null {
  if (record.local_role === 'initiator') {
    return record.initiator_device_role ?? null
  }
  return record.acceptor_device_role ?? null
}

/**
 * Derive which role the remote peer plays in a given internal handshake record.
 */
function peerDeviceRoleInHandshake(record: HandshakeRecord): 'host' | 'sandbox' | null {
  if (record.local_role === 'initiator') {
    return record.acceptor_device_role ?? null
  }
  return record.initiator_device_role ?? null
}

/**
 * Validate that the persisted orchestrator role and the ledger role for this
 * handshake are consistent. Throws `TopologyRoleConflictError` if they disagree.
 *
 * Rule: boot-flag role (`.mode` in orchestrator-mode.json) is a capability gate.
 * If the ledger says this device is 'sandbox' but the mode is 'host', the user
 * likely misconfigured one device. Fail loudly — never silently auto-assign.
 */
function assertRolePrecedence(handshakeId: string, localLedgerRole: 'host' | 'sandbox'): void {
  const cfg = getOrchestratorMode()
  const persistedMode = cfg.mode
  if (persistedMode !== localLedgerRole) {
    throw new TopologyRoleConflictError(handshakeId, persistedMode, localLedgerRole)
  }
}

/**
 * Wire the linked topology entry for a single ACTIVE internal handshake where
 * this device is the HOST and the peer is the SANDBOX.
 *
 * - Validates role precedence (throws loudly on conflict).
 * - Idempotent: calling multiple times with the same handshakeId is safe.
 * - No-op if this device is the SANDBOX side (it does not need a linked entry).
 * - No-op if the handshake is not yet ACTIVE or identity is incomplete.
 */
export function autoWireTopologyForHandshake(
  record: HandshakeRecord,
): void {
  if (record.handshake_type !== 'internal') return
  if (record.state !== HandshakeState.ACTIVE) return
  if (!record.internal_coordination_identity_complete) return

  const localRole = localDeviceRoleInHandshake(record)
  const peerRole = peerDeviceRoleInHandshake(record)
  if (!localRole || !peerRole) return

  if (localRole !== 'host' || peerRole !== 'sandbox') {
    // This device is the sandbox side — no linked entry needed here.
    // ingestionOwnership.ts detects sandbox via orchestratorModeStore.mode.
    return
  }

  // Validate boot-flag consistency only for the host-wiring path.
  assertRolePrecedence(record.handshake_id, localRole)

  const entry: LinkedTopologyConfigEntry = {
    role: 'sandbox',
    handshakeId: record.handshake_id,
    jobKinds: EMAIL_DEPACKAGE_KINDS as string[],
  }
  addLinkedTopologyEntry(entry)
  console.log(
    `[TOPOLOGY_AUTO_WIRE] Linked handshake ${record.handshake_id} for depackage-email ` +
      `(localRole=host peerRole=sandbox)`,
  )
}

/**
 * Remove the linked topology entry for a handshake (revoke / expiry path).
 * Idempotent: no-op if no matching entry. Also clears the opaque-ingestion
 * decision cache so the ownership change is visible within milliseconds.
 */
export function removeTopologyForHandshake(handshakeId: string): void {
  removeLinkedTopologyEntry(handshakeId)
  console.log(`[TOPOLOGY_AUTO_WIRE] Unlinked handshake ${handshakeId} (revoked/expired)`)
}

/**
 * Idempotent full sync: rebuild `linked[]` in `orchestrator-mode.json` from all
 * ACTIVE internal handshakes in the ledger where this device is the HOST and the
 * peer is the SANDBOX. Existing non-email entries for other handshake IDs are
 * untouched (they may cover other job kinds).
 *
 * Call this at app startup and after any handshake state-change (accept, revoke)
 * to keep the persisted config in sync with the ledger.
 *
 * Role conflicts are logged as errors but do NOT block startup (the entry is
 * simply not added, which is the safe/fail-closed outcome).
 */
export function syncTopologyFromActiveHandshakes(db: unknown): void {
  if (!db) return
  try {
    const rows: HandshakeRecord[] = listHandshakeRecords(db as any, {
      state: HandshakeState.ACTIVE,
      handshake_type: 'internal',
    })
    for (const record of rows) {
      if (!record.internal_coordination_identity_complete) continue
      const localRole = localDeviceRoleInHandshake(record)
      const peerRole = peerDeviceRoleInHandshake(record)
      if (!localRole || !peerRole) continue
      if (localRole !== 'host' || peerRole !== 'sandbox') continue
      try {
        assertRolePrecedence(record.handshake_id, localRole)
      } catch (err) {
        console.error(
          `[TOPOLOGY_AUTO_WIRE] Role conflict on startup sync — NOT wiring handshake ` +
            `${record.handshake_id}: ${(err as Error).message}`,
        )
        continue
      }
      const entry: LinkedTopologyConfigEntry = {
        role: 'sandbox',
        handshakeId: record.handshake_id,
        jobKinds: EMAIL_DEPACKAGE_KINDS as string[],
      }
      addLinkedTopologyEntry(entry)
    }
  } catch (err) {
    console.error('[TOPOLOGY_AUTO_WIRE] syncTopologyFromActiveHandshakes failed:', err)
  }
}
