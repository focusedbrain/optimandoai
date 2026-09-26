/**
 * Option-2 prop-supplied CPR alert wiring for BeapMessageDetailPanel.
 *
 * Sync-path plumbing (beapInbox.list → depackaged_metadata → BeapMessage) landed
 * in Phase 5 as the named item "extension CPR plumbing"; see
 * `extensionCprPlumbing.test.ts`. The optional prop remains the explicit
 * override, and this test still locks that contract.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import {
  ChannelProvenanceAlert,
  channelAlertRequiredForDisplay,
  type ChannelProvenanceAlertRecord,
} from '@repo/shared-beap-ui'

const ALERTING: ChannelProvenanceAlertRecord = {
  dkim: { verdict: 'none' },
  dmarc: { verdict: 'unverifiable' },
}

const QUIET: ChannelProvenanceAlertRecord = {
  dkim: { verdict: 'fail' },
  dmarc: { verdict: 'none' },
}

describe('BeapMessageDetailPanel — channelProvenanceRecord prop (Option 2)', () => {
  it('declares the optional prop and forwards it to ChannelProvenanceAlert', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, 'BeapMessageDetailPanel.tsx'), 'utf8')
    expect(src).toMatch(/channelProvenanceRecord\?:/)
    expect(src).toContain("from '@repo/shared-beap-ui'")
    expect(src).toContain('<ChannelProvenanceAlert')
    // Phase 5 closed "extension CPR plumbing": the prop remains, and falls back
    // to the record the mapper now puts on the message. Before that the surface
    // could not alert at all, which was the whole point of the named item.
    expect(src).toContain('record={channelProvenanceRecord ?? message.channelProvenance}')
    expect(src).toContain('surface="extension-beap-message-detail"')
    // Must not invent a local trigger — the shared component owns the rule.
    expect(src).not.toMatch(/channelAlertRequiredForDisplay\s*\(/)
  })

  it('prop-supplied alerting record renders the shared alert markup', () => {
    expect(channelAlertRequiredForDisplay(ALERTING)).toBe(true)
    const html = renderToStaticMarkup(
      React.createElement(ChannelProvenanceAlert, {
        record: ALERTING,
        surface: 'extension-beap-message-detail',
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-surface="extension-beap-message-detail"')
    expect(html).toContain('This sender could not be verified')
  })

  it('prop-supplied non-alerting record renders nothing', () => {
    expect(channelAlertRequiredForDisplay(QUIET)).toBe(false)
    const html = renderToStaticMarkup(
      React.createElement(ChannelProvenanceAlert, {
        record: QUIET,
        surface: 'extension-beap-message-detail',
      }),
    )
    expect(html).toBe('')
  })

  it('omitted / null prop renders nothing (fail-closed until Phase-5 plumbing)', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ChannelProvenanceAlert, {
          record: null,
          surface: 'extension-beap-message-detail',
        }),
      ),
    ).toBe('')
    expect(
      renderToStaticMarkup(
        React.createElement(ChannelProvenanceAlert, {
          record: undefined,
          surface: 'extension-beap-message-detail',
        }),
      ),
    ).toBe('')
  })
})
