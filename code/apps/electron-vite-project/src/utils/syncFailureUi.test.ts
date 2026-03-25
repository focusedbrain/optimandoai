import { describe, it, expect } from 'vitest'
import { classifySyncFailureMessage, parseBracketedAccountSyncMessage } from './syncFailureUi'

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
})
