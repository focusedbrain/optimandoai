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
 * Two signals make a sandbox the ingestion owner:
 *  1. `hasLinkedDepackageSandbox()` — the HOST's orchestrator-mode.json has a
 *     linked entry for depackage-email. Set by Prompt 4 topology auto-wire when
 *     an internal handshake with a sandbox peer becomes ACTIVE. The host read-poll
 *     is disabled and remote routing activates (in the host's resolution table).
 *  2. `thisNodeRole === 'sandbox'` — the persisted orchestrator role is 'sandbox'.
 *     On a multi-machine appliance the sandbox node never needs its OWN linked[]
 *     entry to know it should run the poll; the role itself is the signal. On
 *     single-machine the role is always 'host', so this branch never fires there.
 */
export function resolveIngestionOwnership(): IngestionOwnership {
  const thisNodeRole = resolveNodeRole()
  const linkedSandboxOwnsIngestion = hasLinkedDepackageSandbox()

  if (linkedSandboxOwnsIngestion) {
    return {
      owner: 'sandbox',
      thisNodeRole,
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: thisNodeRole === 'sandbox',
      reason:
        `linked sandbox covers email depackage → sandbox owns ingestion; ` +
        `thisNode=${thisNodeRole} ${thisNodeRole === 'host' ? 'read-poll DISABLED (send only)' : 'runs the read-poll'}`,
    }
  }

  // Sandbox-mode node (second machine) owns ingestion even before its host has
  // completed the topology auto-wire, so the read-poll starts as soon as the
  // sandbox has a valid read-token and the host has a live handshake. Fail-closed
  // semantics in sandboxIngestion.ts ensure no silent fallback.
  if (thisNodeRole === 'sandbox') {
    return {
      owner: 'sandbox',
      thisNodeRole: 'sandbox',
      hostShouldReadPoll: false,
      sandboxShouldReadPoll: true,
      reason:
        `orchestrator mode is 'sandbox' → this node owns email ingestion ` +
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
