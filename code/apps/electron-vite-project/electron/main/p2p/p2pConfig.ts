/**
 * P2P Server Configuration
 *
 * Stored in p2p_config table (single row). Migrated with handshake DB.
 */

import { networkInterfaces } from 'os'

export type RelayMode = 'local' | 'remote' | 'disabled'

export interface P2PConfig {
  enabled: boolean
  port: number
  bind_address: string
  tls_enabled: boolean
  tls_cert_path: string | null
  tls_key_path: string | null
  local_p2p_endpoint: string | null
  relay_mode: RelayMode
  relay_url: string | null
  relay_pull_url: string | null
  relay_auth_secret: string | null
  remote_relay_host: string | null
  remote_relay_mtls_cert: string | null
  remote_relay_mtls_key: string | null
  relay_cert_fingerprint: string | null
  coordination_url: string
  coordination_ws_url: string
  coordination_enabled: boolean
  /** Computed: true when relay_mode is 'local' or 'disabled' (Free tier uses coordination) */
  use_coordination: boolean
}

/** Default config: P2P enabled out of the box, relay_mode=local (P2P server acts as relay). */
export const DEFAULT_P2P_CONFIG: P2PConfig = {
  enabled: true,
  port: 51249,
  bind_address: '0.0.0.0',
  tls_enabled: false,
  tls_cert_path: null,
  tls_key_path: null,
  local_p2p_endpoint: null,
  relay_mode: 'local',
  relay_url: null,
  relay_pull_url: null,
  relay_auth_secret: null,
  remote_relay_host: null,
  remote_relay_mtls_cert: null,
  remote_relay_mtls_key: null,
  relay_cert_fingerprint: null,
  coordination_url: 'https://relay.wrdesk.com',
  coordination_ws_url: 'wss://relay.wrdesk.com/beap/ws',
  coordination_enabled: true,
  use_coordination: true,
}

export function getP2PConfig(db: any): P2PConfig {
  const fallback = { ...DEFAULT_P2P_CONFIG }
  if (!db) return fallback
  try {
    const row = db.prepare('SELECT * FROM p2p_config LIMIT 1').get() as any
    if (!row) return fallback
    const relayMode = (row.relay_mode === 'remote' || row.relay_mode === 'disabled')
      ? row.relay_mode
      : 'local'
    const coordinationEnabled = row.coordination_enabled !== 0
    const useCoordination = coordinationEnabled && (relayMode === 'local' || relayMode === 'disabled')
    return {
      enabled: !!row.enabled,
      port: row.port ?? DEFAULT_P2P_CONFIG.port,
      bind_address: row.bind_address ?? DEFAULT_P2P_CONFIG.bind_address,
      tls_enabled: !!row.tls_enabled,
      tls_cert_path: row.tls_cert_path ?? null,
      tls_key_path: row.tls_key_path ?? null,
      local_p2p_endpoint: row.local_p2p_endpoint ?? null,
      relay_mode: relayMode,
      relay_url: row.relay_url ?? null,
      relay_pull_url: row.relay_pull_url ?? null,
      relay_auth_secret: row.relay_auth_secret ?? null,
      remote_relay_host: row.remote_relay_host ?? null,
      remote_relay_mtls_cert: row.remote_relay_mtls_cert ?? null,
      remote_relay_mtls_key: row.remote_relay_mtls_key ?? null,
      relay_cert_fingerprint: row.relay_cert_fingerprint ?? null,
      coordination_url: (row.coordination_url ?? DEFAULT_P2P_CONFIG.coordination_url).trim(),
      coordination_ws_url: (row.coordination_ws_url ?? DEFAULT_P2P_CONFIG.coordination_ws_url).trim(),
      coordination_enabled: coordinationEnabled,
      use_coordination: useCoordination,
    }
  } catch {
    return fallback
  }
}

