/**
 * WR Code e-mail body scan [XVI.3, XVI.7.4a, grammar v2] — explicit trigger
 * only. The scanner returns check-verified candidates; ingest never runs it.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectWrCodeReferencesInEmailBody } from '../wrCodeEmailDetection'

const here = dirname(fileURLToPath(import.meta.url))

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

describe('ingest never auto-detects loose WR Code references [XVI.3, XVI.7.4a]', () => {
  const routerSource = readFileSync(resolve(here, '../messageRouter.ts'), 'utf8')

  it('the message router does not import or call any reference scanner', () => {
    expect(routerSource).not.toMatch(/wrCodeEmailDetection/)
    expect(routerSource).not.toMatch(/detectWrCodeReferences/)
  })

  it('no detections are written into the sealed message metadata', () => {
    expect(routerSource).not.toMatch(/wr_code_detections/)
    expect(routerSource).toMatch(/mergeChannelProvenanceMetadata\(null, channelProvenance\)/)
  })
})
