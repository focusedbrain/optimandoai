/**
 * Parser Service Tests
 * 
 * Tests for PDF text extraction and security invariants.
 * 
 * SECURITY INVARIANTS TESTED:
 * - Semantic content never appears in transport text
 * - Parser results are capsule-bound only
 * - No transport leakage
 * 
 * @version 1.0.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isParseableFormat,
  assertNoSemanticContentInTransport,
  getSafeAttachmentInfo,
  processAttachmentForParsing,
  processAttachmentForRasterization
} from '../parserService'
import type { CapsuleAttachment } from '../canonical-types'

// =============================================================================
// Test Fixtures
// =============================================================================

const createMockAttachment = (overrides: Partial<CapsuleAttachment> = {}): CapsuleAttachment => ({
  id: 'test-attachment-1',
  originalName: 'test.pdf',
  originalSize: 1024,
  originalType: 'application/pdf',
  semanticContent: null,
  semanticExtracted: false,
  encryptedRef: 'encrypted_abc123',
  encryptedHash: 'hash123',
  previewRef: null,
  rasterProof: null,
  isMedia: false,
  hasTranscript: false,
  ...overrides
})

// =============================================================================
// Format Detection Tests
// =============================================================================

describe('isParseableFormat', () => {
  it('should return true for PDF files', () => {
    expect(isParseableFormat('application/pdf')).toBe(true)
  })

  it('should return false for non-PDF files', () => {
    expect(isParseableFormat('application/msword')).toBe(false)
    expect(isParseableFormat('image/png')).toBe(false)
    expect(isParseableFormat('text/plain')).toBe(false)
    expect(isParseableFormat('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
  })

  it('should be case-insensitive', () => {
    // The implementation uses .toLowerCase(), so it IS case-insensitive
    expect(isParseableFormat('APPLICATION/PDF')).toBe(true)
    expect(isParseableFormat('application/pdf')).toBe(true)
    expect(isParseableFormat('Application/Pdf')).toBe(true)
  })
})

// =============================================================================
// Security Invariant Tests
// =============================================================================

describe('assertNoSemanticContentInTransport', () => {
  it('should pass when no semantic content exists', () => {
    const attachments = [createMockAttachment({ semanticContent: null })]
    expect(() => {
      assertNoSemanticContentInTransport('Hello world', attachments)
    }).not.toThrow()
  })

  it('should pass when semantic content is short (under 50 chars)', () => {
    const attachments = [createMockAttachment({ semanticContent: 'Short text' })]
    expect(() => {
      assertNoSemanticContentInTransport('Hello world', attachments)
    }).not.toThrow()
  })

  it('should pass when semantic content is not in transport text', () => {
    const semanticContent = 'This is extracted PDF content that should never appear in transport. It contains sensitive information from the document.'
    const attachments = [createMockAttachment({ semanticContent })]
    expect(() => {
      assertNoSemanticContentInTransport('Hello, please see the attached document.', attachments)
    }).not.toThrow()
  })

  it('should THROW when semantic content appears in transport text', () => {
    const semanticContent = 'This is extracted PDF content that should never appear in transport. It contains sensitive information from the document.'
    const attachments = [createMockAttachment({ semanticContent })]
    
    // Transport text contains the semantic content - this is a security violation!
    const transportText = `Here is the document content: ${semanticContent}`
    
    expect(() => {
      assertNoSemanticContentInTransport(transportText, attachments)
    }).toThrow('SECURITY')
  })

  it('should check all attachments', () => {
    const attachments = [
      createMockAttachment({ 
        id: 'att1',
        semanticContent: 'First document content that is long enough to be checked by the security validator.' 
      }),
      createMockAttachment({ 
        id: 'att2',
        semanticContent: 'Second document content that should also be validated for transport leakage violations.' 
      })
    ]
    
    // Second attachment content in transport
    const transportText = 'Here is: Second document content that should also be validated for transport leakage violations.'
    
    expect(() => {
      assertNoSemanticContentInTransport(transportText, attachments)
    }).toThrow('SECURITY')
  })

  it('should handle empty attachment arrays', () => {
    expect(() => {
      assertNoSemanticContentInTransport('Any text', [])
    }).not.toThrow()
  })
})

// =============================================================================
// Safe Logging Tests
// =============================================================================

describe('getSafeAttachmentInfo', () => {
  it('should not include semantic content in output', () => {
    const attachment = createMockAttachment({
      semanticContent: 'SECRET_CONTENT_THAT_SHOULD_NOT_BE_LOGGED',
      semanticExtracted: true
    })
    
    const safeInfo = getSafeAttachmentInfo(attachment)
    
    // Check that semantic content is NOT in the output
    expect(JSON.stringify(safeInfo)).not.toContain('SECRET_CONTENT')
    
    // Check that safe fields are present
    expect(safeInfo.id).toBe(attachment.id)
    expect(safeInfo.name).toBe(attachment.originalName)
    expect(safeInfo.size).toBe(attachment.originalSize)
    expect(safeInfo.type).toBe(attachment.originalType)
    expect(safeInfo.extracted).toBe(true)
    expect(safeInfo.contentLength).toBe(attachment.semanticContent!.length)
  })

  it('should report correct content length', () => {
    const attachment = createMockAttachment({
      semanticContent: 'A'.repeat(1000),
      semanticExtracted: true
    })
    
    const safeInfo = getSafeAttachmentInfo(attachment)
    expect(safeInfo.contentLength).toBe(1000)
  })

  it('should handle null semantic content', () => {
    const attachment = createMockAttachment({
      semanticContent: null,
      semanticExtracted: false
    })
    
    const safeInfo = getSafeAttachmentInfo(attachment)
    expect(safeInfo.extracted).toBe(false)
    expect(safeInfo.contentLength).toBe(0)
  })
})

// =============================================================================
// Parser Integration Tests (mocked fetch)
// =============================================================================

describe('processAttachmentForParsing', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should return unchanged attachment for non-PDF files', async () => {
    const attachment = createMockAttachment({ originalType: 'image/png' })
    
    const result = await processAttachmentForParsing(attachment, 'base64data')
    
    expect(result.attachment).toEqual(attachment)
    expect(result.provenance).toBeNull()
    expect(result.error).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should call parser API for PDF files', async () => {
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const base64Data = 'JVBERi0xLjQK...'
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        pageCount: 5,
        pagesProcessed: 5,
        extractedText: 'Parsed PDF content goes here.',
        truncated: false,
        parser: { engine: 'pdfjs', version: '4.4.168' }
      })
    })
    
    const result = await processAttachmentForParsing(attachment, base64Data)
    
    expect(result.attachment.semanticContent).toBe('Parsed PDF content goes here.')
    expect(result.attachment.semanticExtracted).toBe(true)
    expect(result.provenance).toEqual({
      engine: 'pdfjs',
      version: '4.4.168',
      extractedAt: expect.any(Number),
      truncated: false
    })
    expect(result.error).toBeNull()
    
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:51248/api/parser/pdf/extract',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentId: attachment.id, base64: base64Data })
      })
    )
  })

  it('should handle parser API failure gracefully', async () => {
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: false,
        error: 'PDF parsing failed: invalid format'
      })
    })
    
    const result = await processAttachmentForParsing(attachment, 'invaliddata')
    
    expect(result.attachment.semanticContent).toBeNull()
    expect(result.attachment.semanticExtracted).toBe(false)
    expect(result.provenance).toBeNull()
    expect(result.error).toBe('PDF parsing failed: invalid format')
  })

  it('should handle network errors gracefully', async () => {
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    
    fetchMock.mockRejectedValueOnce(new Error('Network error: Electron not running'))
    
    const result = await processAttachmentForParsing(attachment, 'base64data')
    
    expect(result.attachment.semanticContent).toBeNull()
    expect(result.attachment.semanticExtracted).toBe(false)
    expect(result.error).toBe('Network error: Electron not running')
  })

  it('should handle truncated results', async () => {
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        pageCount: 500,
        pagesProcessed: 300,
        extractedText: '[TRUNCATED: Only first 300 of 500 pages processed]\n\nContent...',
        truncated: true,
        parser: { engine: 'pdfjs', version: '4.4.168' }
      })
    })
    
    const result = await processAttachmentForParsing(attachment, 'largepdf')
    
    expect(result.attachment.semanticExtracted).toBe(true)
    expect(result.attachment.semanticContent).toContain('[TRUNCATED')
    expect(result.provenance?.truncated).toBe(true)
  })
})

// =============================================================================
// Determinism Tests
// =============================================================================

describe('Parser Determinism', () => {
  it('should produce same output for same input (mocked)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    
    // Same response for same input
    const consistentResponse = {
      success: true,
      pageCount: 3,
      pagesProcessed: 3,
      extractedText: 'Deterministic output text.',
      truncated: false,
      parser: { engine: 'pdfjs', version: '4.4.168' }
    }
    
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(consistentResponse)
    })
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const base64 = 'sameInputData'
    
    const result1 = await processAttachmentForParsing(attachment, base64)
    const result2 = await processAttachmentForParsing(attachment, base64)
    
    expect(result1.attachment.semanticContent).toBe(result2.attachment.semanticContent)
    expect(result1.provenance?.engine).toBe(result2.provenance?.engine)
    expect(result1.provenance?.version).toBe(result2.provenance?.version)
    
    vi.unstubAllGlobals()
  })
})

// =============================================================================
// PDF Rasterization Tests
// =============================================================================describe('processAttachmentForRasterization', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  
  it('should rasterize a 1-page PDF and return hashes/refs', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        pageCount: 1,
        pagesRasterized: 1,
        pages: [{
          page: 1,
          width: 850,
          height: 1100,
          bytes: 45678,
          sha256: 'abc123def456',
          artefactRef: 'raster_test_p1_abc123.webp'
        }],
        raster: { engine: 'pdfjs', version: '4.10.38', dpi: 144 }
      })
    } as Response)
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const result = await processAttachmentForRasterization(attachment, 'base64pdf', 144)
    
    expect(result.error).toBeNull()
    expect(result.rasterProof).not.toBeNull()
    expect(result.rasterProof?.pagesRasterized).toBe(1)
    expect(result.rasterProof?.pages[0].sha256).toBe('abc123def456')
    expect(result.rasterProof?.pages[0].artefactRef).toBe('raster_test_p1_abc123.webp')
    expect(result.rasterProof?.pages[0].bytes).toBe(45678)
    expect(result.attachment.previewRef).toBe('raster_test_p1_abc123.webp')
  })
  
  it('should enforce limits (mocked response shows truncation)', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        pageCount: 100,
        pagesRasterized: 50, // Limited by MAX_PAGES
        pages: Array.from({ length: 50 }, (_, i) => ({
          page: i + 1,
          width: 850,
          height: 1100,
          bytes: 45000 + i * 100,
          sha256: `hash_page_${i + 1}`,
          artefactRef: `raster_test_p${i + 1}_hash.webp`
        })),
        raster: { engine: 'pdfjs', version: '4.10.38', dpi: 144 }
      })
    } as Response)
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const result = await processAttachmentForRasterization(attachment, 'largepdf', 144)
    
    expect(result.error).toBeNull()
    expect(result.rasterProof?.pageCount).toBe(100)
    expect(result.rasterProof?.pagesRasterized).toBe(50)
    expect(result.rasterProof?.pages.length).toBe(50)
  })
  
  it('should return hashes, refs, and sizes, never image bytes', async () => {
    const fetchMock = vi.mocked(fetch)
    const mockResponse = {
      success: true,
      pageCount: 1,
      pagesRasterized: 1,
      pages: [{
        page: 1,
        width: 850,
        height: 1100,
        bytes: 45678,  // WEBP file size in bytes (not the actual image data)
        sha256: 'abc123def456',
        artefactRef: 'raster_test_p1_abc123.webp'
        // Note: NO webpBytes, imageData, or any binary content
      }],
      raster: { engine: 'pdfjs', version: '4.10.38', dpi: 144 }
    }
    
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse)
    } as Response)
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const result = await processAttachmentForRasterization(attachment, 'base64pdf')
    
    // Verify response structure contains refs/hashes/sizes but NO image data
    expect(result.rasterProof?.pages[0]).toHaveProperty('sha256')
    expect(result.rasterProof?.pages[0]).toHaveProperty('artefactRef')
    expect(result.rasterProof?.pages[0]).toHaveProperty('bytes')
    expect(result.rasterProof?.pages[0]).not.toHaveProperty('pngBytes')
    expect(result.rasterProof?.pages[0]).not.toHaveProperty('imageData')
    expect(result.rasterProof?.pages[0]).not.toHaveProperty('base64')
  })
  
  it('should reject non-PDF files', async () => {
    const attachment = createMockAttachment({ originalType: 'image/png' })
    const result = await processAttachmentForRasterization(attachment, 'base64png')
    
    expect(result.error).toBe('Only PDF files can be rasterized')
    expect(result.rasterProof).toBeNull()
  })

  it('should return structured error when maxPages exceeded', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        success: false,
        error: 'PDF has 500 pages, exceeds limit of 300',
        code: 'MAX_PAGES_EXCEEDED'
      })
    } as Response)
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const result = await processAttachmentForRasterization(attachment, 'hugepdf', 144)
    
    expect(result.rasterProof).toBeNull()
    expect(result.error).toContain('500 pages')
    expect(result.error).toContain('exceeds limit')
  })

  it('should return structured error when maxTotalPixels exceeded', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        success: false,
        error: 'Total pixels would exceed limit at page 150',
        code: 'MAX_TOTAL_PIXELS_EXCEEDED',
        processedPages: 149
      })
    } as Response)
    
    const attachment = createMockAttachment({ originalType: 'application/pdf' })
    const result = await processAttachmentForRasterization(attachment, 'highrespdf', 300)
    
    expect(result.rasterProof).toBeNull()
    expect(result.error).toContain('Total pixels')
    expect(result.error).toContain('exceed limit')
  })
})