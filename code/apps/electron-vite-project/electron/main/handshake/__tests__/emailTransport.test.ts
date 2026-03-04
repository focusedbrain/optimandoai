/**
 * Email Transport Bridge Tests
 *
 * Verifies that sendCapsuleViaEmail correctly:
 *   - Serializes the capsule and calls the email send function
 *   - Produces email with BEAP markers (subject prefix)
 *   - Handles missing email function gracefully
 *   - Handles missing fromAccountId / recipientEmail
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  sendCapsuleViaEmail,
  setEmailSendFn,
  _resetEmailSendFn,
  type EmailSendFn,
} from '../emailTransport'
import { buildInitiateCapsule, buildAcceptCapsule, buildRefreshCapsule } from '../capsuleBuilder'
import { buildTestSession } from '../sessionFactory'

function sender() {
  return buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com' })
}

describe('Email Transport Bridge', () => {
  let mockSend: EmailSendFn

  beforeEach(() => {
    _resetEmailSendFn()
    mockSend = vi.fn().mockResolvedValue({ success: true, messageId: 'msg-001' })
    setEmailSendFn(mockSend)
  })

  test('T10: sendCapsuleViaEmail produces email with BEAP subject prefix', async () => {
    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const result = await sendCapsuleViaEmail('account-1', 'receiver@test.com', capsule)

    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-001')

    expect(mockSend).toHaveBeenCalledTimes(1)
    const [accountId, payload] = (mockSend as any).mock.calls[0]
    expect(accountId).toBe('account-1')
    expect(payload.to).toEqual(['receiver@test.com'])
    expect(payload.subject).toContain('BEAP Handshake:')
    expect(payload.subject).toContain('initiate')
  })

  test('T11: body is valid serialized capsule JSON', async () => {
    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    await sendCapsuleViaEmail('account-1', 'receiver@test.com', capsule)

    const [, payload] = (mockSend as any).mock.calls[0]
    const parsed = JSON.parse(payload.bodyText)
    expect(parsed.schema_version).toBe(2)
    expect(parsed.capsule_type).toBe('initiate')
    expect(parsed.handshake_id).toBe(capsule.handshake_id)
    expect(parsed.capsule_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('T12: no email account configured → clear error', async () => {
    _resetEmailSendFn()
    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const result = await sendCapsuleViaEmail('account-1', 'receiver@test.com', capsule)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  test('missing fromAccountId → error', async () => {
    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const result = await sendCapsuleViaEmail('', 'receiver@test.com', capsule)

    expect(result.success).toBe(false)
    expect(result.error).toContain('fromAccountId')
  })

  test('missing recipientEmail → error', async () => {
    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const result = await sendCapsuleViaEmail('account-1', '', capsule)

    expect(result.success).toBe(false)
    expect(result.error).toContain('recipient')
  })

  test('accept capsule subject contains accept', async () => {
    const capsule = buildAcceptCapsule(sender(), {
      handshake_id: 'hs-001',
      initiatorUserId: 'other-001',
      initiatorEmail: 'other@test.com',
      sharing_mode: 'receive-only',
    })
    await sendCapsuleViaEmail('account-1', 'other@test.com', capsule)

    const [, payload] = (mockSend as any).mock.calls[0]
    expect(payload.subject).toContain('accept')
  })

  test('refresh capsule subject contains refresh', async () => {
    const capsule = buildRefreshCapsule(sender(), {
      handshake_id: 'hs-001',
      counterpartyUserId: 'other-001',
      counterpartyEmail: 'other@test.com',
      last_seq_received: 0,
      last_capsule_hash_received: 'a'.repeat(64),
    })
    await sendCapsuleViaEmail('account-1', 'other@test.com', capsule)

    const [, payload] = (mockSend as any).mock.calls[0]
    expect(payload.subject).toContain('refresh')
  })

  test('email send function error is caught gracefully', async () => {
    _resetEmailSendFn()
    setEmailSendFn(vi.fn().mockRejectedValue(new Error('SMTP timeout')))

    const capsule = buildInitiateCapsule(sender(), { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const result = await sendCapsuleViaEmail('account-1', 'receiver@test.com', capsule)

    expect(result.success).toBe(false)
    expect(result.error).toContain('SMTP timeout')
  })
})
