import { describe, expect, it } from 'vitest'
import {
  extractBalancedJsonObject,
  repairTrailingCommasInJson,
  tryParseAnalysis,
  tryParseAnalysisWithMeta,
  tryParsePartialAnalysis,
} from './parseInboxAiJson'

const STRICT = `{"needsReply":true,"needsReplyReason":"r","summary":"S","urgencyScore":3,"urgencyReason":"u","actionItems":["a"],"archiveRecommendation":"keep","archiveReason":"ar","draftReply":null}`

describe('tryParseAnalysis', () => {
  it('parses strict JSON', () => {
    const r = tryParseAnalysis(STRICT)
    expect(r?.needsReply).toBe(true)
    expect(r?.summary).toBe('S')
    expect(r?.draftReply).toBeNull()
  })

  it('parses fenced JSON', () => {
    const r = tryParseAnalysis(`Here you go:\n\`\`\`json\n${STRICT}\n\`\`\`\nThanks`)
    expect(r?.summary).toBe('S')
    expect(tryParseAnalysisWithMeta(`\`\`\`json\n${STRICT}\n\`\`\``).meta.strippedFence).toBe(true)
  })

  it('parses prose before JSON', () => {
    const r = tryParseAnalysis(`Okay.\n${STRICT}`)
    expect(r?.urgencyScore).toBe(3)
  })

  it('parses prose after JSON', () => {
    const r = tryParseAnalysis(`${STRICT}\n\nHope this helps.`)
    expect(r?.summary).toBe('S')
  })

  it('repairs trailing commas when safe', () => {
    const raw = STRICT.replace('"draftReply":null', '"draftReply":null,')
    const r = tryParseAnalysis(raw)
    expect(r?.needsReply).toBe(true)
    expect(tryParseAnalysisWithMeta(raw).meta.usedTrailingCommaRepair).toBe(true)
  })

  it('fails on unrecoverable truncation', () => {
    const truncated = '{"needsReply":true,"summary":"'
    expect(tryParseAnalysis(truncated)).toBeNull()
  })

  it('parses native BEAP draftReplyPublic / draftReplyFull', () => {
    const j = JSON.stringify({
      needsReply: false,
      summary: 'x',
      draftReplyPublic: 'pub',
      draftReplyFull: 'full',
    })
    const r = tryParseAnalysis(j)
    expect(r?.draftReply).toEqual({ publicMessage: 'pub', encryptedMessage: 'full' })
  })

  it('parses generic draftReply string', () => {
    const j = JSON.stringify({
      needsReply: false,
      summary: 'x',
      draftReply: 'hello',
    })
    const r = tryParseAnalysis(j)
    expect(r?.draftReply).toBe('hello')
  })
})

describe('tryParsePartialAnalysis draft ordering', () => {
  it('prefers draftReplyPublic over draftReply when both appear early', () => {
    const text =
      '{"draftReplyPublic":"pub preview","draftReply":"should not win","draftReplyFull":"","summary":"s"'
    const p = tryParsePartialAnalysis(text)
    expect(p?.partial.draftReply).toEqual(
      expect.objectContaining({ publicMessage: 'pub preview', encryptedMessage: '' }),
    )
  })
})

describe('extractBalancedJsonObject', () => {
  it('extracts object when trailing prose exists', () => {
    const inner = extractBalancedJsonObject(`prefix {"a":1} suffix`)
    expect(inner).toBe('{"a":1}')
  })
})

describe('repairTrailingCommasInJson', () => {
  it('removes comma before closing brace', () => {
    expect(repairTrailingCommasInJson('{ "a": 1, }')).toBe('{ "a": 1 }')
  })
})
