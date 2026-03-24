import type { SecurityMode } from '../types'

function normKey(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.toLowerCase().trim().replace(/\s+/g, '')
}

/**
 * Whether node-imap should use implicit TLS (`tls: true` on connect).
 * Canonical: `ssl`. Also accepts common aliases so refactors / hand-edited JSON do not silently set tls=false on 993.
 */
export function imapUsesImplicitTls(security: unknown): boolean {
  const k = normKey(security)
  return k === 'ssl' || k === 'tls' || k === 'ssl/tls' || k === 'imaps'
}

/** Nodemailer: implicit TLS (465) vs STARTTLS (587). */
export function smtpTransportTlsFlags(security: unknown): { secure: boolean; requireTLS: boolean } {
  const k = normKey(security)
  if (k === 'ssl' || k === 'tls' || k === 'ssl/tls' || k === 'smtps') {
    return { secure: true, requireTLS: false }
  }
  if (k === 'starttls') {
    return { secure: false, requireTLS: true }
  }
  return { secure: false, requireTLS: false }
}

/**
 * Coerce persisted / HTTP / legacy strings to canonical {@link SecurityMode} before saving or probing.
 */
export function normalizeSecurityMode(value: unknown, fallback: SecurityMode): SecurityMode {
  const k = normKey(value)
  if (k === 'ssl' || k === 'tls' || k === 'ssl/tls' || k === 'imaps' || k === 'smtps') return 'ssl'
  if (k === 'starttls') return 'starttls'
  if (k === 'none' || k === 'plain' || k === 'cleartext') return 'none'
  return fallback
}
