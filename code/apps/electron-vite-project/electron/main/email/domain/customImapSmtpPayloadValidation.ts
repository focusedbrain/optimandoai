/**
 * Custom IMAP+SMTP connect payload validation (shared with {@link ../gateway EmailGateway.connectCustomImapSmtpAccount}).
 * Kept in `domain/` so Vitest can cover rules without loading Electron `app` / full gateway.
 */

import type { CustomImapSmtpConnectPayload } from '../types'

function assertPort(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${label} port must be a whole number between 1 and 65535.`)
  }
}

function assertOptionalImapLifecycleMailbox(v: string | undefined, fieldLabel: string): void {
  if (v === undefined || v === null) return
  const t = String(v).trim()
  if (!t) return
  if (t.length > 200) {
    throw new Error(`${fieldLabel} must be at most 200 characters.`)
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) {
    throw new Error(`${fieldLabel} contains invalid control characters.`)
  }
}

/** Throws with user-facing messages; used before probing IMAP/SMTP. */
export function validateCustomImapSmtpPayload(p: CustomImapSmtpConnectPayload): void {
  const email = p.email?.trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.')
  }
  const imapHost = p.imapHost?.trim()
  if (!imapHost || imapHost.length > 253) {
    throw new Error('IMAP server host is required (for example imap.example.com).')
  }
  assertPort(p.imapPort, 'IMAP')
  const smtpHost = p.smtpHost?.trim()
  if (!smtpHost || smtpHost.length > 253) {
    throw new Error('SMTP server host is required (for example smtp.example.com).')
  }
  assertPort(p.smtpPort, 'SMTP')
  if (!p.imapPassword?.trim()) {
    throw new Error('IMAP password (or app password) is required.')
  }
  if (!p.smtpUseSameCredentials) {
    if (!p.smtpUsername?.trim()) {
      throw new Error('SMTP username is required when it is not the same as IMAP.')
    }
    if (!p.smtpPassword?.trim()) {
      throw new Error('SMTP password is required when it is not the same as IMAP.')
    }
  }
  assertOptionalImapLifecycleMailbox(p.imapLifecycleArchiveMailbox, 'Archive mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecyclePendingReviewMailbox, 'Pending review mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecyclePendingDeleteMailbox, 'Pending delete mailbox name')
  assertOptionalImapLifecycleMailbox(p.imapLifecycleTrashMailbox, 'Trash mailbox name')
  if (p.syncWindowDays != null) {
    const d = Number(p.syncWindowDays)
    if (!Number.isInteger(d) || d < 0) {
      throw new Error('Sync window must be 0 (all mail) or a positive number of days.')
    }
  }
}
