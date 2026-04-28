import { hostAiGenericP2pUnavailableLine } from './hostAiUiDiagnostics'

/** Pure UI gates for Host inference (unit-tested; no Electron). */

export type DirectP2pReachabilityStatus =
  | 'reachable'
  | 'unreachable'
  | 'missing_endpoint'
  | 'tls_error'
  | 'auth_failed'
  | 'timeout'
  | 'unknown'

/** Sandbox → Host: primary + optional network/auth hint. `null` = do not show a banner (healthy / still probing). */
export function directP2pReachabilityCopyForSandboxToHost(
  status: DirectP2pReachabilityStatus | null,
): { primary: string; hint: string | null } | null {
  if (status == null || status === 'unknown' || status === 'reachable') {
    return null
  }
  if (status === 'auth_failed') {
    return {
      primary: 'Connection to host failed',
      hint: 'Check pairing in Settings on both devices.',
    }
  }
  if (status === 'missing_endpoint') {
    return {
      primary: 'Connection to host failed',
      hint: 'No trusted direct BEAP endpoint for this pairing. On the Host, ensure a direct address is advertised (Host AI diagnostics when available).',
    }
  }
  return {
    primary: 'Connection to host failed',
    hint: 'Firewall or network may be blocking the connection. Ensure the Host app is online.',
  }
}

/** Host → Sandbox: symmetric direct check. `null` = do not show a banner (healthy / still probing). */
export function directP2pReachabilityCopyForHostToSandbox(
  status: DirectP2pReachabilityStatus | null,
): { primary: string; hint: string | null } | null {
  if (status == null || status === 'unknown' || status === 'reachable') {
    return null
  }
  if (status === 'auth_failed') {
    return {
      primary: 'Connection to Sandbox failed',
      hint: 'Check pairing in Settings on both devices.',
    }
  }
  if (status === 'missing_endpoint') {
    return {
      primary: 'Connection to Sandbox failed',
      hint: 'A direct network path to Sandbox is required; relay alone is not enough.',
    }
  }
  return {
    primary: 'Connection to Sandbox failed',
    hint: 'Firewall or network may be blocking the connection to Sandbox.',
  }
}

export function hostInferenceOptionVisible(
  orchestratorReady: boolean,
  mode: 'host' | 'sandbox' | null,
  directHostCandidates: number,
): boolean {
  return orchestratorReady === true && mode === 'sandbox' && directHostCandidates >= 1
}

export function hostInferenceSetupMessageVisible(
  orchestratorReady: boolean,
  mode: 'host' | 'sandbox' | null,
  listLoading: boolean,
  directHostCandidates: number,
): boolean {
  return (
    orchestratorReady &&
    mode === 'sandbox' &&
    !listLoading &&
    directHostCandidates === 0
  )
}

export function hostInferenceSelectorMultiple(
  orchestratorReady: boolean,
  mode: 'host' | 'sandbox' | null,
  directHostCandidates: number,
): boolean {
  return hostInferenceOptionVisible(orchestratorReady, mode, directHostCandidates) && directHostCandidates > 1
}

export function hostInferenceDirectUnavailableMessage(
  directP2pAvailable: boolean,
): string | null {
  if (directP2pAvailable) return null
  return hostAiGenericP2pUnavailableLine()
}
