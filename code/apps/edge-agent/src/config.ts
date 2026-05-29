/**
 * Edge Agent runtime configuration (Stream C — C3).
 */

export type AgentPhase = 'unpaired' | 'paired'

export interface AgentConfig {
  readonly setupHost: string
  readonly setupPort: number
  readonly pairingHost: string
  readonly pairingPort: number
  readonly stateDir: string
  readonly p2pHost: string
  readonly p2pPort: number
  /** Hostname/IP orchestrator uses in p2p_endpoint (not 0.0.0.0). */
  readonly publicHost: string
  readonly podName: string
  /** Coordination service base URL (registry + future relay WS). */
  readonly coordinationUrl: string
  /**
   * When true, setup uses registry bootstrap (WS1) instead of legacy :8443 pairing UI.
   * Default false until epic gates and E2E on replacement path are met.
   */
  readonly registryBootstrapEnabled: boolean
}

export function loadConfig(): AgentConfig {
  const stateDir =
    process.env['WRDESK_AGENT_STATE_DIR'] ??
    (process.getuid?.() === 0 ? '/var/lib/wrdesk-edge-agent' : `${process.env.HOME ?? '.'}/.wrdesk-edge-agent`)

  return {
    setupHost: process.env['WRDESK_AGENT_SETUP_HOST'] ?? '127.0.0.1',
    setupPort: Number(process.env['WRDESK_AGENT_SETUP_PORT'] ?? 8090),
    pairingHost: process.env['WRDESK_AGENT_PAIRING_HOST'] ?? '0.0.0.0',
    pairingPort: Number(process.env['WRDESK_AGENT_PAIRING_PORT'] ?? 8443),
    stateDir,
    p2pHost: process.env['WRDESK_AGENT_P2P_HOST'] ?? '0.0.0.0',
    p2pPort: Number(process.env['WRDESK_AGENT_P2P_PORT'] ?? 51_249),
    publicHost: process.env['WRDESK_AGENT_PUBLIC_HOST'] ?? '127.0.0.1',
    podName: process.env['WRDESK_AGENT_POD_NAME'] ?? 'beap-remote-edge',
    coordinationUrl:
      process.env['WRDESK_AGENT_COORDINATION_URL']?.trim() || 'https://relay.wrdesk.com',
    registryBootstrapEnabled: process.env['WRDESK_AGENT_REGISTRY_BOOTSTRAP'] === '1',
  }
}

export function buildP2pEndpoint(config: AgentConfig): string {
  const host = config.publicHost === '0.0.0.0' ? '127.0.0.1' : config.publicHost
  return `http://${host}:${config.p2pPort}`
}
