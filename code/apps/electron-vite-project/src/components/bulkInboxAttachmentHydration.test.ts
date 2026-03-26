import { describe, it, expect } from 'vitest'
import {
  hydrationAfterGetMessageSuccess,
  hydrationAfterGetMessageIpcError,
  hydrationAfterGetMessageReject,
} from './bulkInboxAttachmentHydration'
import type { InboxAttachment } from '../stores/useEmailInboxStore'

const att = (id: string): InboxAttachment => ({
  id,
  message_id: 'm1',
  filename: 'f',
  content_type: 'text/plain',
  size_bytes: 1,
  content_id: null,
  storage_path: null,
  extracted_text: null,
  text_extraction_status: null,
  raster_path: null,
})

describe('bulkInboxAttachmentHydration', () => {
  it('treats ok response with empty attachment list as terminal empty (not perpetual loading)', () => {
    const h = hydrationAfterGetMessageSuccess([])
    expect(h.phase).toBe('empty')
  })

  it('maps loaded attachments', () => {
    const list = [att('a')]
    const h = hydrationAfterGetMessageSuccess(list)
    expect(h.phase).toBe('loaded')
    if (h.phase === 'loaded') expect(h.attachments).toEqual(list)
  })

  it('maps IPC !ok to error with fallback message', () => {
    const h = hydrationAfterGetMessageIpcError(null)
    expect(h.phase).toBe('error')
    if (h.phase === 'error') expect(h.message).toMatch(/Could not load/)
  })

  it('maps rejection to error', () => {
    const h = hydrationAfterGetMessageReject(new Error('IPC failed'))
    expect(h.phase).toBe('error')
    if (h.phase === 'error') expect(h.message).toBe('IPC failed')
  })
})
