/**
 * Cross-product honesty check: the shared-beap-ui display rule must match
 * canonical `channelAlertRequired` for every DKIM×DMARC verdict pair.
 */
import { describe, expect, test } from 'vitest'
import {
  channelAlertRequired,
  type ChannelAuthVerdict,
  type ChannelProvenanceRecord,
  CHANNEL_PROVENANCE_SCHEME,
  CHANNEL_PROVENANCE_PRODUCER_VERSION,
} from '../src/channelProvenance.js'
import {
  channelAlertRequiredForDisplay,
  channelProvenanceAlertRecordFromUnknown,
} from '../../shared-beap-ui/src/ChannelProvenanceAlert'

const VERDICTS: ChannelAuthVerdict[] = ['pass', 'fail', 'none', 'unverifiable']

function stubRecord(
  dkim: ChannelAuthVerdict,
  dmarc: ChannelAuthVerdict,
): ChannelProvenanceRecord {
  return {
    marking_scheme: CHANNEL_PROVENANCE_SCHEME,
    producer_version: CHANNEL_PROVENANCE_PRODUCER_VERSION,
    evaluated_at: '2026-08-07T12:00:00.000Z',
    content_sha256: 'a'.repeat(64),
    spf: { verdict: 'none', aligned: false },
    dkim: { verdict: dkim, aligned: dkim === 'pass' },
    dmarc: { verdict: dmarc, aligned: dmarc === 'pass' },
    channel_pass: false,
    authenticated_sender_domain: null,
    discovery_record: 'not_evaluated',
  }
}

describe('ChannelProvenanceAlert display rule × channelAlertRequired', () => {
  test('identical trigger over the full DKIM×DMARC verdict cross-product', () => {
    for (const dkim of VERDICTS) {
      for (const dmarc of VERDICTS) {
        const record = stubRecord(dkim, dmarc)
        const display = channelProvenanceAlertRecordFromUnknown(record)
        expect(display, `${dkim}/${dmarc} extract`).not.toBeNull()
        expect(
          channelAlertRequiredForDisplay(display),
          `${dkim}/${dmarc}`,
        ).toBe(channelAlertRequired(record))
      }
    }
  })
})
