/**
 * Workstream 3 — consent tokens, structural hash, ingest consent_required.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import {
  issuePdfExtractionConsentToken,
  verifyPdfExtractionConsentToken,
  hashConsentTokenForAudit,
  _setPdfConsentSessionSecretForTests,
} from '../pdfConsentToken.js'
import {
  computeStructuralHash,
  verifyExtractedTextStructuralHash,
} from '../pdfStructuralHash.js'
import {
  verifyEdgeExtractedTextV1,
  edgeExtractedTextSha256,
} from '../capsuleExtractedText.js'

describe('pdfConsentToken', () => {
  it('issues and verifies session-scoped consent token', () => {
    _setPdfConsentSessionSecretForTests(Buffer.alloc(32, 0xab))
    const { token } = issuePdfExtractionConsentToken('msg-1', 'att-1')
    expect(verifyPdfExtractionConsentToken(token, 'msg-1', 'att-1')).toBe(true)
    expect(verifyPdfExtractionConsentToken(token, 'msg-2', 'att-1')).toBe(false)
    expect(hashConsentTokenForAudit(token)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pdfStructuralHash', () => {
  it('verifies text against structural hash', () => {
    const pages = ['Hello', 'World']
    const hash = computeStructuralHash(pages)
    expect(verifyExtractedTextStructuralHash('Hello\n\nWorld', hash)).toBe(true)
    expect(verifyExtractedTextStructuralHash('tampered', hash)).toBe(false)
  })
})

describe('applyEdgePodAttachmentsToAttMetas', () => {
  it('stores edge_extracted status when extracted_text_v1 verifies', async () => {
    const { applyEdgePodAttachmentsToAttMetas } = await import('../capsuleExtractedText.js')
    const text = 'Edge line one'
    const hash = computeStructuralHash([text])
    const metas = [
      {
        attId: 'att-store-1',
        att: { id: 'prov-1', contentType: 'application/pdf', filename: 'a.pdf' },
        extractedText: null as string | null,
        extractionStatus: 'consent_required' as string | null,
        extractionError: null as string | null,
        extractedTextSha256: null as string | null,
      },
    ]
    applyEdgePodAttachmentsToAttMetas(
      metas,
      [
        {
          id: 'prov-1',
          extracted_text_v1: {
            text,
            structural_hash: hash,
            extractor_version: 'beap-pdf-extract-v1',
          },
        },
      ],
      'msg-1',
      (_inboxId, providerId) => `att-${providerId}`,
    )
    expect(metas[0]?.extractionStatus).toBe('edge_extracted')
    expect(metas[0]?.extractedText).toBe(text)
    expect(metas[0]?.extractionError).toBeNull()
  })
})

describe('capsuleExtractedText edge path', () => {
  it('accepts verified edge extracted_text_v1', () => {
    const text = 'Edge extracted line'
    const hash = computeStructuralHash([text])
    const v1 = { text, structural_hash: hash, extractor_version: 'beap-pdf-extract-v1' }
    expect(verifyEdgeExtractedTextV1(v1)).toBe(true)
    expect(edgeExtractedTextSha256(text)).toBe(
      createHash('sha256').update(text, 'utf8').digest('hex'),
    )
  })
})
