/**
 * Unified email connect: one setup UI, scope chosen by effective sandbox role.
 * Sandbox nodes (persisted mode or ledger-proven) request read-only OAuth scopes;
 * host / single-machine keeps the bundled 'all' scope set unchanged.
 */

import { getOrchestratorMode } from '../orchestrator/orchestratorModeStore'
import type { OAuthScopeRole } from './oauthScopes'

export async function isEffectiveSandboxNode(): Promise<boolean> {
  const mode = getOrchestratorMode().mode
  if (mode === 'sandbox') return true
  try {
    const { hasActiveInternalLedgerSandboxToHostForHostAi } = await import(
      '../internalInference/listInferenceTargets'
    )
    return await hasActiveInternalLedgerSandboxToHostForHostAi()
  } catch {
    return false
  }
}

/** Sandbox → read scopes; host / single-machine → bundled all scopes. */
export async function resolveConnectOAuthScopeRole(): Promise<OAuthScopeRole> {
  return (await isEffectiveSandboxNode()) ? 'read' : 'all'
}
