/**
 * P2P Ingestion Server — Separate HTTP server for external capsule delivery.
 *
 * Exposes POST /beap/ingest, GET /beap/p2p-reachability (no-body direct P2P reachability),
 * and GET /beap/internal-inference-policy (Host policy for Sandbox direct P2P inference).
 * Binds to 0.0.0.0 on configurable port. Auth via handshake-bound Bearer token. Rate limited.
 */

import http from 'http'
import https from 'https'
import { readFileSync } from 'fs'
import { getHandshakeRecord, insertPendingP2PBeap } from '../handshake/db'
import { handleIngestionRPC } from '../ingestion/ipc'
import { processIncomingInput } from '../ingestion/ingestionPipeline'
import { insertIngestionAuditRecord, insertQuarantineRecord } from '../ingestion/persistenceDb'
import { migrateHandshakeTables } from '../handshake/db'
import { canonicalRebuild } from '../handshake/canonicalRebuild'
import { processHandshakeCapsule } from '../handshake/enforcement'
import { maybeEnqueueInitialContextSyncAfterInboundAccept } from '../handshake/contextSyncEnqueue'
import { buildDefaultReceiverPolicy } from '../handshake/types'
import type { SSOSession } from '../handshake/types'
import {
  computeLocalP2PEndpoint,
  detectLocalP2PHost,
  isBindAddressLocalhostOnly,
  isP2pPublishedHostLoopback,
  listLanIPv4Candidates,
  p2pIngestUrlHostname,
  type P2PConfig,
} from './p2pConfig'
import { notifyBeapRecipientPending } from './beapRecipientNotify'
import {
  checkIpLimit,
  checkHandshakeLimit,
  checkAuthFailLimit,
  recordAuthFailure,
} from './rateLimiter'
import { INGESTION_CONSTANTS } from '../ingestion/types'
import {
  setP2PHealthServerStarted,
  setP2PHealthServerFailed,
  formatP2PErrorForUser,
} from './p2pHealth'
import { handleGetInternalInferencePolicy } from '../internalInference/p2pHostPolicyGet'
import { handleGetP2PReachability } from '../internalInference/p2pReachabilityGet'
import { isInternalServiceRpcShape, tryHandleInternalServiceP2P } from '../internalInference/p2pServiceDispatch'

const MAX_BODY_BYTES = INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES
const IP_LIMIT = 30
const HANDSHAKE_LIMIT = 5

const migratedDbs = new WeakSet<object>()

function ensureHandshakeMigration(db: any): void {
  if (!db || migratedDbs.has(db)) return
  migratedDbs.add(db)
  try {
    migrateHandshakeTables(db)
  } catch (err: any) {
    console.warn('[P2P] Handshake migration warning:', err?.message)
  }
}

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress ?? '0.0.0.0'
}

function parseHandshakeIdMinimal(body: string): string | null {
  const parsed = JSON.parse(body) as Record<string, unknown>
  const id = parsed?.handshake_id
  return typeof id === 'string' ? id : null
}

/**
 * Detect BEAP message package (qBEAP/pBEAP) vs handshake capsule.
 * Handshake capsules have capsule_type. BEAP message packages have header + metadata, no capsule_type.
 */
function isBeapMessagePackage(body: unknown): boolean {
  return (
    body != null &&
    typeof body === 'object' &&
    'header' in (body as object) &&
    'metadata' in (body as object) &&
    !('capsule_type' in (body as object))
  )
}

function getHandshakeIdForBeapMessage(
  parsed: Record<string, unknown>,
  headers: http.IncomingHttpHeaders
): string | null {
  const h = headers['x-beap-handshake']
  if (typeof h === 'string' && h.trim().length > 0) return h.trim()
  const header = parsed?.header
  if (header && typeof header === 'object') {
    const rb = (header as Record<string, unknown>)?.receiver_binding
    if (rb && typeof rb === 'object' && 'handshake_id' in rb) {
      const id = (rb as Record<string, unknown>).handshake_id
      if (typeof id === 'string' && id.trim().length > 0) return id.trim()
    }
  }
  return null
}

const STATUS_ERROR_MESSAGES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  404: 'Not found',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Capsule rejected',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
}

