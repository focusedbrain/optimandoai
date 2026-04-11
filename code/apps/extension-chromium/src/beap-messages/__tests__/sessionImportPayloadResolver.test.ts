import { describe, it, expect } from 'vitest'
import type { BeapMessage, BeapAttachment } from '../beapInboxTypes'
import {
  resolveBeapSessionImportPayload,
  beapSessionImportActionsEnabled,
  sessionJsonHasImportableSubstance,
} from '../sessionImportPayloadResolver'

function baseAttachment(overrides: Partial<BeapAttachment> = {}): BeapAttachment {
  return {
    attachmentId: 'att-1',
    filename: 'session.json',
    mimeType: 'application/json',
    sizeBytes: 100,
    selected: false,
    ...overrides,
  }
}

function baseMessage(overrides: Partial<BeapMessage> = {}): BeapMessage {
  return {
    messageId: 'm1',
    senderFingerprint: 'ab',
    senderEmail: 'a@b.com',
    handshakeId: null,
    trustLevel: 'standard',
    messageBody: '',
    canonicalContent: 'not json {',
    attachments: [],
    automationTags: [],
    processingEvents: null,
    timestamp: 1,
    receivedAt: 1,
    isRead: false,
    urgency: 'normal',
    archived: false,
    ...overrides,
  }
}

const minimalV1Export = {
  version: '1.0.0',
  tabName: 'Test',
  agentBoxes: [{ id: 'b1', identifier: 'x' }],
  agents: [],
  uiState: {},
}

describe('sessionImportPayloadResolver', () => {
  it('returns valid for v1.0.0 JSON in attachment semanticContent (any filename)', () => {
    const msg = baseMessage({
      attachments: [
        baseAttachment({
          filename: 'unknown.bin',
          mimeType: 'application/octet-stream',
          semanticContent: JSON.stringify(minimalV1Export),
        }),
      ],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.normalized.isExportFormat).toBe(true)
      expect(r.rawPayload.version).toBe('1.0.0')
      expect(beapSessionImportActionsEnabled(r)).toBe(true)
    }
  })

  it('returns valid for legacy session JSON with likely filename', () => {
    const legacy = {
      tabName: 'L',
      agentBoxes: [],
      agents: [{ name: 'A', model: 'm' }],
    }
    const msg = baseMessage({
      attachments: [
        baseAttachment({
          filename: 'my-session.json',
          semanticContent: JSON.stringify(legacy),
        }),
      ],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('valid')
    if (r.status === 'valid') {
      expect(r.normalized.isExportFormat).toBe(false)
    }
  })

  it('returns none for legacy JSON on non-hint filename (no v1)', () => {
    const legacy = {
      tabName: 'L',
      agents: [{ name: 'A' }],
    }
    const msg = baseMessage({
      attachments: [
        baseAttachment({
          filename: 'notes.txt',
          mimeType: 'text/plain',
          semanticContent: JSON.stringify(legacy),
        }),
      ],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('none')
    expect(beapSessionImportActionsEnabled(r)).toBe(false)
  })

  it('returns invalid when JSON parses but has no importable substance', () => {
    const msg = baseMessage({
      attachments: [
        baseAttachment({
          filename: 'session.json',
          semanticContent: JSON.stringify({ version: '1.0.0', agentBoxes: [], agents: [] }),
        }),
      ],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') {
      expect(r.code).toBe('insufficient_substance')
    }
  })

  it('returns invalid json_parse_error for broken JSON on .json attachment', () => {
    const msg = baseMessage({
      attachments: [
        baseAttachment({
          filename: 'session.json',
          semanticContent: '{ not json',
        }),
      ],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('invalid')
    if (r.status === 'invalid') {
      expect(r.code).toBe('json_parse_error')
    }
  })

  it('returns none when there are no attachments', () => {
    const r = resolveBeapSessionImportPayload(baseMessage({ attachments: [] }))
    expect(r.status).toBe('none')
    if (r.status === 'none') {
      expect(r.code).toBe('no_candidate_attachment')
    }
  })

  it('returns none when semanticContent is missing', () => {
    const msg = baseMessage({
      attachments: [baseAttachment({ semanticContent: undefined })],
    })
    const r = resolveBeapSessionImportPayload(msg)
    expect(r.status).toBe('none')
    if (r.status === 'none') {
      expect(r.code).toBe('no_semantic_content')
    }
  })

  it('sessionJsonHasImportableSubstance matches agentBoxes', () => {
    expect(sessionJsonHasImportableSubstance({ agentBoxes: [{}] })).toBe(true)
    expect(sessionJsonHasImportableSubstance({ agentBoxes: [] })).toBe(false)
  })
})
