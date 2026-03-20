import { describe, it, expect } from 'vitest'
import type { CustomImapSmtpConnectPayload } from '../types'
import { validateCustomImapSmtpPayload } from './customImapSmtpPayloadValidation'

function validBase(): CustomImapSmtpConnectPayload {
  return {
    email: 'user@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'ssl',
    imapPassword: 'secret',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUseSameCredentials: true,
  }
}

describe('validateCustomImapSmtpPayload', () => {
  it('accepts minimal valid same-credentials payload', () => {
    expect(() => validateCustomImapSmtpPayload(validBase())).not.toThrow()
  })

  it('rejects invalid email', () => {
    expect(() => validateCustomImapSmtpPayload({ ...validBase(), email: 'bad' })).toThrow(/valid email/)
  })

  it('rejects bad ports', () => {
    expect(() => validateCustomImapSmtpPayload({ ...validBase(), imapPort: 0 })).toThrow(/IMAP port/)
    expect(() => validateCustomImapSmtpPayload({ ...validBase(), smtpPort: 70000 })).toThrow(/SMTP port/)
  })

  it('requires separate SMTP credentials when smtpUseSameCredentials is false', () => {
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        smtpUseSameCredentials: false,
      }),
    ).toThrow(/SMTP username/)
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        smtpUseSameCredentials: false,
        smtpUsername: 'u',
      }),
    ).toThrow(/SMTP password/)
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        smtpUseSameCredentials: false,
        smtpUsername: 'u',
        smtpPassword: 'p',
      }),
    ).not.toThrow()
  })

  it('rejects lifecycle mailbox names that are too long or contain control chars', () => {
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        imapLifecycleArchiveMailbox: 'x'.repeat(201),
      }),
    ).toThrow(/Archive mailbox name/)
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        imapLifecycleTrashMailbox: 'bad\u0007name',
      }),
    ).toThrow(/Trash mailbox name/)
  })

  it('allows optional lifecycle fields to be empty / whitespace-only', () => {
    expect(() =>
      validateCustomImapSmtpPayload({
        ...validBase(),
        imapLifecycleArchiveMailbox: '   ',
        imapLifecyclePendingReviewMailbox: undefined,
      }),
    ).not.toThrow()
  })
})
