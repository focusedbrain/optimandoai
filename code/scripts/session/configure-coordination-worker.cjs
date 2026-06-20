#!/usr/bin/env node
/**
 * Electron-node worker: patch p2p_config in the SQLCipher handshake ledger.
 * Invoked only by scripts/session/lib.cjs (test-infra).
 */
const crypto = require('node:crypto')
const path = require('path')

const ISS = 'https://auth.wrdesk.com/realms/wrdesk'

function buildLedgerSessionToken(wrdeskUserId, iss) {
  return crypto.createHash('sha256').update(`${wrdeskUserId}:${iss}:beap-ledger`).digest('hex')
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('invalid_jwt')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

async function loadIdentity() {
  const keytar = require('keytar')
  const refreshToken = await keytar.getPassword('wrdesk-orchestrator', 'refresh_token')
  if (!refreshToken) throw new Error('no_refresh_token')
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: 'wrdesk-orchestrator',
    refresh_token: refreshToken,
  })
  const res = await fetch(`${ISS}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`refresh_failed_${res.status}`)
  const tokens = await res.json()
  const payload = decodeJwtPayload(tokens.access_token)
  const wrdeskUserId = payload.wrdesk_user_id || payload.wrdesk_uid || payload.sub
  const iss = payload.iss || ISS
  if (!wrdeskUserId || !iss) throw new Error('jwt_missing_identity')
  return buildLedgerSessionToken(wrdeskUserId, iss)
}

function openLedger(dbPath, ledgerToken) {
  const Database = require('better-sqlite3')
  const db = new Database(dbPath)
  db.pragma(`key = "x'${ledgerToken}'"`)
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 64000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  db.prepare('SELECT count(*) AS n FROM sqlite_master').get()
  return db
}

function upsertCoordination(db, coordinationUrl, coordinationWsUrl) {
  const row = db.prepare('SELECT id FROM p2p_config WHERE id = 1').get()
  if (!row) {
    db.prepare(
      `INSERT INTO p2p_config (
        id, enabled, port, bind_address, tls_enabled, relay_mode,
        coordination_url, coordination_ws_url, coordination_enabled
      ) VALUES (1, 0, 0, '0.0.0.0', 0, 'local', ?, ?, 1)`,
    ).run(coordinationUrl, coordinationWsUrl)
    return
  }
  db.prepare(
    `UPDATE p2p_config SET
      relay_mode = 'local',
      coordination_url = ?,
      coordination_ws_url = ?,
      coordination_enabled = 1,
      enabled = 0,
      port = 0,
      local_p2p_endpoint = NULL
     WHERE id = 1`,
  ).run(coordinationUrl, coordinationWsUrl)
}

async function main() {
  const dbPath = process.argv[2]
  const coordinationUrl = process.argv[3]
  const coordinationWsUrl = process.argv[4]
  if (!dbPath || !coordinationUrl || !coordinationWsUrl) {
    console.error('usage: configure-coordination-worker.cjs <db> <coord_url> <ws_url>')
    process.exit(2)
  }
  const ledgerToken = await loadIdentity()
  const db = openLedger(path.resolve(dbPath), ledgerToken)
  try {
    upsertCoordination(db, coordinationUrl, coordinationWsUrl)
    process.stdout.write('ok')
  } finally {
    db.close()
  }
}

main().catch((err) => {
  console.error(err?.message || String(err))
  process.exit(1)
})
