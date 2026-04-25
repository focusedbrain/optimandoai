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
    return { primary: 'Checking connection to your Host…', hint: null }
  }
  if (status === 'reachable') {
    return { primary: 'Host reachable', hint: null }
  }
  if (status === 'auth_failed') {
    return {
      primary: 'Host AI · P2P unavailable',
      hint: 'Connection to your Host failed. Check pairing in Settings on both devices.',
    }
  }
  if (status === 'missing_endpoint') {
    return {
      primary: 'Host AI · P2P unavailable',
      hint: 'A reachable path to the Host is required. Check the handshake in Settings, then try again.',
    }
  }
  return {
    primary: 'Host AI · P2P unavailable',
    hint: 'Firewall or network may be blocking the connection. Check that the Host app is online.',
  }
}

/** Host → Sandbox: symmetric direct check. */
export function directP2pReachabilityCopyForHostToSandbox(
  status: DirectP2pReachabilityStatus | null,
): { primary: string; hint: string | null } {
  if (status == null || status === 'unknown') {
    return { primary: 'Checking connection to Sandbox…', hint: null }
  }
  if (status === 'reachable') {
    return { primary: 'Sandbox reachable', hint: null }
  }
  if (status === 'auth_failed') {
    return { primary: 'Sandbox not reachable', hint: 'Connection to Sandbox failed. Check pairing in Settings on both devices.' }
  }
  if (status === 'missing_endpoint') {
    return { primary: 'Sandbox not reachable', hint: 'A direct network path to Sandbox is required; relay alone is not enough.' }
  }
  return {
    primary: 'Sandbox not reachable',
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
  return 'Host AI · P2P unavailable. Check that the Host is online, on a reachable path, and that firewalls or VPN allow the connection.'
}
