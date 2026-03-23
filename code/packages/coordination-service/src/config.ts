/**
 * Coordination Service — Configuration
 * Load from environment variables.
 */

export interface CoordinationConfig {
  port: number
  host: string
  tls_cert_path: string | null
  tls_key_path: string | null
  oidc_issuer: string
  oidc_jwks_url: string
  oidc_audience: string | null
  db_path: string
  capsule_retention_days: number
  ws_heartbeat_interval: number
  max_connections: number
  /** Session TTL in seconds — handshakes older than this are purged. */
  session_ttl_seconds: number
  /** Handshake registry TTL in seconds — stale handshake entries cleaned after this. */
  handshake_ttl_seconds: number
}

export function loadConfig(): CoordinationConfig {
  const port = parseInt(process.env.COORD_PORT ?? '51249', 10)
  const host = process.env.COORD_HOST ?? '0.0.0.0'
  const oidcIssuer = process.env.COORD_OIDC_ISSUER ?? 'https://auth.wrdesk.com/realms/wrdesk'
  const oidcJwksUrl = process.env.COORD_OIDC_JWKS_URL ?? `${oidcIssuer}/protocol/openid-connect/certs`
  const oidcAudience = process.env.COORD_OIDC_AUDIENCE?.trim() || null
  const dbPath = process.env.COORD_DB_PATH ?? './data/coordination.db'
  const retention = parseInt(process.env.COORD_CAPSULE_RETENTION_DAYS ?? '7', 10)
  const heartbeat = parseInt(process.env.COORD_WS_HEARTBEAT_INTERVAL ?? '30000', 10)
  const maxConn = parseInt(process.env.COORD_MAX_CONNECTIONS ?? '10000', 10)
  const sessionTtl = parseInt(process.env.COORD_SESSION_TTL_SECONDS ?? '86400', 10) // 24h default
  const handshakeTtl = parseInt(process.env.COORD_HANDSHAKE_TTL_SECONDS ?? '604800', 10) // 7d default

  return {
    port,
    host,
    tls_cert_path: process.env.COORD_TLS_CERT_PATH ?? null,
    tls_key_path: process.env.COORD_TLS_KEY_PATH ?? null,
    oidc_issuer: oidcIssuer,
    oidc_jwks_url: oidcJwksUrl,
    oidc_audience: oidcAudience,
    db_path: dbPath,
    capsule_retention_days: retention,
    ws_heartbeat_interval: heartbeat,
    max_connections: maxConn,
    session_ttl_seconds: sessionTtl,
    handshake_ttl_seconds: handshakeTtl,
  }
}
