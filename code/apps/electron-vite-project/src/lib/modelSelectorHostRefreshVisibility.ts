import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'

type SelectorRowLike = { type?: string; hostAi?: boolean; section?: 'local' | 'host' | 'cloud' }

type HostTargetLike = Pick<HostInferenceTargetRow, 'kind'> & { available?: boolean }

/**
 * True when a **selectable** Host internal row exists (or merged model list has an enabled host group).
 * Disabled diagnostic-only rows (transport down, Ollama missing, etc.) do not count — otherwise the
 * model selector shows "Host AI" discovery while no inference route is ready.
 * WR Chat passes rows with `hostAi` / `section` from `wrChatModelOptionsFromSelectorModels` (no `type` on that shape).
 */
export function discoveryHasHostInternalRows(
  gavHostTargets: HostTargetLike[],
  selectorOrMergedModels: SelectorRowLike[],
): boolean {
  if (gavHostTargets.some((t) => t.kind === 'host_internal' && t.available === true)) {
    return true
  }
  return selectorOrMergedModels.some(
    (m) => m.type === 'host_internal' || m.hostAi === true || m.section === 'host',
  )
}

export type HandshakeLocalRoleForLog = 'sandbox' | 'host' | 'unknown'

export function handshakeLocalRoleForModelSelectorLog(p: {
  ledgerProvesInternalSandboxToHost: boolean
  ledgerProvesLocalHostPeerSandbox: boolean
}): HandshakeLocalRoleForLog {
  if (p.ledgerProvesInternalSandboxToHost) {
    return 'sandbox'
  }
  if (p.ledgerProvesLocalHostPeerSandbox) {
    return 'host'
  }
  return 'unknown'
}

/**
 * See STEP 4 — Host AI ↻ visibility: handshake / discovery over stale configured mode, hide on true Host side.
 */
export function computeShowHostInferenceRefresh(p: {
  orchModeReady: boolean
  orchIsSandbox: boolean
  orchIsHost: boolean
  ledgerProvesInternalSandboxToHost: boolean
  ledgerProvesLocalHostPeerSandbox: boolean
  discoveryHasHostInternalRows: boolean
}): { show: boolean; reason: string } {
  if (p.ledgerProvesLocalHostPeerSandbox) {
    return { show: false, reason: 'ledger_local_host_device_on_internal_pair' }
  }
  const hasHandshakeDerivedSandboxHostTarget =
    p.ledgerProvesInternalSandboxToHost || p.discoveryHasHostInternalRows
  const modeFallback = p.orchModeReady && p.orchIsSandbox && !p.orchIsHost
  if (hasHandshakeDerivedSandboxHostTarget) {
    if (p.ledgerProvesInternalSandboxToHost) {
      return { show: true, reason: 'ledger_sandbox_to_host' }
    }
    return { show: true, reason: 'discovery_host_internal_rows' }
  }
  if (modeFallback) {
    return { show: true, reason: 'configured_mode_sandbox_until_discovery' }
  }
  return { show: false, reason: 'not_sandbox_no_handshake_and_no_mode_fallback' }
}

export function logModelSelectorShowRefresh(p: {
  selector: 'top' | 'wrchat'
  configuredMode: 'host' | 'sandbox' | 'unknown' | null
  handshakeLocalRole: HandshakeLocalRoleForLog
  show: boolean
  reason: string
}): void {
  const m =
    p.configuredMode === 'host' || p.configuredMode === 'sandbox' ? p.configuredMode : 'unknown'
  console.log(
    `[MODEL_SELECTOR_TARGETS] show_refresh selector=${p.selector} configured_mode=${m} handshake_local_role=${p.handshakeLocalRole} show=${p.show} reason=${p.reason}`,
  )
}
