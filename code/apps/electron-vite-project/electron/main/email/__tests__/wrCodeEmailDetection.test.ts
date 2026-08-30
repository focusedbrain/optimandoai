/**
 * WR Code e-mail detection [XVI.7.5, grammar v2] — the producer that scans a
 * plain body and merges check-verified references into the seal-bound
 * `depackaged_metadata` blob beside the Channel Provenance Record.
 */
import { describe, expect, it } from 'vitest'
import { mergeChannelProvenanceMetadata, produceChannelProvenance } from '../channelProvenanceProducer'
import {
  WR_CODE_DETECTION_METADATA_KEY,
  detectWrCodeReferencesInEmailBody,
  mergeWrCodeDetectionMetadata,
  readWrCodeDetectionMetadata,
} from '../wrCodeEmailDetection'

const BODY = [
  'Dear operator,',
  'the public offering is P-WR7X4K-9B2M3C and the sub-handshake is',
  'sp-wr7x4k-h2n5v8-7. A corrupted P-WR7Z4K-9B2M3C stays silent, and the',
  'retired 12-symbol format WR7X4K9B2M3P is not a reference at all.',
].join('\n')

describe('detectWrCodeReferencesInEmailBody', () => {
  it('emits only check-verified grammar-v2 references, with local renderings', () => {
    const hits = detectWrCodeReferencesInEmailBody(BODY)
    expect(hits).toEqual([
      { canonical: 'PWR7X4K9B2M3C', cls: 'P', display: 'P-WR7X4K-9B2M3C', publisher: 'WR7X4K' },
      { canonical: 'SPWR7X4KH2N5V87', cls: 'SP', display: 'SP-WR7X4K-H2N5V8-7', publisher: 'WR7X4K' },
    ])
  })

  it('an empty or code-free body detects nothing', () => {
    expect(detectWrCodeReferencesInEmailBody('')).toEqual([])
    expect(detectWrCodeReferencesInEmailBody('No references in this message.')).toEqual([])
  })
})

describe('mergeWrCodeDetectionMetadata', () => {
  const DETECTIONS = detectWrCodeReferencesInEmailBody(BODY)

  it('no detections ⇒ metadata passes through unchanged (null stays null)', () => {
    expect(mergeWrCodeDetectionMetadata(null, [])).toBeNull()
    expect(mergeWrCodeDetectionMetadata('{"a":1}', [])).toBe('{"a":1}')
  })

  it('detections merge beside existing keys without dropping them', () => {
    const merged = mergeWrCodeDetectionMetadata('{"pbeap_trust":{"kind":"live"}}', DETECTIONS)!
    const parsed = JSON.parse(merged)
    expect(parsed.pbeap_trust).toEqual({ kind: 'live' })
    expect(parsed[WR_CODE_DETECTION_METADATA_KEY]).toHaveLength(2)
  })

  it('unreadable existing metadata is quarantined, not dropped', () => {
    const merged = mergeWrCodeDetectionMetadata('not json', DETECTIONS)!
    expect(JSON.parse(merged).unparsable_metadata).toBe('not json')
  })

  it('composes with the CPR merge exactly as the router calls it', () => {
    const cpr = produceChannelProvenance({ contentSha256: 'c'.repeat(64) })
    const blob = mergeChannelProvenanceMetadata(
      mergeWrCodeDetectionMetadata(null, DETECTIONS),
      cpr,
    )
    const detections = readWrCodeDetectionMetadata(blob)
    expect(detections.map((d) => d.canonical)).toEqual(['PWR7X4K9B2M3C', 'SPWR7X4KH2N5V87'])
    // The CPR is still there beside the detections.
    expect(JSON.parse(blob).channel_provenance).toBeDefined()
  })
})

describe('readWrCodeDetectionMetadata', () => {
  it('round-trips and fails closed on garbage', () => {
    const blob = mergeWrCodeDetectionMetadata(null, detectWrCodeReferencesInEmailBody(BODY))
    expect(readWrCodeDetectionMetadata(blob)).toHaveLength(2)
    expect(readWrCodeDetectionMetadata(null)).toEqual([])
    expect(readWrCodeDetectionMetadata('')).toEqual([])
    expect(readWrCodeDetectionMetadata('not json')).toEqual([])
    expect(readWrCodeDetectionMetadata('{"wr_code_detections":"nope"}')).toEqual([])
    expect(readWrCodeDetectionMetadata('{"wr_code_detections":[{"canonical":1}]}')).toEqual([])
  })
})
