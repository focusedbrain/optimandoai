/**
 * P3 sandbox lock-notice mount tests — catches sandbox-only render crashes
 * (e.g. missing UI_BADGE import on paths that only execute when isSandbox).
 *
 * Uses renderToStaticMarkup (same pattern as SandboxReadCleanupHint.test.tsx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InboxMessage } from '../stores/useEmailInboxStore'

vi.mock('../hooks/useOrchestratorMode', () => ({
  useOrchestratorMode: vi.fn(),
}))

vi.mock('../stores/useEmailInboxStore', () => ({
  useEmailInboxStore: vi.fn(() => ({
    selectedAttachmentId: null,
    selectAttachment: vi.fn(),
    mergeMessageAttachments: vi.fn(),
    toggleStar: vi.fn(),
    archiveMessages: vi.fn(),
    deleteMessages: vi.fn(),
    cancelDeletion: vi.fn(),
    editingDraftForMessageId: null,
    setEditingDraftForMessageId: vi.fn(),
  })),
}))

vi.mock('../shims/handshakeRpc', () => ({
  listHandshakes: vi.fn(async () => []),
}))

import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import EmailMessageDetail from './EmailMessageDetail'

const LOCK_COPY = 'Sending messages is disabled on the sandbox for security.'

function baseMessage(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'msg-sandbox-1',
    source_type: 'email_imap',
    handshake_id: 'hs-e0c54755-afcf-4ffe-ad05-17037df31722',
    account_id: 'acc-1',
    email_message_id: 'em-1',
    from_address: 'sender@example.com',
    from_name: 'Sender',
    to_addresses: 'sandbox@example.com',
    cc_addresses: null,
    subject: 'Sandbox clone test',
    body_text: 'Hello from host inbox clone.',
    body_html: null,
    beap_package_json: null,
    depackaged_json: null,
    has_attachments: 0,
    attachment_count: 0,
    received_at: '2026-06-14T12:00:00.000Z',
    ingested_at: '2026-06-14T12:00:01.000Z',
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
    ...overrides,
  }
}

describe('EmailMessageDetail — sandbox lock notice (mount)', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'sandbox',
      ready: true,
      isSandbox: true,
      isHost: false,
      ledgerProvesInternalSandboxToHost: true,
      ledgerProvesLocalHostPeerSandbox: false,
    })
  })

  it('renders lock notice instead of reply when isSandbox and onReply is set', () => {
    const html = renderToStaticMarkup(
      <EmailMessageDetail
        message={baseMessage()}
        onReply={() => {}}
        authoritativeDeviceInternalRole="sandbox"
      />,
    )
    expect(html).toContain(LOCK_COPY)
    expect(html).toContain('inbox-detail-reply-sandbox-notice')
    expect(html).not.toContain('inbox-detail-reply-glyph')
  })

  it('renders deleted-message panel (UI_BADGE.red path) without ReferenceError', () => {
    const html = renderToStaticMarkup(
      <EmailMessageDetail
        message={baseMessage({
          deleted: 1,
          deleted_at: '2026-06-14T12:00:00.000Z',
          purge_after: '2026-07-01T00:00:00.000Z',
        })}
        authoritativeDeviceInternalRole="sandbox"
      />,
    )
    expect(html).toContain('Message scheduled for deletion')
    expect(html).toContain('Cancel Deletion')
  })
})

describe('EmailMessageDetail — host reply unchanged (mount)', () => {
  beforeEach(() => {
    vi.mocked(useOrchestratorMode).mockReturnValue({
      mode: 'host',
      ready: true,
      isSandbox: false,
      isHost: true,
      ledgerProvesInternalSandboxToHost: false,
      ledgerProvesLocalHostPeerSandbox: true,
    })
  })

  it('renders reply glyph on host when onReply is set', () => {
    const html = renderToStaticMarkup(
      <EmailMessageDetail
        message={baseMessage()}
        onReply={() => {}}
        authoritativeDeviceInternalRole="host"
      />,
    )
    expect(html).toContain('inbox-detail-reply-glyph')
    expect(html).not.toContain('inbox-detail-reply-sandbox-notice')
  })
})
