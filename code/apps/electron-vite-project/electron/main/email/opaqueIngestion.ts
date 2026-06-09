/**
 * Host-ingestion inertness decision — the SINGLE source of truth (Prompt 1).
 *
 * "Inert" host ingestion means the host is a blind courier: it lists messages by
 * provider-supplied id only, fetches each as an OPAQUE blob, and forwards it
 * through the depackage seam WITHOUT parsing any attacker-controlled bytes (no
 * header inspection, no MIME parse, no body/attachment extraction, no
 * structure-based routing). All untrusted parsing happens inside the isolated,
 * key-less guest.
 *
 * `isOpaqueIngestionActive()` is consulted identically by every layer that could
 * otherwise parse on the host — the providers (list/detail fetch), the
 * `inlineParseGuard`, and `messageRouter.detectAndRouteMessage` — so the decision
 * can never be inconsistent across the pipeline (the "split-brain" the analysis
 * flagged: resolution.ts routed depackage remote while the host still parsed).
 *
 * It is the OR of two signals:
 *   1. `WRDESK_SEAM_DEPACKAGE_CUTOVER` — the explicit per-machine ops override
 *      (kept from B2; env wins, then persisted config).
 *   2. An ACTIVE linked topology that routes email depackaging to a sandbox /
 *      appliance (the Build C `orchestrator-mode.json` `linked` array). When a
 *      node has declared such a link, the host COMMITS to inertness: it forwards
 *      opaque bytes to the seam. If the paired sandbox is momentarily
 *      unavailable, the seam fails closed (HELD / quarantine) — it never
 *      downgrades to inline parsing.
 *
 * No-sandbox / no-flag → returns false → the legacy inline path runs (clearly the
 * non-isolated path; it makes no isolation claim). This is the documented
 * fallback: the host only parses untrusted mail when NO isolation has been
 * configured, and it never parses while claiming isolation.
 */

import { isSeamDepackageCutoverEnabled } from '../critical-jobs/featureFlags'
import { buildResolutionContext } from '../critical-jobs/context'

/**
 * The linked-topology read walks `orchestrator-mode.json` (+ env/argv overrides).
 * It is cheap but not free, and `isOpaqueIngestionActive` is consulted in hot
 * loops (per message + per parse-guard). Memoize with a short TTL so a tight sync
 * loop does not re-read the file for every message; a fresh process / config
 * change is picked up within the TTL.
 */
const LINKED_TTL_MS = 3000
let linkedCache: { value: boolean; atMs: number } | null = null

/**
 * True iff the persisted/overridden topology links a sandbox or appliance for
 * email depackaging (`depackage-email`, or the generic `depackage` kind). Pure
 * read; never throws (a missing/parse-failed config → `false`).
 */
export function hasLinkedDepackageSandbox(now: () => number = Date.now): boolean {
  const t = now()
  if (linkedCache && t - linkedCache.atMs < LINKED_TTL_MS) return linkedCache.value
  let value = false
  try {
    const ctx = buildResolutionContext()
    value = ctx.topology.linked.some(
      (e) => e.jobKinds.includes('depackage-email') || e.jobKinds.includes('depackage'),
    )
  } catch {
    value = false
  }
  linkedCache = { value, atMs: t }
  return value
}

/**
 * The host-inertness decision. When true the host MUST behave as a blind courier
 * (opaque fetch, no parse, route via the seam). Reads `process.env` fresh for the
 * explicit override so tests/ops can toggle it without restart.
 */
export function isOpaqueIngestionActive(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isSeamDepackageCutoverEnabled(env)) return true
  return hasLinkedDepackageSandbox()
}

/** Test-only: drop the linked-topology memo so a test can change topology mid-run. */
export function __resetOpaqueIngestionCacheForTests(): void {
  linkedCache = null
}
