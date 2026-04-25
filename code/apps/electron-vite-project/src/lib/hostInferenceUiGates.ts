/** Pure UI gates for Host inference (unit-tested; no Electron). */

export type DirectP2pReachabilityStatus =
  | 'reachable'
  | 'unreachable'
  | 'missing_endpoint'
  | 'tls_error'
  | 'auth_failed'
  | 'timeout'
  | 'unknown'

/** Sandbox → Host: primary + optional network/auth hint. */
export function directP2pReachabilityCopyForSandboxToHost(
  status: DirectP2pReachabilityStatus | null,
): { primary: string; hint: string | null } {
  if (status == null || status === 'unknown') {
    return { primary: 'Checking direct P2P…', hint: null }
  }
  if (status === 'reachable') {
    return { primary: 'Host reachable', hint: null }
  }
  if (status === 'auth_failed') {
    return { primary: 'Host not reachable', hint: 'P2P authentication failed. Check pairing on both devices.' }
  }
  if (status === 'missing_endpoint') {
    return { primary: 'Host not reachable', hint: 'No direct P2P endpoint — relay is not used for Host inference.' }
  }
  return {
    primary: 'Host not reachable',
    hint: 'Firewall or network may block direct P2P.',
  }
}

/** Host → Sandbox: symmetric direct check. */
export function directP2pReachabilityCopyForHostToSandbox(
  status: DirectP2pReachabilityStatus | null,
): { primary: string; hint: string | null } {
  if (status == null || status === 'unknown') {
    return { primary: 'Checking direct P2P…', hint: null }
  }
  if (status === 'reachable') {
    return { primary: 'Sandbox direct P2P reachable', hint: null }
  }
  if (status === 'auth_failed') {
    return { primary: 'Sandbox not reachable', hint: 'P2P authentication failed. Check pairing on both devices.' }
  }
  if (status === 'missing_endpoint') {
    return { primary: 'Sandbox not reachable', hint: 'No direct P2P endpoint — relay is not used for Host inference.' }
  }
  return {
    primary: 'Sandbox not reachable',
    hint: 'Firewall or network may block direct P2P.',
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
  return 'Host is not directly reachable. Start Host orchestrator on the same network or check firewall.'
}
