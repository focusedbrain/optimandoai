import { describe, it, expect } from 'vitest'
import { classifySyncFailureMessage, parseBracketedAccountSyncMessage, isDelegatedSyncMessage, DELEGATED_SYNC_MARKER, buildTlsSyncFailureCopy, classifyIngestionTriggerSyncMessage } from './syncFailureUi'
import { TRIGGER_FAILED_HINT, TRIGGER_REJECTED_HINT, TRIGGER_READ_CONSENT_MISSING_HINT, TRIGGER_FETCH_FAILED_HINT } from '../../electron/main/email/ipcSyncResultShape'
import { DELEGATED_HINT } from '../../electron/main/email/ipcSyncResultShape'

describe('parseBracketedAccountSyncMessage', () => {
  it('parses account id and message', () => {
    expect(parseBracketedAccountSyncMessage('[abc] hello world')).toEqual({
      accountId: 'abc',
      message: 'hello world',
    })
  })
})

describe('classifySyncFailureMessage', () => {
  it('classifies German IMAP auth strings as auth', () => {
    expect(classifySyncFailureMessage('Anmeldung fehlgeschlagen')).toBe('auth')
    expect(classifySyncFailureMessage('Ungültige Anmeldedaten')).toBe('auth')
  })

  it('classifies outer sync timeout', () => {
    expect(classifySyncFailureMessage('syncAccountEmails timed out after 300s')).toBe('timeout')
  })

  it('classifies orchestrator list timeout with phase/folder hints (IMAP instrumentation)', () => {
    expect(
      classifySyncFailureMessage(
        'listMessages timed out after 45s (phase=list_messages folder="INBOX")',
      ),
    ).toBe('timeout')
    expect(
      classifySyncFailureMessage(
        'syncAccountEmails timed out after 300s inFlight={"phase":"list_messages","folder":"Spam"}',
      ),
    ).toBe('timeout')
  })

  it('classifies provider_fetchMessages and imapFetchReliable timeout messages', () => {
    expect(
      classifySyncFailureMessage(
        'IMAP fetch timed out after 45s (phase=provider_fetchMessages folder="INBOX")',
      ),
    ).toBe('timeout')
    expect(
      classifySyncFailureMessage(
        'IMAP fetch timed out after 45s (phase=imapFetchReliable folder="INBOX")',
      ),
    ).toBe('timeout')
  })

  it('prefers auth over tls when both keywords appear (rare)', () => {
    expect(classifySyncFailureMessage('authentication failed during tls handshake')).toBe('auth')
  })

  it('classifies TLS certificate errors', () => {
    expect(classifySyncFailureMessage('unable to verify the first certificate')).toBe('tls')
  })

  it('classifies network resets', () => {
    expect(classifySyncFailureMessage('socket hang up')).toBe('network')
  })

  it('classifies delegated ingestion skip as delegated, not generic', () => {
    expect(DELEGATED_HINT).toContain(DELEGATED_SYNC_MARKER)
    expect(isDelegatedSyncMessage(DELEGATED_HINT)).toBe(true)
    expect(classifySyncFailureMessage(DELEGATED_HINT)).toBe('delegated')
    expect(classifySyncFailureMessage('authentication failed')).toBe('auth')
  })
})

describe('buildTlsSyncFailureCopy', () => {
  it('uses configured IMAP host for web.de accounts', () => {
    const copy = buildTlsSyncFailureCopy({
      email: 'user@web.de',
      provider: 'imap',
      imapHost: 'imap.web.de',
      imapPort: 993,
      imapSecurity: 'ssl',
    })
    expect(copy.hint).toContain('imap.web.de')
    expect(copy.hint).toContain('993')
    expect(copy.hint).not.toMatch(/for web\.de use/i)
  })

  it('uses generic provider label for Gmail without IMAP host', () => {
    const copy = buildTlsSyncFailureCopy({
      email: 'user@gmail.com',
      provider: 'gmail',
    })
    expect(copy.lead).toContain('Gmail')
    expect(copy.hint).not.toContain('web.de')
    expect(copy.hint).not.toContain('imap.web.de')
  })

  it('falls back to generic copy when provider host is unknown', () => {
    const copy = buildTlsSyncFailureCopy({
      email: 'mystery@example.com',
      provider: 'imap',
    })
    expect(copy.lead).toContain('IMAP')
    expect(copy.hint).not.toContain('web.de')
  })
})

describe('classifyIngestionTriggerSyncMessage', () => {
  it('classifies transport unreachable as sandbox_unreachable', () => {
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_FAILED_HINT)).toBe('sandbox_unreachable')
    expect(classifySyncFailureMessage(TRIGGER_FAILED_HINT)).toBe('sandbox_unreachable')
  })

  it('classifies authentication rejection distinctly from unreachable', () => {
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_REJECTED_HINT)).toBe('sandbox_rejected')
    expect(classifySyncFailureMessage(TRIGGER_REJECTED_HINT)).toBe('sandbox_rejected')
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_REJECTED_HINT)).not.toBe('sandbox_unreachable')
  })

  it('classifies missing read consent distinctly from fetch failed', () => {
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_READ_CONSENT_MISSING_HINT)).toBe('sandbox_no_read')
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_FETCH_FAILED_HINT)).toBe('sandbox_fetch_failed')
    expect(classifyIngestionTriggerSyncMessage(TRIGGER_READ_CONSENT_MISSING_HINT)).not.toBe(
      classifyIngestionTriggerSyncMessage(TRIGGER_FETCH_FAILED_HINT),
    )
  })
})
