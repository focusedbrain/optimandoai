import { describe, it, expect } from 'vitest'
import {
  formatOversizeAttachmentRejection,
  MAX_BEAP_DRAFT_ATTACHMENT_BYTES,
} from '../attachmentPickerLimits'

describe('attachmentPickerLimits', () => {
  it('MAX_BEAP_DRAFT_ATTACHMENT_BYTES is 10 MiB', () => {
    expect(MAX_BEAP_DRAFT_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })

  it('single file rejection names the file and limit', () => {
    const s = formatOversizeAttachmentRejection(['huge.pdf'])
    expect(s).toContain('huge.pdf')
    expect(s).toContain('10 MB')
    expect(s).toMatch(/Not attached/i)
  })

  it('aggregates multiple rejected files', () => {
    const s = formatOversizeAttachmentRejection(['a.pdf', 'b.pdf'])
    expect(s).toContain('2 files')
    expect(s).toContain('a.pdf')
    expect(s).toContain('b.pdf')
  })
})
