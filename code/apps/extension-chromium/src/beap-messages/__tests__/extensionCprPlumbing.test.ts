/**
 * Phase 5 — named item "extension CPR plumbing".
 *
 * Phase 2 wired the shared rule-8 alert into the extension behind an optional
 * prop and recorded, explicitly, that the surface could not yet alert: the
 * sealed inbox RPC did not return `depackaged_metadata`, so `BeapMessage` had
 * no CPR to render from. This closes that, and pins the two things that make
 * it real rather than decorative — the field crosses the wire, and it is
 * decoded by the SAME fail-closed extractor the Electron surfaces use.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { channelAlertRequiredForDisplay } from '@repo/shared-beap-ui'
import { inboxRowToBeapMessage } from '../inboxRowToBeapMessage'
import type { BeapInboxRow } from '../../handshake/handshakeRpc'

const here = dirname(fileURLToPath(import.meta.url))

function row(meta: string | null): BeapInboxRow {
  return {
    id: 'm-1',
    handshake_id: null,
    subject: 'S',
    body_text: 'b',
    depackaged_json: JSON.stringify({ body: 'hello', transport_plaintext: 'hello' }),
    depackaged_metadata: meta,
    received_at: 1_754_650_000,
    read_status: 0,
    archived: 0,
    has_attachments: 0,
    attachment_count: 0,
    ai_analysis_json: null,
    urgency_score: null,
    from_address: 'a@b.test',
    from_name: null,
    source_type: 'plain_email',
    validated_at: null,
    validation_reason: null,
    attachments: [],
  }
}

const ALERTING = JSON.stringify({
  channel_provenance: {
    dkim: { verdict: 'none', aligned: false },
    dmarc: { verdict: 'unverifiable', aligned: false },
  },
})
const QUIET = JSON.stringify({
  channel_provenance: {
    dkim: { verdict: 'pass', aligned: true },
    dmarc: { verdict: 'pass', aligned: true },
  },
})

describe('extension CPR plumbing — the field reaches BeapMessage', () => {
  it('maps an alerting record so the surface genuinely alerts', () => {
    const msg = inboxRowToBeapMessage(row(ALERTING))
    expect(msg.channelProvenance).toEqual({
      dkim: { verdict: 'none' },
      dmarc: { verdict: 'unverifiable' },
    })
    expect(channelAlertRequiredForDisplay(msg.channelProvenance)).toBe(true)
  })

  it('maps an authenticated record without alerting', () => {
    const msg = inboxRowToBeapMessage(row(QUIET))
    expect(channelAlertRequiredForDisplay(msg.channelProvenance)).toBe(false)
  })

  it('a row with no CPR yields null and never a fabricated pass', () => {
    expect(inboxRowToBeapMessage(row(null)).channelProvenance).toBeNull()
    expect(inboxRowToBeapMessage(row('not json')).channelProvenance).toBeNull()
    expect(channelAlertRequiredForDisplay(inboxRowToBeapMessage(row(null)).channelProvenance)).toBe(
      false,
    )
  })

  it('uses the shared extractor rather than a second local reading', () => {
    const src = readFileSync(join(here, '..', 'inboxRowToBeapMessage.ts'), 'utf8')
    expect(src).toContain('channelProvenanceAlertRecordFromUnknown')
    // A hand-rolled parse here would be a second rule over the same field.
    expect(src).not.toMatch(/channel_provenance/)
  })
})

describe('extension CPR plumbing — the wire carries the field', () => {
  it('the RPC row type declares depackaged_metadata', () => {
    const rpc = readFileSync(join(here, '..', '..', 'handshake', 'handshakeRpc.ts'), 'utf8')
    const iface = rpc.slice(rpc.indexOf('export interface BeapInboxRow'))
    expect(iface.slice(0, iface.indexOf('}'))).toMatch(/depackaged_metadata: string \| null/)
  })

  it('the panel falls back to the message record when no prop is supplied', () => {
    const panel = readFileSync(
      join(here, '..', 'components', 'BeapMessageDetailPanel.tsx'),
      'utf8',
    )
    expect(panel).toContain('record={channelProvenanceRecord ?? message.channelProvenance}')
  })
})