/**
 * Resolve the effective p2p_endpoint for capsule building.
 * - use_coordination: coordination_url + /beap/capsule (wrdesk.com relay)
 * - relay_mode 'remote': relay_url (user-configured remote relay)
 * - relay_mode 'disabled': local_p2p_endpoint (direct P2P, no relay)
 * - relay_mode 'local' without coordination: local_p2p_endpoint (P2P server acts as relay)
 */
export function getEffectiveRelayEndpoint(config: P2PConfig, localEndpoint: string | null): string | null {
  if (config.use_coordination && config.coordination_url?.trim()) {
    const base = config.coordination_url.replace(/\/$/, '')
    return `${base}/beap/capsule`
  }
  if (config.relay_mode === 'disabled') {
    return localEndpoint
  }
  if (config.relay_mode === 'remote' && config.relay_url?.trim()) {
    return config.relay_url.trim()
  }
  return localEndpoint
}

/**
 * Detect the machine's primary non-internal IPv4 address for P2P endpoint display.
 * Used when bind_address is 0.0.0.0 — returns an address the counterparty can use.
 */
export function detectLocalP2PHost(): string {
  try {
    const nets = networkInterfaces()
    for (const name of Object.keys(nets)) {
      const addrs = nets[name]
      if (!addrs) continue
      for (const addr of addrs) {
        const isV4 = addr.family === 'IPv4' || addr.family === 4
        if (isV4 && !addr.internal) {
          return addr.address
        }
      }
    }
  } catch { /* non-fatal */ }
  return '127.0.0.1'
}

/**
 * Compute the local P2P endpoint URL for a running server.
 */
export function computeLocalP2PEndpoint(config: P2PConfig): string {
  const host = config.bind_address === '0.0.0.0' ? detectLocalP2PHost() : config.bind_address
  const proto = config.tls_enabled ? 'https' : 'http'
  return `${proto}://${host}:${config.port}/beap/ingest`
}

export function upsertP2PConfig(db: any, config: Partial<P2PConfig>): void {
  if (!db) return
  const existing = getP2PConfig(db)
  const merged = { ...DEFAULT_P2P_CONFIG, ...existing, ...config }
  db.prepare(
    `INSERT INTO p2p_config (id, enabled, port, bind_address, tls_enabled, tls_cert_path, tls_key_path, local_p2p_endpoint,
      relay_mode, relay_url, relay_pull_url, relay_auth_secret, remote_relay_host, remote_relay_mtls_cert, remote_relay_mtls_key, relay_cert_fingerprint,
      coordination_url, coordination_ws_url, coordination_enabled)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       port = excluded.port,
       bind_address = excluded.bind_address,
       tls_enabled = excluded.tls_enabled,
       tls_cert_path = excluded.tls_cert_path,
       tls_key_path = excluded.tls_key_path,
       local_p2p_endpoint = excluded.local_p2p_endpoint,
       relay_mode = excluded.relay_mode,
       relay_url = excluded.relay_url,
       relay_pull_url = excluded.relay_pull_url,
       relay_auth_secret = excluded.relay_auth_secret,
       remote_relay_host = excluded.remote_relay_host,
       remote_relay_mtls_cert = excluded.remote_relay_mtls_cert,
       remote_relay_mtls_key = excluded.remote_relay_mtls_key,
       relay_cert_fingerprint = excluded.relay_cert_fingerprint,
       coordination_url = excluded.coordination_url,
       coordination_ws_url = excluded.coordination_ws_url,
       coordination_enabled = excluded.coordination_enabled`,
  ).run(
    merged.enabled ? 1 : 0,
    merged.port,
    merged.bind_address,
    merged.tls_enabled ? 1 : 0,
    merged.tls_cert_path,
    merged.tls_key_path,
    merged.local_p2p_endpoint,
    merged.relay_mode,
    merged.relay_url,
    merged.relay_pull_url,
    merged.relay_auth_secret,
    merged.remote_relay_host,
    merged.remote_relay_mtls_cert,
    merged.remote_relay_mtls_key,
    merged.relay_cert_fingerprint ?? null,
    merged.coordination_url,
    merged.coordination_ws_url,
    merged.coordination_enabled ? 1 : 0,
  )
}
