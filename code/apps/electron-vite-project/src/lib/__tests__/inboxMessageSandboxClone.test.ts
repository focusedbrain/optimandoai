import { describe, it, expect } from 'vitest'
import { inboxMessageIsSandboxBeapClone } from '../inboxMessageSandboxClone'
import type { InboxMessage } from '../../stores/useEmailInboxStore'

const base: InboxMessage = {
  id: 'm1',
  source_type: 'direct_beap',
  handshake_id: 'hs1',
  account_id: null,
  email_message_id: null,
  from_address: 'a@b.com',
  from_name: null,
  to_addresses: null,
  cc_addresses: null,
  subject: 'Hello',
  body_text: 'plain',
  body_html: null,
  beap_package_json: null,
  depackaged_json: null,
  has_attachments: 0,
  attachment_count: 0,
  received_at: new Date().toISOString(),
  ingested_at: new Date().toISOString(),
  read_status: 0,
  starred: 0,
  archived: 0,
  deleted: 0,
  deleted_at: null,
  purge_after: null,
  remote_deleted: null,
  sort_category: null,
  sort_reason: null,
  urgency_score: null,
  needs_reply: null,
  pending_delete: 0,
  pending_delete_at: null,
  ai_summary: null,
  ai_draft_response: null,
}

describe('inboxMessageIsSandboxBeapClone', () => {
  it('false for ordinary body', () => {
    expect(inboxMessageIsSandboxBeapClone({ ...base, body_text: 'no markers here' })).toBe(false)
  })

  it('true when public banner in body_text', () => {
    expect(
      inboxMessageIsSandboxBeapClone({
        ...base,
        body_text: '[BEAP sandbox clone — sent by you]\nHello',
      }),
    ).toBe(true)
  })

  it('true when beap_sandbox_clone in depackaged_json', () => {
    const dep = JSON.stringify({ body: { x: 1 }, beap_sandbox_clone: { clone_reason: 'sandbox_test' } })
    expect(inboxMessageIsSandboxBeapClone({ ...base, depackaged_json: dep })).toBe(true)
  })

  it('true for inbox_sandbox_clone_provenance in string field', () => {
    expect(
      inboxMessageIsSandboxBeapClone({
        ...base,
        body_text: '---\n' + JSON.stringify({ inbox_sandbox_clone_provenance: { source_message_id: 'x' } }),
      }),
    ).toBe(true)
  })
})
