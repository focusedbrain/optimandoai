/**
 * `wrc.scanMessage` — main decides whether a message may be scanned for WR
 * Codes (§XVI.3, §XVI.7.4a; HC2, W5): only a verified row whose Channel
 * Provenance Record decodes with `channel_pass`. Everything else is never
 * scanned, and without `scan: true` nothing is scanned at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { channelProvenanceMetadata, createChannelProvenanceRecord } from '@repo/ingestion-core'

const rows = new Map<string, Record<string, unknown>>()
vi.mock('../../email/inboxSealedRead', () => ({
  loadVerifiedInboxMessageById: (_db: unknown, id: string) => rows.get(id) ?? null,
}))

const { handleWrcScanMessage } = await import('../wrcMessageScan')

const SHA = 'a'.repeat(64)
const AT = '2026-09-26T12:00:00.000Z'
const BODY = 'Please connect with us: P-TEST01-10001N. Thanks!'
const metadataFor = (authenticationResults: string[] | undefined) =>
  JSON.stringify(
    channelProvenanceMetadata(
      createChannelProvenanceRecord({
        contentSha256: SHA,
        material: { authenticationResults, fromDomain: 'publisher-a.test' },
        evaluatedAt: AT,
      }),
    ),
  )
const DB = {}

beforeEach(() => {
  rows.clear()
  rows.set('authenticated', {
    id: 'authenticated',
    body_text: BODY,
    depackaged_metadata: metadataFor(['mx.test; dkim=pass header.d=publisher-a.test; dmarc=pass']),
  })
  rows.set('unauthenticated', {
    id: 'unauthenticated',
    body_text: BODY,
    depackaged_metadata: metadataFor(undefined),
  })
  rows.set('tampered', {
    id: 'tampered',
    body_text: BODY,
    depackaged_metadata: (() => {
      const m = JSON.parse(metadataFor(undefined))
      m.channel_provenance.channel_pass = true
      return JSON.stringify(m)
    })(),
  })
  rows.set('no-record', { id: 'no-record', body_text: BODY, depackaged_metadata: null })
})

describe('wrc.scanMessage', () => {
  it('scans an authenticated message on request', () => {
    const r = handleWrcScanMessage(DB, { messageId: 'authenticated', scan: true })
    expect(r).toMatchObject({ success: true, result: { scanAllowed: true } })
    if (!r.success) return
    expect(r.result.detections.map((d) => d.display)).toEqual(['P-TEST01-10001N'])
  })

  it('reports permission without scanning when scan is not requested', () => {
    expect(handleWrcScanMessage(DB, { messageId: 'authenticated' })).toEqual({
      success: true,
      result: { scanAllowed: true, detections: [] },
    })
  })

  it.each(['unauthenticated', 'tampered', 'no-record', 'missing'])('never scans %s', (messageId) => {
    expect(handleWrcScanMessage(DB, { messageId, scan: true })).toEqual({
      success: true,
      result: { scanAllowed: false, detections: [] },
    })
  })

  it('refuses without a message id or database', () => {
    expect(handleWrcScanMessage(DB, {})).toEqual({ success: false, error: 'messageId is required' })
    expect(handleWrcScanMessage(null, { messageId: 'authenticated' })).toEqual({
      success: false,
      error: 'Database unavailable',
    })
  })
})