function sendGenericError(
  res: http.ServerResponse,
  status: number,
  ip: string,
  reason: string,
  handshakeId?: string | null,
): void {
  const ts = new Date().toISOString()
  console.warn('[P2P] Rejection', { ip, status, reason, handshake_id: handshakeId ?? 'unknown', timestamp: ts })
  const errorMsg = STATUS_ERROR_MESSAGES[status] ?? 'Request rejected'
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: errorMsg }))
}

function createP2PRequestHandler(
  getDb: () => any,
  getSsoSession: () => SSOSession | undefined,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
    const pathOnly = (req.url ?? '').split('?')[0] ?? ''
    if (req.method === 'GET' && pathOnly === '/beap/p2p-reachability') {
      await handleGetP2PReachability(req, res, getDb)
      return
    }
    if (req.method === 'GET' && pathOnly === '/beap/internal-inference-policy') {
      await handleGetInternalInferencePolicy(req, res, getDb)
      return
    }

    if (req.method !== 'POST' || pathOnly !== '/beap/ingest') {
      const ip = getClientIp(req)
      sendGenericError(res, 404, ip, 'not_found')
      return
    }

    const ip = getClientIp(req)

    // Auth failure rate limit (aggressive)
    if (!checkAuthFailLimit(ip)) {
      sendGenericError(res, 429, ip, 'auth_rate_limit')
      return
    }

    // Per-IP rate limit
    if (!checkIpLimit(ip, IP_LIMIT)) {
      sendGenericError(res, 429, ip, 'ip_rate_limit')
      return
    }

    // Content-Type check
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.includes('application/json') && !contentType.includes('application/vnd.beap+json')) {
      sendGenericError(res, 415, ip, 'content_type')
      return
    }

    const chunks: Buffer[] = []
    let totalSize = 0
    for await (const chunk of req) {
      totalSize += chunk.length
      if (totalSize > MAX_BODY_BYTES) {
        sendGenericError(res, 413, ip, 'body_too_large')
        return
      }
      chunks.push(chunk as Buffer)
    }
    const body = Buffer.concat(chunks).toString('utf8')

    // Valid JSON
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      sendGenericError(res, 400, ip, 'invalid_json')
      return
    }

    let handshakeId: string | null = parseHandshakeIdMinimal(body)
    if (!handshakeId && isBeapMessagePackage(parsed)) {
      handshakeId = getHandshakeIdForBeapMessage(parsed, req.headers)
    }
    if (!handshakeId || typeof handshakeId !== 'string' || handshakeId.trim().length === 0) {
      sendGenericError(res, 400, ip, 'missing_handshake_id')
      return
    }

    // Per-handshake rate limit
    if (!checkHandshakeLimit(handshakeId, HANDSHAKE_LIMIT)) {
      sendGenericError(res, 429, ip, 'handshake_rate_limit', handshakeId)
      return
    }

    // Auth: Bearer token
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null

    const db = getDb()
    if (!db) {
      sendGenericError(res, 503, ip, 'vault_locked', handshakeId)
      return
    }

    const record = getHandshakeRecord(db, handshakeId)
    const expectedToken = record?.counterparty_p2p_token ?? null
    if (!expectedToken || token !== expectedToken) {
      recordAuthFailure(ip)
      console.warn('[P2P] P2P_AUTH_FAILURE', { ip, handshake_id: handshakeId, timestamp: new Date().toISOString() })
      sendGenericError(res, 401, ip, 'auth_failure', handshakeId)
      return
    }

    // Direct P2P internal service RPC (inference skeleton — not user inbox, not Ollama)
    if (isInternalServiceRpcShape(parsed)) {
      if (parsed.type === 'internal_inference_capabilities_request' && typeof parsed.handshake_id === 'string') {
        const capsHid = (parsed.handshake_id as string).trim()
        console.log(
          `[P2P-SERVER] ingest_received type=internal_inference_capabilities_request handshake=${capsHid || 'unknown'}`,
        )
      }
      const handled = await tryHandleInternalServiceP2P(db, parsed, res)
      if (handled) {
        return
      }
    }

    // BEAP message package (qBEAP/pBEAP): store in p2p_pending_beap for extension ingestion
    if (isBeapMessagePackage(parsed)) {
      ensureHandshakeMigration(db)
      insertPendingP2PBeap(db, handshakeId, body)
      console.log('[P2P-RECV] BEAP message inserted into pending table (local P2P HTTP)', handshakeId)
      notifyBeapRecipientPending(handshakeId)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ accepted: true }))
      return
    }

    // Feed to ingestion pipeline (handshake capsules)
    const rawInput = {
      body,
      mime_type: 'application/vnd.beap+json' as const,
      headers: { 'content-type': contentType },
    }

    try {
      const result = await processIncomingInput(rawInput, 'p2p', {
        channel_id: 'p2p',
        mime_type: 'application/vnd.beap+json',
      })

      try {
        insertIngestionAuditRecord(db, result.audit)
      } catch { /* non-fatal */ }

      if (!result.success) {
        try {
          insertQuarantineRecord(db, {
            raw_input_hash: result.audit.raw_input_hash,
            source_type: result.audit.source_type,
            origin_classification: result.audit.origin_classification,
            input_classification: result.audit.input_classification,
            validation_reason_code: result.validation_reason_code ?? 'INTERNAL_VALIDATION_ERROR',
            validation_details: result.reason,
            provenance_json: JSON.stringify(result.audit),
          })
        } catch { /* dedup */ }
        res.writeHead(422, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Capsule rejected' }))
        return
      }

      const { distribution } = result

      if (distribution.target === 'handshake_pipeline') {
        const ssoSession = getSsoSession()
        if (ssoSession) {
          ensureHandshakeMigration(db)
          try {
            const rebuildResult = canonicalRebuild(distribution.validated_capsule.capsule)
            if (!rebuildResult.ok) {
              res.writeHead(422, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Capsule rejected' }))
              return
            }
            const canonicalValidated = {
              ...distribution.validated_capsule,
              capsule: rebuildResult.capsule as any,
            }
            const receiverPolicy = buildDefaultReceiverPolicy()
            const handshakeResult = processHandshakeCapsule(
              db,
              canonicalValidated,
              receiverPolicy,
              ssoSession,
            )
            if (!handshakeResult.success) {
              res.writeHead(422, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Capsule rejected' }))
              return
            }
            {
              const cap = rebuildResult.capsule as { capsule_type?: unknown; capsule_hash?: unknown }
              maybeEnqueueInitialContextSyncAfterInboundAccept(db, ssoSession, {
                handshakeResult,
                wireCapsuleType: cap?.capsule_type,
                acceptCapsuleHash: typeof cap?.capsule_hash === 'string' ? cap.capsule_hash : '',
                ingress_path: 'p2p_http',
              })
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: true }))
            return
          } catch (err: any) {
            console.error('[P2P] Handshake processing error:', err?.message)
            res.writeHead(422, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Capsule rejected' }))
            return
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true }))
    } catch (err: any) {
      console.error('[P2P] Ingestion error:', err?.message)
      sendGenericError(res, 500, ip, 'internal_error', handshakeId)
    }
    })()
  }
}

