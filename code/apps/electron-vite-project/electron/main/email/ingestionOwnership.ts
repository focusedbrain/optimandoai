/**
 * Prompt 3 — email ingestion FETCH-OWNERSHIP, the single source of truth.
 *
 * The A2 multi-machine model: when a linked sandbox/appliance covers email
 * ingestion, that sandbox node OWNS the read-poll (it fetches with its read
 * client and depackages locally). The host then does NOT read-poll — it keeps
 * its send client for outbound only. Raw untrusted mail never touches the host.
 *
 * This decision is derived from the SAME topology signal as Prompt 1's
 * `isOpaqueIngestionActive()` (`hasLinkedDepackageSandbox()` + the persisted node
 * role), NOT a parallel flag — so ownership can never disagree with the inertness
 * decision. The distinction:
 *
 *   - Linked sandbox covers email depackage  → owner = 'sandbox'
 *       (multi-machine A2: sandbox fetches; host read-poll DISABLED).
 *   - No linked sandbox (single-machine)     → owner = 'host'
 *       (host fetches — opaque-courier when the cutover flag is on, else legacy;
 *        Prompt 1 path, UNCHANGED — fetch is NOT relocated).
 *
 * Note the deliberate asymmetry with `isOpaqueIngestionActive()`: the explicit
 * `WRDESK_SEAM_DEPACKAGE_CUTOVER` flag makes the host INERT (opaque courier) but
 * does NOT relocate the fetch — only a real LINKED sandbox transfers ownership.
 */

import { hasLinkedDepackageSandbox } from './opaqueIngestion'
import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'

export type IngestionOwner = 'host' | 'sandbox'
export type NodeRole = 'host' | 'sandbox'

export interface IngestionOwnership {
  /** Which node OWNS the read-poll for email ingestion. */
  owner: IngestionOwner
  /** This process's persisted orchestrator role. */
  thisNodeRole: NodeRole
  /**
   * May the HOST run its read-poll? True only when the host is the owner
   * (single-machine / no linked sandbox). False when a linked sandbox owns
   * ingestion — the host fetches NOTHING (send client stays for outbound).
   */
  hostShouldReadPoll: boolean
  /**
   * Should THIS node run the sandbox-role poll? True only when the sandbox owns
   * ingestion AND this process is the sandbox node.
   */
  sandboxShouldReadPoll: boolean
  /** Human-readable explanation (logged at the decision site). */
  reason: string
}

function resolveNodeRole(): NodeRole {
  try {
    return getOrchestratorMode().mode === 'sandbox' ? 'sandbox' : 'host'
  } catch {
    return 'host'
  }
}

/**
 * The fetch-ownership decision. Pure read off topology + persisted role; never
 * throws (a missing/parse-failed config → host-owned, the safe legacy default).
 *
 * Three signals make a sandbox the ingestion owner:
 *  1. `hasLinkedDepackageSandbox()` — the HOST's orchestrator-mode.json has a
 *     linked entry for depackage-email. Set by Prompt 4 topology auto-wire when
 *     an internal handshake with a sandbox peer becomes ACTIVE.
 *  2. `thisNodeRole === 'sandbox'` — the persisted orchestrator role is 'sandbox'.
 *  3. `opts.ledgerProvesSandbox === true` — the ACTIVE internal ledger proves this
 *     device is the Sandbox side of a Sandbox↔Host pair even though
 *     orchestrator-mode.json still says 'host' (stale file, no sync-back on accept).
 *     Mirrors the Host-AI pattern in listInferenceTargets.ts. The signal is
 *     directional: deriveInternalHostAiPeerRoles matches this device's coordination
 *     ID, so the host never reports ledgerProvesSandbox=true for itself.
 *     Use {@link resolveIngestionOwnershipWithLedger} to supply this automatically.
 */
