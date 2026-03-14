import { describe, it, expect, vi } from 'vitest'
import { validateReceiverEmail } from './receiverEmailValidation'

describe('validateReceiverEmail', () => {
  it('matches when receiver_email equals user email (case insensitive)', () => {
    expect(validateReceiverEmail('receiver@b.com', 'receiver@b.com').valid).toBe(true)
    expect(validateReceiverEmail('Receiver@B.com', 'receiver@b.com').valid).toBe(true)
    expect(validateReceiverEmail('receiver@b.com', 'Receiver@B.com').valid).toBe(true)
  })

  it('rejects when emails do not match', () => {
    const r = validateReceiverEmail('receiver@b.com', 'intruder@c.com')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('receiver@b.com')
    expect(r.reason).toContain('intruder@c.com')
  })

  it('allows legacy handshakes with null/empty receiver_email', () => {
    expect(validateReceiverEmail(null, 'user@a.com').valid).toBe(true)
    expect(validateReceiverEmail('', 'user@a.com').valid).toBe(true)
    expect(validateReceiverEmail(undefined, 'user@a.com').valid).toBe(true)
  })

  it('handles userEmails as array (JWT email claim)', () => {
    expect(validateReceiverEmail('receiver@b.com', ['receiver@b.com']).valid).toBe(true)
    expect(validateReceiverEmail('receiver@b.com', ['alias@b.com', 'receiver@b.com']).valid).toBe(true)
    expect(validateReceiverEmail('receiver@b.com', ['intruder@c.com']).valid).toBe(false)
  })

  it('trims whitespace', () => {
    expect(validateReceiverEmail('  receiver@b.com  ', 'receiver@b.com').valid).toBe(true)
    expect(validateReceiverEmail('receiver@b.com', '  receiver@b.com  ').valid).toBe(true)
  })

  it('rejects when userEmails is empty', () => {
    const r = validateReceiverEmail('receiver@b.com', null)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('no authenticated email')
  })
})
