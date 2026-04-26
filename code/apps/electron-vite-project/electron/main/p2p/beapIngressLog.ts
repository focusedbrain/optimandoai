/**
 * Correlation id for direct BEAP HTTP (Sandbox → Host P2P server): read from `X-Correlation-Id` and log
 * before auth/body work so rate-limit and auth rejections stay greppable across processes.
 */

import { randomUUID } from 'crypto'
import type http from 'http'

export const BEAP_CORRELATION_HEADER = 'x-correlation-id'

/** Outbound BEAP HTTP requests should set this header (capitalization as sent on the wire). */
export const BEAP_CORRELATION_HEADER_OUT = 'X-Correlation-Id'

export function newOutboundBeapCorrelationId(): string {
  return randomUUID()
}

export function readBeapCorrelationIdFromIncoming(req: http.IncomingMessage): string {
  const v = req.headers[BEAP_CORRELATION_HEADER]
  const s = Array.isArray(v) ? v[0] : v
  if (typeof s === 'string') {
    const t = s.trim()
    if (t) return t.slice(0, 128)
  }
  return ''
}

export function readBeapHandshakeHintFromIncoming(req: http.IncomingMessage): string {
  const h = req.headers['x-beap-handshake']
  const s = Array.isArray(h) ? h[0] : h
  if (typeof s === 'string') {
    const t = s.trim()
    if (t) return t.slice(0, 200)
  }
  return 'unknown'
}

export function logBeapIngressReceived(args: { ip: string; corr: string; handshakeHint: string }): void {
  const c = args.corr || 'none'
  const h = args.handshakeHint || 'unknown'
  console.log(`[BEAP_INGRESS] received corr=${c} handshake_hint=${h} ip=${args.ip}`)
}

export function logP2pBeapRejection(args: {
  ip: string
  status: number
  reason: string
  handshakeId?: string | null
  correlationId?: string | null
}): void {
  const ts = new Date().toISOString()
  const corr = args.correlationId?.trim() || 'none'
  const hid = args.handshakeId?.trim() || 'unknown'
  console.warn(
    `[P2P] Rejection corr=${corr} reason=${args.reason} handshake_id=${hid} ip=${args.ip} status=${args.status} timestamp=${ts}`,
  )
}