/**
 * P2P server disabled: STEP 3 diagnostics (no listen).
 */
export function logP2pServerDisabledState(config: P2PConfig): void {
  console.log(`[P2P-SERVER] startup enabled=false`)
  console.log(`[P2P-SERVER] bind_address=${config.bind_address}`)
  console.log(`[P2P-SERVER] port=${config.port}`)
  console.log(`[P2P-SERVER] listen_state=not_started`)
  const cands = listLanIPv4Candidates()
  console.log(`[P2P-SERVER] lan_ip_candidates=${JSON.stringify(cands)}`)
  if (cands.length === 0) {
    console.warn('[P2P-SERVER] warning_no_lan_ip')
  }
  if (isBindAddressLocalhostOnly(config.bind_address)) {
    console.warn('[P2P-SERVER] warning_localhost_endpoint')
    console.warn('[P2P-SERVER] classification=F HOST_P2P_SERVER_BOUND_LOCAL_ONLY')
  }
  if (process.platform === 'win32') {
    console.log(`[P2P-SERVER] windows_firewall=manual_verify_inbound_tcp port=${config.port} (server not running)`)
  } else {
    console.log(`[P2P-SERVER] windows_firewall=not_applicable platform=${process.platform}`)
  }
}

/**
 * On successful listen: STEP 3 Host publication and LAN / firewall hints.
 * Counterparty `p2p_endpoint` in handshakes is derived from the URL published here (`local_p2p_endpoint` in `p2p_config` on listen)
 * and from ledger/context exchange — see `onReady` in main.
 */
