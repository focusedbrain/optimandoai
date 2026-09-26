/**
 * Electron surface wiring for the shared §IX.3.1 rule-8 alert.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import LinkWarningDialog from './LinkWarningDialog'
import {
  ChannelProvenanceAlert,
  channelProvenanceAlertRecordFromUnknown,
} from '@repo/shared-beap-ui'

const here = dirname(fileURLToPath(import.meta.url))

const ALERTING_META = JSON.stringify({
  channel_provenance: {
    dkim: { verdict: 'none', aligned: false },
    dmarc: { verdict: 'none', aligned: false },
  },
})

describe('Electron CPR alert surfaces', () => {
  it('EmailMessageDetail imports and mounts the shared alert from depackaged_metadata', () => {
    const src = readFileSync(join(here, 'EmailMessageDetail.tsx'), 'utf8')
    expect(src).toContain("from '@repo/shared-beap-ui'")
    expect(src).toContain('channelProvenanceAlertRecordFromUnknown')
    expect(src).toContain('<ChannelProvenanceAlert')
    expect(src).toContain('surface="electron-email-message-detail"')
    expect(src).toContain('channelProvenanceRecord={channelProvenanceAlertRecord}')
  })

  it('LinkWarningDialog accepts an optional CPR prop and renders the shared alert', () => {
    const src = readFileSync(join(here, 'LinkWarningDialog.tsx'), 'utf8')
    expect(src).toMatch(/channelProvenanceRecord\?:/)
    expect(src).toContain('<ChannelProvenanceAlert')
    expect(src).toContain('surface="electron-link-warning-dialog"')

    const record = channelProvenanceAlertRecordFromUnknown(ALERTING_META)
    const html = renderToStaticMarkup(
      React.createElement(LinkWarningDialog, {
        isOpen: true,
        url: 'https://example.com/path',
        contextKey: 'msg:https://example.com/path',
        onConfirm: () => undefined,
        onCancel: () => undefined,
        channelProvenanceRecord: record,
      }),
    )
    expect(html).toContain('This sender could not be verified')
    expect(html).toContain('data-surface="electron-link-warning-dialog"')
    // Risk checkbox remains for link opening; it must not clear the alert.
    expect(html).toContain('link-warning-risk-check')
  })

  it('EmailInboxBulkView forwards pending-link CPR into LinkWarningDialog', () => {
    const src = readFileSync(join(here, 'EmailInboxBulkView.tsx'), 'utf8')
    expect(src).toContain('channelProvenanceAlertRecordFromUnknown')
    expect(src).toContain('pendingLink?.message.depackaged_metadata')
  })

  it('shared alert itself has no dismiss control when mounted alone', () => {
    const html = renderToStaticMarkup(
      React.createElement(ChannelProvenanceAlert, {
        record: channelProvenanceAlertRecordFromUnknown(ALERTING_META),
        surface: 'electron-email-message-detail',
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).not.toMatch(/<button/i)
    expect(html).not.toMatch(/type="checkbox"/)
  })
})
