/**
 * §IX.3.1 rule-8 alert — display rule and non-dismissibility.
 * Cross-check against canonical `channelAlertRequired` lives in
 * `packages/ingestion-core/__tests__/channelProvenanceAlertDisplay.crossCheck.test.ts`.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  channelAlertRequiredForDisplay,
  channelProvenanceAlertRecordFromUnknown,
  type ChannelAlertVerdict,
} from './ChannelProvenanceAlert'

const VERDICTS: ChannelAlertVerdict[] = ['pass', 'fail', 'none', 'unverifiable']

describe('channelAlertRequiredForDisplay', () => {
  test('null / undefined never trigger', () => {
    expect(channelAlertRequiredForDisplay(null)).toBe(false)
    expect(channelAlertRequiredForDisplay(undefined)).toBe(false)
  })

  test('fires only when DKIM and DMARC are both absent or unverifiable', () => {
    for (const dkim of VERDICTS) {
      for (const dmarc of VERDICTS) {
        const record = { dkim: { verdict: dkim }, dmarc: { verdict: dmarc } }
        const expected =
          (dkim === 'none' || dkim === 'unverifiable') &&
          (dmarc === 'none' || dmarc === 'unverifiable')
        expect(channelAlertRequiredForDisplay(record), `${dkim}/${dmarc}`).toBe(expected)
      }
    }
  })
})

describe('channelProvenanceAlertRecordFromUnknown', () => {
  test('reads nested channel_provenance from a depackaged_metadata blob', () => {
    const meta = JSON.stringify({
      format: 'beap_message',
      channel_provenance: {
        dkim: { verdict: 'none', aligned: false },
        dmarc: { verdict: 'unverifiable', aligned: false },
      },
    })
    expect(channelProvenanceAlertRecordFromUnknown(meta)).toEqual({
      dkim: { verdict: 'none' },
      dmarc: { verdict: 'unverifiable' },
    })
  })

  test('fail-closed on missing or unknown verdicts', () => {
    expect(channelProvenanceAlertRecordFromUnknown(null)).toBeNull()
    expect(channelProvenanceAlertRecordFromUnknown({ dkim: { verdict: 'pass' } })).toBeNull()
    expect(
      channelProvenanceAlertRecordFromUnknown({
        dkim: { verdict: 'maybe' },
        dmarc: { verdict: 'pass' },
      }),
    ).toBeNull()
  })
})

describe('non-dismissibility guard', () => {
  test('exported component body has no dismiss / acknowledge affordance', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, 'ChannelProvenanceAlert.tsx'), 'utf8')
    const bodyStart = src.indexOf('export function ChannelProvenanceAlert')
    expect(bodyStart).toBeGreaterThanOrEqual(0)
    const body = src.slice(bodyStart)
    expect(body).not.toMatch(/\bonDismiss\b/)
    expect(body).not.toMatch(/\bonAcknowledge\b/)
    expect(body).not.toMatch(/\bonClose\b/)
    expect(body).not.toMatch(/type=["']checkbox["']/)
    expect(body).not.toMatch(/<button\b/i)
  })
})
