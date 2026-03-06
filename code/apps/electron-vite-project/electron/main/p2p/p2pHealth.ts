/**
 * P2P Health Status — Track server state and delivery outcomes.
 *
 * Lightweight in-memory state. Updated on:
 * - Server start success/failure
 * - Outbound send success/failure
 * - Periodic queue count refresh (60s)
 */

export interface P2PHealthStatus {
  server_running: boolean
  server_error: string | null
  local_endpoint: string | null
  port: number
  tls_enabled: boolean
  last_outbound_success: string | null
  last_outbound_failure: string | null
  last_outbound_error: string | null
  pending_queue_count: number
  failed_queue_count: number
  self_test_passed: boolean | null
  last_relay_pull_success: string | null
  last_relay_pull_failure: string | null
  last_relay_pull_error: string | null
  relay_capsules_pulled: number
  relay_mode: string
  use_coordination: boolean
  coordination_connected: boolean
  coordination_last_push: string | null
  coordination_last_error: string | null
  coordination_reconnect_attempts: number
}

let health: P2PHealthStatus = {
  server_running: false,
  server_error: null,
  local_endpoint: null,
  port: 51249,
  tls_enabled: false,
  last_outbound_success: null,
  last_outbound_failure: null,
  last_outbound_error: null,
  pending_queue_count: 0,
  failed_queue_count: 0,
  self_test_passed: null,
  last_relay_pull_success: null,
  last_relay_pull_failure: null,
  last_relay_pull_error: null,
  relay_capsules_pulled: 0,
  relay_mode: 'local',
  use_coordination: true,
  coordination_connected: false,
  coordination_last_push: null,
  coordination_last_error: null,
  coordination_reconnect_attempts: 0,
}

const listeners = new Set<(status: P2PHealthStatus) => void>()

function notifyListeners(): void {
  const snapshot = { ...health }
  listeners.forEach((fn) => {
    try {
      fn(snapshot)
    } catch {
      /* non-fatal */
    }
  })
}

export function getP2PHealth(): P2PHealthStatus {
  return { ...health }
}

export function subscribeP2PHealth(fn: (status: P2PHealthStatus) => void): () => void {
  listeners.add(fn)
  fn(getP2PHealth())
  return () => listeners.delete(fn)
}

export function setP2PHealthServerStarted(port: number, localEndpoint: string, tlsEnabled: boolean): void {
  health.server_running = true
  health.server_error = null
  health.local_endpoint = localEndpoint
  health.port = port
  health.tls_enabled = tlsEnabled
  notifyListeners()
}

export function setP2PHealthServerFailed(error: string): void {
  health.server_running = false
  health.server_error = error
  health.local_endpoint = null
  notifyListeners()
}

export function setP2PHealthOutboundSuccess(): void {
  health.last_outbound_success = new Date().toISOString()
  health.last_outbound_failure = null
  health.last_outbound_error = null
  notifyListeners()
}

export function setP2PHealthOutboundFailure(error: string): void {
  health.last_outbound_failure = new Date().toISOString()
  health.last_outbound_error = error
  notifyListeners()
}

export function setP2PHealthQueueCounts(pending: number, failed: number): void {
  health.pending_queue_count = pending
  health.failed_queue_count = failed
  notifyListeners()
}

export function setP2PHealthSelfTest(passed: boolean): void {
  health.self_test_passed = passed
  notifyListeners()
}

export function setP2PHealthRelayMode(mode: string, useCoordination?: boolean): void {
  health.relay_mode = mode
  if (useCoordination !== undefined) health.use_coordination = useCoordination
  notifyListeners()
}

export function setP2PHealthRelayPullSuccess(pulled: number, accepted: number, _rejected: number): void {
  health.last_relay_pull_success = new Date().toISOString()
  health.last_relay_pull_failure = null
  health.last_relay_pull_error = null
  health.relay_capsules_pulled = (health.relay_capsules_pulled ?? 0) + pulled
  notifyListeners()
}

export function setP2PHealthRelayPullFailure(error: string): void {
  health.last_relay_pull_failure = new Date().toISOString()
  health.last_relay_pull_error = error
  notifyListeners()
}

export function setP2PHealthCoordinationConnected(): void {
  health.coordination_connected = true
  health.coordination_last_error = null
  notifyListeners()
}

export function setP2PHealthCoordinationDisconnected(): void {
  health.coordination_connected = false
  notifyListeners()
}

export function setP2PHealthCoordinationError(error: string): void {
  health.coordination_last_error = error
  notifyListeners()
}

export function setP2PHealthCoordinationLastPush(): void {
  health.coordination_last_push = new Date().toISOString()
  notifyListeners()
}

export function setP2PHealthCoordinationReconnectAttempts(attempts: number): void {
  health.coordination_reconnect_attempts = attempts
  notifyListeners()
}

/**
 * Convert raw error strings to user-friendly, actionable messages.
 */
export function formatP2PErrorForUser(
  rawError: string,
  endpoint?: string,
  port?: number,
): string {
  const portNum = port ?? 51249
  const err = (rawError || '').toLowerCase()

  if (err.includes('eaddrinuse') || err.includes('address already in use')) {
    return `P2P server could not start: Port ${portNum} is already in use. Close the other application using this port, or change the P2P port in settings.`
  }
  if (err.includes('eacces') || err.includes('permission denied') || err.includes('bind')) {
    return 'P2P server could not start: Unable to bind to network interface. Check your network configuration.'
  }
  if (err.includes('econnrefused') || err.includes('connection refused')) {
    const ep = endpoint ? ` (${endpoint})` : ''
    return `P2P delivery failed: Connection refused${ep}. The recipient's P2P server may be offline or their firewall may be blocking port ${portNum}.`
  }
  if (err.includes('timeout') || err.includes('timed out') || err.includes('aborted')) {
    const ep = endpoint ? ` to ${endpoint}` : ''
    return `P2P delivery failed: Connection${ep} timed out. Check if the recipient is online and port ${portNum} is open.`
  }
  if (err.includes('enotfound') || err.includes('getaddrinfo') || err.includes('dns')) {
    const host = endpoint ? new URL(endpoint).hostname : 'hostname'
    return `P2P delivery failed: Could not resolve ${host}. Check the recipient's endpoint address.`
  }
  if (err.includes('failed to parse url') || err.includes('invalid url')) {
    return `P2P delivery failed: Invalid endpoint URL. Check the recipient's P2P configuration.`
  }

  return rawError || 'P2P delivery failed.'
}

/**
 * Get firewall hint for the current OS.
 */
export function getFirewallHint(port: number): string | null {
  const plat = typeof process !== 'undefined' ? process.platform : 'unknown'
  if (plat === 'win32') {
    return `Run as admin: netsh advfirewall firewall add rule name="BEAP P2P" dir=in action=allow protocol=TCP localport=${port}`
  }
  if (plat === 'darwin') {
    return 'System Settings → Network → Firewall → allow incoming on port ' + port
  }
  if (plat === 'linux') {
    return `Run: sudo ufw allow ${port}/tcp`
  }
  return null
}