export function resolveIngestionOwnership(opts?: { ledgerProvesSandbox?: boolean }): IngestionOwnership {
  const thisNodeRole = resolveNodeRole()
  const ledgerSandbox = opts?.ledgerProvesSandbox === true
  const effectiveSandbox = thisNodeRole === 'sandbox' || ledgerSandbox
  const linkedSandboxOwnsIngestion = hasLinkedDepackageSandbox()

  if (linkedSandboxOwnsIngestion) {
    return {
      owner: 'sandbox',
      thisNodeRole: effectiveSandbox ? 'sandbox' : thisNodeRole,
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: effectiveSandbox,
      reason:
        `linked sandbox covers email depackage → sandbox owns ingestion; ` +
        `thisNode=${effectiveSandbox ? 'sandbox' : thisNodeRole}${effectiveSandbox && ledgerSandbox ? ' (ledger-derived)' : ''} ` +
        `${effectiveSandbox ? 'runs the read-poll' : 'read-poll DISABLED (send only)'}`,
    }
  }

  // Sandbox-mode node (second machine) owns ingestion even before its host has
  // completed the topology auto-wire. Also covers the stale-file case: accepting
  // a sandbox-role internal handshake writes acceptor_device_role='sandbox' to
  // the ledger but does NOT update orchestrator-mode.json — effectiveSandbox catches
  // that via opts.ledgerProvesSandbox so the sandbox starts polling immediately.
  if (effectiveSandbox) {
    return {
      owner: 'sandbox',
      thisNodeRole: 'sandbox',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: true,
      reason: ledgerSandbox && thisNodeRole !== 'sandbox'
        ? `ledger proves sandbox role (orchestrator-mode.json stale, mode=host) → this node owns email ingestion ` +
          `(A2 multi-machine; BEAP-delivery to host via P2P)`
        : `orchestrator mode is 'sandbox' → this node owns email ingestion ` +
          `(A2 multi-machine; linked entry on host may not be wired yet but sandbox runs the poll)`,
    }
  }

  return {
    owner: 'host',
    thisNodeRole,
    hostShouldReadPoll: thisNodeRole === 'host',
    sandboxShouldReadPoll: false,
    reason:
      `no linked sandbox for email depackage → host owns ingestion ` +
      `(single-machine; Prompt 1 courier/legacy, fetch NOT relocated); thisNode=${thisNodeRole}`,
  }
}

/**
 * Async version: consults the ACTIVE internal handshake ledger to detect the
 * stale-file case (orchestrator-mode.json says 'host' but the device accepted in
 * sandbox role — no sync-back exists). Falls back to the file-only path on any
 * error. Use this at all production call sites in async contexts; the sync
 * {@link resolveIngestionOwnership} remains for test injection via `deps.ownership`.
 */
export async function resolveIngestionOwnershipWithLedger(): Promise<IngestionOwnership> {
  let ledgerProvesSandbox = false
  try {
    const { hasActiveInternalLedgerSandboxToHostForHostAi } = await import(
      '../internalInference/listInferenceTargets'
    )
    ledgerProvesSandbox = await hasActiveInternalLedgerSandboxToHostForHostAi()
  } catch {
    // Fallback to file-only — never throw; host-owned is the safe default.
  }
  return resolveIngestionOwnership({ ledgerProvesSandbox })
}

/** Thrown when host read-poll/parse is attempted while a sandbox owns ingestion. */
export class HostReadPollForbiddenError extends Error {
  readonly code = 'E_HOST_READ_POLL_FORBIDDEN' as const
  constructor(public readonly site: string) {
    super(
      `Host read-fetch/parse is forbidden while a linked sandbox owns email ingestion ` +
        `(A2 multi-machine, INV-3 fail-closed). site=${site}`,
    )
    this.name = 'HostReadPollForbiddenError'
  }
}

/**
 * Instrumentation tripwire: assert the host is permitted to read-poll right now.
 * Throws `HostReadPollForbiddenError` iff this node is the host AND a linked
 * sandbox owns ingestion. Placed at the host fetch entry so a regression that
 * bypasses the early-return gate fails closed LOUDLY instead of silently
 * read-polling untrusted mail. Inert (cheap) when host owns ingestion.
 */
export function assertHostMayReadPoll(site: string, ownership: IngestionOwnership = resolveIngestionOwnership()): void {
  if (ownership.thisNodeRole === 'host' && !ownership.hostShouldReadPoll) {
    throw new HostReadPollForbiddenError(site)
  }
}
