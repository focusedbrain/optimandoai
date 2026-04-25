import {
  type HandshakeLocalRoleForLog,
  handshakeLocalRoleForModelSelectorLog,
} from './modelSelectorHostRefreshVisibility'

/**
 * When persisted `orchestrator-mode.json` disagrees with active internal-ledger local role, Host AI
 * eligibility must follow the handshake/ledger (STEP 7). Setup UI can still use configured mode
 * when no active internal row exists.
 */
export type ModeHandshakeMismatchInfo =
  | { mismatch: false }
  | {
      mismatch: true
      kind: 'config_host_ledger_sandbox' | 'config_sandbox_ledger_host'
      message: string
    }

const MSG_CONFIG_HOST_HANDSHAKE_SANDBOX =
  'This device is configured as Host, but an active internal handshake identifies it as Sandbox for this connection.'

const MSG_CONFIG_SANDBOX_HANDSHAKE_HOST =
  'This device is configured as Sandbox, but an active internal handshake identifies it as Host for this connection.'

export function getOrchestratorModeVsHandshakeInfo(p: {
  orchModeReady: boolean
  mode: 'host' | 'sandbox' | null
  ledgerProvesInternalSandboxToHost: boolean
  ledgerProvesLocalHostPeerSandbox: boolean
}): ModeHandshakeMismatchInfo {
  if (!p.orchModeReady || p.mode == null) {
    return { mismatch: false }
  }
  const hasActiveInternal = p.ledgerProvesInternalSandboxToHost || p.ledgerProvesLocalHostPeerSandbox
  if (!hasActiveInternal) {
    return { mismatch: false }
  }
  if (p.mode === 'host' && p.ledgerProvesInternalSandboxToHost) {
    return { mismatch: true, kind: 'config_host_ledger_sandbox', message: MSG_CONFIG_HOST_HANDSHAKE_SANDBOX }
  }
  if (p.mode === 'sandbox' && p.ledgerProvesLocalHostPeerSandbox) {
    return { mismatch: true, kind: 'config_sandbox_ledger_host', message: MSG_CONFIG_SANDBOX_HANDSHAKE_HOST }
  }
  return { mismatch: false }
}

/**
 * One line for DevTools / main logs. Call when `getOrchestratorModeVsHandshakeInfo` returns `mismatch: true`
 * (dedupe in caller so we do not spam on every render).
 */
export function logOrchestratorModeVsHandshakeMismatch(p: {
  configuredMode: 'host' | 'sandbox'
  handshakeLocalRole: HandshakeLocalRoleForLog
}): void {
  console.log(
    `[ORCHESTRATOR_MODE_VS_HANDSHAKE] configured_mode=${p.configuredMode} handshake_local_role=${p.handshakeLocalRole} eligibility_uses=handshake note=mismatch_ignored_for_host_ai_stale_persisted_mode`,
  )
}

export function handshakeRoleForModeMismatch(
  ledgerProvesInternalSandboxToHost: boolean,
  ledgerProvesLocalHostPeerSandbox: boolean,
): HandshakeLocalRoleForLog {
  return handshakeLocalRoleForModelSelectorLog({
    ledgerProvesInternalSandboxToHost,
    ledgerProvesLocalHostPeerSandbox,
  })
}

export { MSG_CONFIG_HOST_HANDSHAKE_SANDBOX, MSG_CONFIG_SANDBOX_HANDSHAKE_HOST }
