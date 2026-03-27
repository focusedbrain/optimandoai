import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CapsuleAttachment } from '../canonical-types'

vi.mock('../parserService', () => ({
  processAttachmentForParsing: vi.fn(),
}))

import { processAttachmentForParsing } from '../parserService'
import { runDraftAttachmentParseWithFallback, draftAttachmentParseRejectedUpdate } from '../draftAttachmentAutoParse'

const capsule: CapsuleAttachment = {
  id: 'a1',
  originalName: 'x.pdf',
  originalSize: 1,
  originalType: 'application/pdf',
  semanticContent: null,
  semanticExtracted: false,
  encryptedRef: 'encrypted_a1',
  encryptedHash: '',
  previewRef: null,
  rasterProof: null,
  isMedia: false,
  hasTranscript: false,
}

describe('runDraftAttachmentParseWithFallback', () => {
  beforeEach(() => {
    vi.mocked(processAttachmentForParsing).mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clears parsing when processAttachmentForParsing rejects (no throw)', async () => {
    vi.mocked(processAttachmentForParsing).mockRejectedValueOnce(new Error('parse pipeline boom'))
    const r = await runDraftAttachmentParseWithFallback({
      id: 'd1',
      dataBase64: 'abc',
      capsuleAttachment: capsule,
    })
    expect(r.processing.parsing).toBe(false)
    expect(r.processing.rasterizing).toBe(false)
    expect(r.processing.error).toContain('parse pipeline boom')
  })

  it('draftAttachmentParseRejectedUpdate maps unknown rejection to a message', () => {
    const u = draftAttachmentParseRejectedUpdate(
      { id: 'd1', dataBase64: '', capsuleAttachment: capsule },
      404,
    )
    expect(u.processing.parsing).toBe(false)
    expect(u.processing.error).toBe('Attachment parsing failed')
  })
})
