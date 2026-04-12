/**
 * NDJSON audit log for JWT-authenticated inference HTTP endpoints (host-facing).
 * Does not log message bodies, tokens, or other sensitive payloads.
 */

import fs from 'fs'
import path from 'path'
import type { NextFunction, Request, Response } from 'express'
import { app } from 'electron'

const LOG_FILE = 'orchestrator-inference-audit.log'
const MAX_BYTES = 10 * 1024 * 1024

export interface InferenceAuditEntry {
  timestamp: string
  action: 'chat' | 'status' | 'rejected'
  subject: string
  sourceIp: string
  modelId?: string
  messageCount?: number
  result: 'success' | 'error' | 'rate_limited' | 'auth_failed'
  durationMs?: number
  error?: string
}

declare global {
  namespace Express {
    interface Locals {
      inferenceAuditMeta?: {
        modelId?: string
        messageCount?: number
      }
      /** Set when POST /api/inference/chat returns 403 for non-host mode (policy, not JWT scope). */
      inferenceAuditNotHost?: boolean
    }
  }
}

function auditLogPath(): string {
  return path.join(app.getPath('userData'), LOG_FILE)
}

function rotateIfNeeded(): void {
  const p = auditLogPath()
  try {
    const st = fs.statSync(p)
    if (st.size < MAX_BYTES) return
    const backup = `${p}.1`
    try {
      if (fs.existsSync(backup)) fs.unlinkSync(backup)
    } catch {
      /* ignore */
    }
    fs.renameSync(p, backup)
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err?.code !== 'ENOENT') {
      console.warn('[inference-audit] rotation check failed:', e)
    }
  }
}

export function logInferenceAccess(entry: InferenceAuditEntry): void {
  try {
    rotateIfNeeded()
    fs.appendFileSync(auditLogPath(), `${JSON.stringify(entry)}\n`, { encoding: 'utf8' })
  } catch (e) {
    console.warn('[inference-audit] write failed:', e)
  }
}

function sourceIp(req: Request): string {
  return String(req.ip ?? req.socket?.remoteAddress ?? 'unknown')
}

function subjectFromReq(req: Request): string {
  const sub = req.user?.sub
  return typeof sub === 'string' && sub.length > 0 ? sub : '(unauthenticated)'
}

function mapChatResult(statusCode: number, req: Request, res: Response): {
  result: InferenceAuditEntry['result']
  error?: string
} {
  if (statusCode === 429) return { result: 'rate_limited', error: `http_${statusCode}` }
  if (statusCode === 401) return { result: 'auth_failed', error: `http_${statusCode}` }
  if (statusCode === 403) {
    if (!req.user) return { result: 'auth_failed', error: `http_${statusCode}` }
    if (res.locals.inferenceAuditNotHost === true) return { result: 'error', error: 'not_host' }
    return { result: 'auth_failed', error: `http_${statusCode}` }
  }
  if (statusCode >= 400) return { result: 'error', error: `http_${statusCode}` }
  return { result: 'success' }
}

/**
 * Attach once per POST /chat (call from router middleware so CORS failures are included).
 * Logs every completed response for the sandbox inference chat route.
 */
export function attachInferenceChatRouteAudit(req: Request, res: Response): void {
  const t0 = Date.now()
  const ip = sourceIp(req)
  let logged = false

  const write = () => {
    if (logged) return
    logged = true
    const sc = res.statusCode
    const { result, error } = mapChatResult(sc, req, res)
    const meta = res.locals.inferenceAuditMeta
    const action: InferenceAuditEntry['action'] =
      sc === 401 || (sc === 403 && !req.user) ? 'rejected' : 'chat'
    logInferenceAccess({
      timestamp: new Date().toISOString(),
      action,
      subject: subjectFromReq(req),
      sourceIp: ip,
      modelId: meta?.modelId,
      messageCount: meta?.messageCount,
      result,
      durationMs: Date.now() - t0,
      error: result === 'success' ? undefined : error,
    })
  }

  res.on('finish', write)
  res.on('close', write)
}

/**
 * Log only auth/JWKS failures for GET /api/orchestrator/inference-status (401, 403, 503).
 */
export function attachInferenceStatusAuthFailureAudit(req: Request, res: Response): void {
  const t0 = Date.now()
  const ip = sourceIp(req)
  let logged = false

  const write = () => {
    if (logged) return
    logged = true
    const sc = res.statusCode
    if (sc !== 401 && sc !== 403 && sc !== 503) return
    logInferenceAccess({
      timestamp: new Date().toISOString(),
      action: 'status',
      subject: subjectFromReq(req),
      sourceIp: ip,
      result: 'auth_failed',
      durationMs: Date.now() - t0,
      error: `http_${sc}`,
    })
  }

  res.on('finish', write)
  res.on('close', write)
}

export function inferenceStatusAuthAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  attachInferenceStatusAuthFailureAudit(req, res)
  next()
}
