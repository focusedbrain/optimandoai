/**
 * Build B — CloneInboxView unit tests (React render only; no Node.js fs imports).
 *
 * Covers:
 *   • isCloneMessage filter (clone vs native vs plain email)
 *   • SandboxProcessingConsole: plain-word status mapping, field rendering
 *   • OrphanedSandboxPlaceholder: copy, no connect-email CTA
 *   • CloneInboxView: subtext, tier accuracy (source-level checks in buildBSandboxViewportUi.test.ts)
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isCloneMessage, SandboxProcessingConsole, OrphanedSandboxPlaceholder } from './CloneInboxView'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'msg-1',
    source_type: 'beap',
    handshake_id: 'hs-1',
    account_id: null,
    email_message_id: null,
    from_address: 'sender@example.com',
    from_name: 'Sender',
    to_addresses: null,
    cc_addresses: null,
    subject: 'Test subject',
    body_text: 'Hello',
    body_html: null,
    beap_package_json: null,
    depackaged_json: null,
    has_attachments: 0,
    attachment_count: 0,
    received_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    read_status: 1,
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
    depackaged_metadata: null,
    ...overrides,
  } as InboxMessage
}

function makeStatus(
  code: IngestionStatusResult['code'],
  overrides: Partial<IngestionStatusResult> = {},
): IngestionStatusResult {
  return {
    code,
    owner: 'sandbox',
    thisNodeRole: 'sandbox',
    hostShouldReadPoll: false,
    sandboxShouldReadPoll: true,
    ownershipReason: 'test',
    accounts: [],
    resolvedAt: Date.now(),
    ...overrides,
  }
}

// ── isCloneMessage ─────────────────────────────────────────────────────────────

describe('isCloneMessage', () => {
  it('returns true for sandbox_clone=true in depackaged_metadata', () => {
    const msg = makeMsg({
      depackaged_metadata: JSON.stringify({ inbox_response_path: { sandbox_clone: true } }),
    })
    expect(isCloneMessage(msg)).toBe(true)
  })

  it('returns false for native BEAP (no sandbox_clone flag)', () => {
    const msg = makeMsg({
      depackaged_metadata: JSON.stringify({ inbox_response_path: { sandbox_clone: false } }),
    })
    expect(isCloneMessage(msg)).toBe(false)
  })

  it('returns false for plain email (no depackaged_metadata)', () => {
    const msg = makeMsg({ depackaged_metadata: null })
    expect(isCloneMessage(msg)).toBe(false)
  })

  it('returns false when inbox_response_path is absent', () => {
    const msg = makeMsg({ depackaged_metadata: JSON.stringify({ other_field: true }) })
    expect(isCloneMessage(msg)).toBe(false)
  })

  it('returns false for malformed JSON (does not throw)', () => {
    const msg = makeMsg({ depackaged_metadata: '{invalid json' })
    expect(isCloneMessage(msg)).toBe(false)
  })

  it('returns false when sandbox_clone_quarantine is set but not sandbox_clone', () => {
    const msg = makeMsg({
      depackaged_metadata: JSON.stringify({ inbox_response_path: { sandbox_clone_quarantine: true } }),
    })
    expect(isCloneMessage(msg)).toBe(false)
  })
})

// ── SandboxProcessingConsole ───────────────────────────────────────────────────

describe('SandboxProcessingConsole — status code → plain words', () => {
  const cases: Array<[IngestionStatusResult['code'], string]> = [
    ['OK_SANDBOX_FETCHING', 'Processing normally'],
    ['OK_SINGLE_MACHINE', 'Processing normally'],
    ['DEGRADED_HELD_MESSAGES', 'Processing normally'],
    ['ACTION_NEEDED_READ_CONSENT', 'Read consent needed'],
    ['PAUSED_SANDBOX_UNREACHABLE', 'Provider unreachable'],
    ['PAUSED_HOST_DELEGATED', 'Provider unreachable'],
  ]

  for (const [code, expected] of cases) {
    it(`${code} → "${expected}"`, () => {
      const html = renderToStaticMarkup(
        <SandboxProcessingConsole status={makeStatus(code)} />,
      )
      expect(html).toContain(expected)
    })
  }

  it('returns null (renders nothing) when status is null', () => {
    const html = renderToStaticMarkup(<SandboxProcessingConsole status={null} />)
    expect(html).toBe('')
  })
})

describe('SandboxProcessingConsole — fields', () => {
  it('shows delivered total aggregated from accounts', () => {
    const status = makeStatus('OK_SANDBOX_FETCHING', {
      accounts: [
        { accountId: 'a1', readConsentPresent: true, lastPollDelivered: 5, lastPollAt: Date.now() },
        { accountId: 'a2', readConsentPresent: true, lastPollDelivered: 3 },
      ],
    })
    const html = renderToStaticMarkup(<SandboxProcessingConsole status={status} />)
    expect(html).toContain('console-delivered')
    expect(html).toContain('>8<')  // 5+3
  })

  it('shows held count when > 0', () => {
    const status = makeStatus('DEGRADED_HELD_MESSAGES', {
      accounts: [{ accountId: 'a1', readConsentPresent: true, lastPollHeld: 2 }],
    })
    const html = renderToStaticMarkup(<SandboxProcessingConsole status={status} />)
    expect(html).toContain('console-held')
    expect(html).toContain('>2<')
  })

  it('hides held when 0', () => {
    const status = makeStatus('OK_SANDBOX_FETCHING', {
      accounts: [{ accountId: 'a1', readConsentPresent: true, lastPollHeld: 0 }],
    })
    const html = renderToStaticMarkup(<SandboxProcessingConsole status={status} />)
    expect(html).not.toContain('console-held')
  })

  it('shows last-poll time field', () => {
    const status = makeStatus('OK_SANDBOX_FETCHING', {
      accounts: [{ accountId: 'a1', readConsentPresent: true, lastPollAt: Date.now() - 120_000 }],
    })
    const html = renderToStaticMarkup(<SandboxProcessingConsole status={status} />)
    expect(html).toContain('console-last-poll')
    expect(html).toContain('2m ago')
  })

  it('tier accuracy: no microVM or hardware claims', () => {
    const html = renderToStaticMarkup(
      <SandboxProcessingConsole status={makeStatus('OK_SANDBOX_FETCHING')} />,
    ).toLowerCase()
    expect(html).not.toContain('microvm')
    expect(html).not.toContain('hardware')
    expect(html).not.toContain('crosvm')
    expect(html).not.toContain('virtual machine')
  })
})

// ── OrphanedSandboxPlaceholder ─────────────────────────────────────────────────

describe('OrphanedSandboxPlaceholder — D4', () => {
  it('shows awaiting-pairing copy (exact spec wording)', () => {
    const html = renderToStaticMarkup(<OrphanedSandboxPlaceholder />)
    expect(html).toContain('Awaiting pairing')
    expect(html).toContain('complete the internal handshake with your host device')
    expect(html).toContain('start processing mail')
  })

  it('does NOT show connect-email CTA', () => {
    const html = renderToStaticMarkup(<OrphanedSandboxPlaceholder />).toLowerCase()
    expect(html).not.toContain('connect')
    expect(html).not.toContain('connect-email')
  })

  it('has data-testid for test isolation', () => {
    const html = renderToStaticMarkup(<OrphanedSandboxPlaceholder />)
    expect(html).toContain('orphaned-sandbox-placeholder')
  })
})

// Source-level invariants (suppressed surfaces, App.tsx gating, chip rename)
// are in src/lib/__tests__/buildBSandboxViewportUi.test.ts
