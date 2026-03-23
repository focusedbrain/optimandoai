/**
 * Relay server configuration.
 * Load from env vars or relay-config.json.
 */

export interface RelayConfig {
  port: number
  bind_address: string
  tls_enabled: boolean
  tls_cert_path?: string
  tls_key_path?: string
  relay_auth_secret: string
  db_path: string
  max_capsule_age_days: number
  max_body_size: number
}

const DEFAULT_PORT = 51249
const DEFAULT_BIND = '0.0.0.0'
const DEFAULT_DB_PATH = './relay.db'
const DEFAULT_MAX_AGE_DAYS = 7
const DEFAULT_MAX_BODY = 15 * 1024 * 1024 // 15MB

function loadFromEnv(): Partial<RelayConfig> {
  const port = process.env.RELAY_PORT
  const bind = process.env.RELAY_BIND_ADDRESS
  const tls = process.env.RELAY_TLS_ENABLED
  const tlsCert = process.env.RELAY_TLS_CERT_PATH
  const tlsKey = process.env.RELAY_TLS_KEY_PATH
  const secret = process.env.RELAY_AUTH_SECRET
  const dbPath = process.env.RELAY_DB_PATH
  const maxAge = process.env.RELAY_MAX_CAPSULE_AGE_DAYS
  const maxBody = process.env.RELAY_MAX_BODY_SIZE

  return {
    ...(port ? { port: parseInt(port, 10) } : {}),
    ...(bind ? { bind_address: bind } : {}),
    ...(tls === 'true' || tls === '1' ? { tls_enabled: true } : {}),
    ...(tlsCert ? { tls_cert_path: tlsCert } : {}),
    ...(tlsKey ? { tls_key_path: tlsKey } : {}),
    ...(secret ? { relay_auth_secret: secret } : {}),
    ...(dbPath ? { db_path: dbPath } : {}),
    ...(maxAge ? { max_capsule_age_days: parseInt(maxAge, 10) } : {}),
    ...(maxBody ? { max_body_size: parseInt(maxBody, 10) } : {}),
  }
}

async function loadFromFile(): Promise<Partial<RelayConfig>> {
  try {
    const fs = await import('fs')
    const path = await import('path')
    const configPath = process.env.RELAY_CONFIG_PATH ?? path.join(process.cwd(), 'relay-config.json')
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8')
      return JSON.parse(raw) as Partial<RelayConfig>
    }
  } catch {
    /* ignore */
  }
  return {}
}

export async function loadRelayConfig(): Promise<RelayConfig> {
  const fromFile = await loadFromFile()
  const fromEnv = loadFromEnv()
  return {
    port: fromEnv.port ?? fromFile.port ?? DEFAULT_PORT,
    bind_address: fromEnv.bind_address ?? fromFile.bind_address ?? DEFAULT_BIND,
    tls_enabled: fromEnv.tls_enabled ?? fromFile.tls_enabled ?? false,
    tls_cert_path: fromEnv.tls_cert_path ?? fromFile.tls_cert_path,
    tls_key_path: fromEnv.tls_key_path ?? fromFile.tls_key_path,
    relay_auth_secret: fromEnv.relay_auth_secret ?? fromFile.relay_auth_secret ?? '',
    db_path: fromEnv.db_path ?? fromFile.db_path ?? DEFAULT_DB_PATH,
    max_capsule_age_days: fromEnv.max_capsule_age_days ?? fromFile.max_capsule_age_days ?? DEFAULT_MAX_AGE_DAYS,
    max_body_size: fromEnv.max_body_size ?? fromFile.max_body_size ?? DEFAULT_MAX_BODY,
  }
}
