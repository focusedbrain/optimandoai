/**
 * BEAP Email Sync Tests
 *
 * Verifies that the incoming email → ingestion pipeline bridge:
 *   - Detects BEAP capsules via subject and body heuristics
 *   - Submits detected capsules to the ingestion pipeline
 *   - Ignores non-BEAP emails
 *   - Deduplicates already-processed messages
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  detectBeapInBody,
  detectBeapInSubject,
  processEmailForBeap,
  runBeapSyncCycle,
  setEmailFunctions,
  _resetEmailFunctions,
  _resetProcessedMessages,
} from '../beapSync'
import { buildTestSession } from '../../handshake/sessionFactory'
import { buildInitiateCapsule } from '../../handshake/capsuleBuilder'
import { createHandshakeTestDb } from '../../handshake/__tests__/handshakeTestDb'
import { migrateIngestionTables } from '../../ingestion/persistenceDb'
import type { SanitizedMessage, SanitizedMessageDetail } from '../types'

function makeSSOSession() {
  return buildTestSession({ wrdesk_user_id: 'receiver-001', email: 'receiver@test.com' })
}

function makeBeapMessageDetail(capsuleJson: string, id = 'msg-001'): SanitizedMessageDetail {
  return {
    id,
    threadId: 'thread-1',
    accountId: 'acct-1',
    subject: 'BEAP Handshake: initiate [hs-abcd]',
    from: { email: 'sender@test.com', name: 'Sender' },
    to: [{ email: 'receiver@test.com' }],
    date: new Date().toISOString(),
    timestamp: Date.now(),
    snippet: '',
    flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
    hasAttachments: false,
    attachmentCount: 0,
    folder: 'INBOX',
    bodyText: capsuleJson,
    headers: {},
  }
}

function makeNonBeapMessageDetail(id = 'msg-002'): SanitizedMessageDetail {
  return {
    id,
    threadId: 'thread-2',
    accountId: 'acct-1',
    subject: 'Weekly meeting notes',
    from: { email: 'bob@test.com', name: 'Bob' },
    to: [{ email: 'receiver@test.com' }],
    date: new Date().toISOString(),
    timestamp: Date.now(),
    snippet: 'Here are the notes from today...',
    flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
    hasAttachments: false,
    attachmentCount: 0,
    folder: 'INBOX',
    bodyText: 'Here are the notes from today...',
    headers: {},
  }
}

function makeMessage(subject: string, id: string): SanitizedMessage {
  return {
    id,
    threadId: 'thread-1',
    accountId: 'acct-1',
    subject,
    from: { email: 'sender@test.com' },
    to: [{ email: 'receiver@test.com' }],
    date: new Date().toISOString(),
    timestamp: Date.now(),
    snippet: '',
    flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
    hasAttachments: false,
    attachmentCount: 0,
    folder: 'INBOX',
  }
}

describe('BEAP Email Sync — Detection', () => {
  test('T13: detectBeapInBody detects valid BEAP JSON', () => {
    const capsule = buildInitiateCapsule(
      buildTestSession({ wrdesk_user_id: 'sender-001' }),
      { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' },
    )
    const json = JSON.stringify(capsule)
    const result = detectBeapInBody(json)
    expect(result.detected).toBe(true)
    expect(result.capsuleJson).toBe(json)
  })

  test('T15: detectBeapInBody with BEAP JSON body (no headers) → detected via structure', () => {
    const body = JSON.stringify({
      schema_version: 1,
      capsule_type: 'initiate',
      handshake_id: 'hs-test',
    })
    const result = detectBeapInBody(body)
    expect(result.detected).toBe(true)
  })

  test('T16: detectBeapInBody ignores non-BEAP text', () => {
    expect(detectBeapInBody('Hello world')).toEqual({ detected: false })
    expect(detectBeapInBody('{"name": "John"}')).toEqual({ detected: false })
    expect(detectBeapInBody('')).toEqual({ detected: false })
  })

  test('T14: detectBeapInSubject detects BEAP subject', () => {
    expect(detectBeapInSubject('BEAP Handshake: initiate [hs-abc]')).toBe(true)
    expect(detectBeapInSubject('Re: Weekly meeting')).toBe(false)
    expect(detectBeapInSubject('')).toBe(false)
  })
})

describe('BEAP Email Sync — Pipeline Submission', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetProcessedMessages()
    _resetEmailFunctions()
  })

  test('T13: email with BEAP content → submitted to ingestion', async () => {
    const sender = buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com' })
    const capsule = buildInitiateCapsule(sender, { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const json = JSON.stringify(capsule)

    const session = makeSSOSession()
    const detail = makeBeapMessageDetail(json)
    const result = await processEmailForBeap('acct-1', detail, db, session)

    expect(result.submitted).toBe(true)
    expect(result.result).toBeDefined()
    expect(result.result.distribution_target).toBe('handshake_pipeline')
  })

  test('T16: non-BEAP email → NOT submitted', async () => {
    const session = makeSSOSession()
    const detail = makeNonBeapMessageDetail()
    const result = await processEmailForBeap('acct-1', detail, db, session)

    expect(result.submitted).toBe(false)
  })

  test('T17: duplicate email (same message_id) → not reprocessed', async () => {
    const sender = buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com' })
    const capsule = buildInitiateCapsule(sender, { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const json = JSON.stringify(capsule)
    const session = makeSSOSession()

    const detail = makeBeapMessageDetail(json, 'msg-dedup')
    const first = await processEmailForBeap('acct-1', detail, db, session)
    expect(first.submitted).toBe(true)

    const second = await processEmailForBeap('acct-1', detail, db, session)
    expect(second.submitted).toBe(false)
  })
})

describe('BEAP Email Sync — Cycle', () => {
  let db: ReturnType<typeof createHandshakeTestDb>

  beforeEach(() => {
    db = createHandshakeTestDb()
    migrateIngestionTables(db)
    _resetProcessedMessages()
    _resetEmailFunctions()
  })

  test('runBeapSyncCycle processes BEAP emails and skips non-BEAP', async () => {
    const sender = buildTestSession({ wrdesk_user_id: 'sender-001', email: 'sender@test.com' })
    const capsule = buildInitiateCapsule(sender, { receiverUserId: 'receiver-001', receiverEmail: 'receiver@test.com' })
    const json = JSON.stringify(capsule)
    const session = makeSSOSession()

    const beapMsg = makeMessage('BEAP Handshake: initiate [hs-test]', 'msg-beap')
    const plainMsg = makeMessage('Weekly notes', 'msg-plain')

    const beapDetail = makeBeapMessageDetail(json, 'msg-beap')

    setEmailFunctions(
      vi.fn().mockResolvedValue([beapMsg, plainMsg]),
      vi.fn().mockImplementation((_acct: string, msgId: string) => {
        if (msgId === 'msg-beap') return Promise.resolve(beapDetail)
        return Promise.resolve(makeNonBeapMessageDetail(msgId))
      }),
    )

    const result = await runBeapSyncCycle(['acct-1'], db, session)
    expect(result.processed).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  test('runBeapSyncCycle returns error when email functions not configured', async () => {
    const session = makeSSOSession()
    const result = await runBeapSyncCycle(['acct-1'], db, session)
    expect(result.processed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('not configured')
  })
})
