import { describe, expect, it } from 'vitest'
import {
  canShowInboxRunAutomation,
  capabilitiesForSessionAttach,
  resolveInboxSessionArtefact,
} from '../inboxSessionArtefact'
import type { InboxMessage } from '../../stores/useEmailInboxStore'

function baseMessage(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'msg-1',
    source_type: 'direct_beap',
    handshake_id: 'hs-1',
    account_id: null,
    email_message_id: null,
    from_address: 'a@b.com',
    from_name: null,
    to_addresses: null,
    cc_addresses: null,
    subject: 'Test',
    body_text: 'body',
    body_html: null,
    beap_package_json: null,
    depackaged_json: null,
    has_attachments: 0,
    attachment_count: 0,
    received_at: '2026-05-04T17:00:00Z',
    ingested_at: '2026-05-04T17:00:00Z',
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

describe('resolveInboxSessionArtefact', () => {
  it('reads artefact from depackaged_json', () => {
    const artefact = {
      requested_action: 'import_and_offer_run',
      sessions: [{ session_id: 's1', session_name: 'Flow A' }],
    }
    const message = baseMessage({
      depackaged_json: JSON.stringify({ body: 'hi', session_import_artefact: artefact }),
    })
    const r = resolveInboxSessionArtefact(message)
    expect(r.source).toBe('depackaged_json')
    expect(r.refs).toEqual([{ sessionId: 's1', sessionName: 'Flow A', requiredCapability: undefined }])
  })

  it('falls back to pBEAP package payload', () => {
    const capsule = {
      body: 'hi',
      session_import_artefact: {
        requested_action: 'import_only',
        sessions: [{ session_id: 's2', session_name: 'Flow B' }],
      },
    }
    const pkg = {
      header: { encoding: 'pBEAP' },
      payload: btoa(JSON.stringify(capsule)),
    }
    const message = baseMessage({ beap_package_json: JSON.stringify(pkg) })
    const r = resolveInboxSessionArtefact(message)
    expect(r.source).toBe('beap_package_pbeap')
    expect(r.refs[0]?.sessionId).toBe('s2')
  })
})

describe('canShowInboxRunAutomation', () => {
  it('shows for validated messages with artefact', () => {
    const message = baseMessage({
      validated_at: '2026-05-04T17:00:00Z',
      validation_reason: null,
      depackaged_json: JSON.stringify({
        session_import_artefact: {
          requested_action: 'import_and_offer_run',
          sessions: [{ session_id: 's1', session_name: 'Flow' }],
        },
      }),
    })
    expect(canShowInboxRunAutomation(message)).toBe(true)
  })

  it('shows for legacy pending rows with artefact and no rejection reason', () => {
    const message = baseMessage({
      validated_at: null,
      validation_reason: null,
      depackaged_json: JSON.stringify({
        session_import_artefact: {
          requested_action: 'import_only',
          sessions: [{ session_id: 's1' }],
        },
      }),
    })
    expect(canShowInboxRunAutomation(message)).toBe(true)
  })
})

describe('capabilitiesForSessionAttach', () => {
  it('defaults to session_control when config has no capabilities', () => {
    expect(capabilitiesForSessionAttach({})).toEqual(['session_control'])
  })
})
