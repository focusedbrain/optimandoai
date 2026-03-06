/**
 * P2P Server Configuration
 *
 * Stored in p2p_config table (single row). Migrated with handshake DB.
 */

import { networkInterfaces } from 'os'

export interface P2PConfig {
  enabled: boolean
  port: number
  bind_address: string
  tls_enabled: boolean
  tls_cert_path: string | null
  tls_key_path: string | null
  local_p2p_endpoint: string | null
}

/** Default config: P2P enabled out of the box. */
export const DEFAULT_P2P_CONFIG: P2PConfig = {
  enabled: true,
  port: 51249,
  bind_address: '0.0.0.0',
  tls_enabled: false,
  tls_cert_path: null,
  tls_key_path: null,
  local_p2p_endpoint: null,
}

export function getP2PConfig(db: any): P2PConfig {
  const fallback = { ...DEFAULT_P2P_CONFIG }
  if (!db) return fallback
  try {
    const row = db.prepare('SELECT * FROM p2p_config LIMIT 1').get() as any
    if (!row) return fallback
    return {
      enabled: !!row.enabled,
      port: row.port ?? DEFAULT_P2P_CONFIG.port,
      bind_address: row.bind_address ?? DEFAULT_P2P_CONFIG.bind_address,
      tls_enabled: !!row.tls_enabled,
      tls_cert_path: row.tls_cert_path ?? null,
      tls_key_path: row.tls_key_path ?? null,
      local_p2p_endpoint: row.local_p2p_endpoint ?? null,
    }
  } catch {
    return fallback
  }
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
    `INSERT INTO p2p_config (id, enabled, port, bind_address, tls_enabled, tls_cert_path, tls_key_path, local_p2p_endpoint)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       port = excluded.port,
       bind_address = excluded.bind_address,
       tls_enabled = excluded.tls_enabled,
       tls_cert_path = excluded.tls_cert_path,
       tls_key_path = excluded.tls_key_path,
       local_p2p_endpoint = excluded.local_p2p_endpoint`,
  ).run(
    merged.enabled ? 1 : 0,
    merged.port,
    merged.bind_address,
    merged.tls_enabled ? 1 : 0,
    merged.tls_cert_path,
    merged.tls_key_path,
    merged.local_p2p_endpoint,
  )
}