function logP2pServerListenDiagnostics(config: P2PConfig, publishedEndpoint: string, _proto: string): void {
  console.log(`[P2P-SERVER] startup enabled=true`)
  console.log(`[P2P-SERVER] listen_state=listening`)
  console.log(`[P2P-SERVER] bind_address=${config.bind_address}`)
  console.log(`[P2P-SERVER] port=${config.port}`)
  console.log(`[P2P-SERVER] published_endpoint=${publishedEndpoint}`)
  const cands = listLanIPv4Candidates()
  const primary = detectLocalP2PHost()
  console.log(`[P2P-SERVER] lan_ip_candidates=${JSON.stringify(cands)}`)
  const ph = p2pIngestUrlHostname(publishedEndpoint)
  const boundLocal = isBindAddressLocalhostOnly(config.bind_address)
  const publishedLoop = isP2pPublishedHostLoopback(ph)
  if (cands.length === 0) {
    console.warn('[P2P-SERVER] warning_no_lan_ip')
  }
  if (boundLocal || publishedLoop) {
    console.warn('[P2P-SERVER] warning_localhost_endpoint')
    console.warn('[P2P-SERVER] classification=F HOST_P2P_SERVER_BOUND_LOCAL_ONLY')
  }
  let hostVs: string
  if (boundLocal || publishedLoop) {
    hostVs = 'not_lan (localhost_bind_or_published_host)'
  } else if (ph == null) {
    hostVs = 'mismatch (unparseable_url)'
  } else if (cands.length === 0) {
    hostVs = primary === '127.0.0.1' && ph === '127.0.0.1' ? 'match (fallback_to_loopback_no_lan_nic)' : 'mismatch (no_lan_nic)'
  } else if (cands.includes(ph) || ph === primary) {
    hostVs = 'match'
  } else {
    hostVs = 'mismatch'
  }
  console.log(`[P2P-SERVER] published_host_vs_lan_ip=${hostVs}`)
  if (process.platform === 'win32') {
    console.log(
      `[P2P-SERVER] windows_firewall=manual_verify_inbound_tcp port=${config.port} (app cannot read Defender rules; allow TCP inbound if the Sandbox cannot connect)`,
    )
  } else {
    console.log(`[P2P-SERVER] windows_firewall=not_applicable platform=${process.platform}`)
  }
}

export function createP2PServer(
  config: P2PConfig,
  getDb: () => any,
  getSsoSession: () => SSOSession | undefined,
  onReady?: (localEndpoint: string) => void,
  onListenError?: () => void,
): http.Server | https.Server | null {
  if (!config.enabled) {
    return null
  }

  const requestHandler = createP2PRequestHandler(getDb, getSsoSession)

  function onListenSuccess(proto: string): void {
    const localEndpoint = computeLocalP2PEndpoint(config)
    logP2pServerListenDiagnostics(config, localEndpoint, proto)
    setP2PHealthServerStarted(config.port, localEndpoint, !!config.tls_enabled)
    console.log(`[P2P] ✅ ${proto} server listening on ${localEndpoint}`)
    onReady?.(localEndpoint)
  }

  function makeOnError(srv: http.Server | https.Server): (err: any) => void {
    return (err: any) => {
      const msg = formatP2PErrorForUser(err?.message ?? String(err), undefined, config.port)
      setP2PHealthServerFailed(msg)
      console.warn('[P2P] Server error:', err?.message)
      try {
        srv.close()
      } catch {}
      onListenError?.()
    }
  }

  if (config.tls_enabled && config.tls_cert_path && config.tls_key_path) {
    try {
      const options = {
        cert: readFileSync(config.tls_cert_path),
        key: readFileSync(config.tls_key_path),
      }
      const server = https.createServer(options, requestHandler)
      const onErr = makeOnError(server)
      server.once('error', onErr)
      server.listen(config.port, config.bind_address, () => {
        server.removeListener('error', onErr)
        onListenSuccess('HTTPS')
      })
      return server
    } catch (err: any) {
      const msg = formatP2PErrorForUser(err?.message ?? String(err), undefined, config.port)
      setP2PHealthServerFailed(msg)
      console.error('[P2P] TLS setup failed:', err?.message)
      return null
    }
  }

  if (!config.tls_enabled) {
    console.warn('[P2P] P2P server running without TLS — not recommended for production')
  }

  const server = http.createServer(requestHandler)
  const onErr = makeOnError(server)
  server.once('error', onErr)
  server.listen(config.port, config.bind_address, () => {
    server.removeListener('error', onErr)
    onListenSuccess('HTTP')
  })
  return server
}
