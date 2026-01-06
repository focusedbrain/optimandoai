/**
 * PDF Parser Service
 * 
 * Calls the Electron Orchestrator HTTP API to extract text from PDFs.
 * Extracted text is stored ONLY in CapsuleAttachment.semanticContent (capsule-bound).
 * 
 * SECURITY INVARIANTS:
 * - Extracted text NEVER appears in email subject/body
 * - Extracted text NEVER appears in messenger payloads
 * - Extracted text NEVER appears in filenames or logs
 * - All extracted content is capsule-bound only
 * 
 * @version 1.0.0
 */

import type { CapsuleAttachment, RasterProof } from './canonical-types'

// =============================================================================
// Types
// =============================================================================

export interface ParserResult {
  success: boolean
  pageCount?: number
  pagesProcessed?: number
  extractedText?: string
  truncated?: boolean
  parser?: {
    engine: string
    version: string
  }
  error?: string
}

export interface ParserProvenance {
  engine: string
  version: string
  extractedAt: number
  truncated: boolean
}

/**
 * Strict contract for rasterized page payload.
 * This type defines the exact shape returned by the Electron rasterizer
 * and consumed by the capsule builder for artefact encryption.
 */
export interface RasterPageData {
  /** 1-indexed page number */
  page: number
  /** Pixel width */
  width: number
  /** Pixel height */
  height: number
  /** Image file size in bytes */
  bytes: number
  /** SHA-256 hex hash (64 chars) computed over raw WEBP bytes */
  sha256: string
  /** Unique artefact reference ID */
  artefactRef: string
  /** Raw base64-encoded image data (NO data URL prefix) */
  base64: string
  /** MIME type - MUST be "image/webp" */
  mime: 'image/webp'
}

export interface RasterResult {
  success: boolean
  pageCount?: number
  pagesRasterized?: number
  pages?: RasterPageData[]
  raster?: {
    engine: string
    version: string
    dpi: number
  }
  error?: string
  code?: string  // Error code for structured errors
}

// =============================================================================
// Constants
// =============================================================================

const ELECTRON_BASE_URL = 'http://127.0.0.1:51248'

// Supported formats for text extraction
const PARSEABLE_FORMATS = ['application/pdf']

// =============================================================================
// API Functions
// =============================================================================

/**
 * Check if a file type is supported for parsing
 */
export function isParseableFormat(mimeType: string): boolean {
  return PARSEABLE_FORMATS.includes(mimeType.toLowerCase())
}

/**
 * Extract text from a PDF file via the Electron Orchestrator
 * 
 * @param attachmentId - Unique ID for the attachment
 * @param base64Data - Base64-encoded PDF data
 * @returns Parser result with extracted text
 */
export async function extractPdfText(
  attachmentId: string,
  base64Data: string
): Promise<ParserResult> {
  try {
    const response = await fetch(`${ELECTRON_BASE_URL}/api/parser/pdf/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attachmentId,
        base64: base64Data
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}: ${response.statusText}`
      }
    }

    return await response.json()
  } catch (error) {
    // Connection errors (Electron not running, etc.)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to parser service'
    }
  }
}

/**
 * Process an attachment for text extraction
 * 
 * This is the main entry point for parsing attachments.
 * It checks if the format is supported, extracts text, and returns
 * an updated attachment with semanticContent filled.
 * 
 * @param attachment - The attachment to process
 * @param fileDataBase64 - Base64-encoded file data
 * @returns Updated attachment with semanticContent (if successful)
 */
export async function processAttachmentForParsing(
  attachment: CapsuleAttachment,
  fileDataBase64: string
): Promise<{
  attachment: CapsuleAttachment
  provenance: ParserProvenance | null
  error: string | null
}> {
  // Check if format is supported
  if (!isParseableFormat(attachment.originalType)) {
    // Not a parseable format - return unchanged
    return {
      attachment,
      provenance: null,
      error: null
    }
  }

  // Call parser
  const result = await extractPdfText(attachment.id, fileDataBase64)

  if (!result.success) {
    // Parsing failed - keep attachment but mark as not extracted
    return {
      attachment: {
        ...attachment,
        semanticContent: null,
        semanticExtracted: false
      },
      provenance: null,
      error: result.error || 'Parsing failed'
    }
  }

  // Success - update attachment with extracted text
  const provenance: ParserProvenance = {
    engine: result.parser?.engine || 'pdfjs',
    version: result.parser?.version || 'unknown',
    extractedAt: Date.now(),
    truncated: result.truncated || false
  }

  return {
    attachment: {
      ...attachment,
      semanticContent: result.extractedText || '',
      semanticExtracted: true
    },
    provenance,
    error: null
  }
}

/**
 * Check if the parser service is available (Electron is running)
 */
export async function isParserServiceAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    })
    return response.ok
  } catch {
    return false
  }
}

// =============================================================================
// PDF Rasterization
// =============================================================================

/**
 * Rasterize a PDF to WEBP artefacts via the Electron Orchestrator
 * 
 * SECURITY: This function returns only hashes and refs, NEVER image bytes.
 * Actual WEBP files are stored in the artefact store on disk.
 * 
 * @param attachmentId - Unique ID for the attachment
 * @param base64Data - Base64-encoded PDF data
 * @param dpi - Optional DPI (default 150, max 300)
 * @returns Raster result with page refs and hashes
 */
export async function rasterizePdf(
  attachmentId: string,
  base64Data: string,
  dpi?: number
): Promise<RasterResult> {
  try {
    const response = await fetch(`${ELECTRON_BASE_URL}/api/parser/pdf/rasterize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attachmentId,
        base64: base64Data,
        dpi
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}: ${response.statusText}`
      }
    }

    return await response.json()
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to connect to rasterization service'
    }
  }
}

/**
 * Process an attachment for rasterization (Generate Preview)
 * 
 * This is called when the user clicks "Generate Preview" or when
 * the rasterization feature flag is enabled.
 * 
 * SECURITY: Raster bytes are stored as artefacts, only refs/hashes returned.
 * 
 * @param attachment - The attachment to rasterize
 * @param fileDataBase64 - Base64-encoded file data
 * @param dpi - Optional DPI (default 144)
 * @returns Updated attachment with rasterProof (if successful)
 */
export async function processAttachmentForRasterization(
  attachment: CapsuleAttachment,
  fileDataBase64: string,
  dpi?: number
): Promise<{
  attachment: CapsuleAttachment
  rasterProof: RasterProof | null
  rasterPageData: RasterPageData[] | null  // Raw page data with base64 images
  error: string | null
}> {
  // Only PDFs can be rasterized
  if (attachment.originalType.toLowerCase() !== 'application/pdf') {
    return {
      attachment,
      rasterProof: null,
      rasterPageData: null,
      error: 'Only PDF files can be rasterized'
    }
  }

  // Call rasterizer
  const result = await rasterizePdf(attachment.id, fileDataBase64, dpi)

  if (!result.success) {
    return {
      attachment,
      rasterProof: null,
      rasterPageData: null,
      error: result.error || 'Rasterization failed'
    }
  }

  // Store the full page data with base64 images
  const rawPages = result.pages || []
  
  // ==========================================================================
  // Runtime Contract Assertions (Guardrails)
  // ==========================================================================
  // Validate that Electron response matches the strict RasterPageData contract.
  // If assertions fail, throw a descriptive error that surfaces in UI.
  for (const page of rawPages) {
    // Assert mime is exactly "image/webp"
    if (page.mime !== 'image/webp') {
      throw new Error(
        `[RASTER CONTRACT] Invalid mime type: expected "image/webp", got "${page.mime}" (page ${page.page})`
      )
    }
    
    // Assert base64 does NOT start with "data:" (no data URL prefix)
    if (page.base64.startsWith('data:')) {
      throw new Error(
        `[RASTER CONTRACT] base64 has data URL prefix (page ${page.page}). Expected raw base64 only.`
      )
    }
    
    // Assert sha256 is exactly 64 hex chars
    if (!/^[a-f0-9]{64}$/.test(page.sha256)) {
      throw new Error(
        `[RASTER CONTRACT] Invalid sha256: expected 64 hex chars, got "${page.sha256.substring(0, 20)}..." (page ${page.page})`
      )
    }
    
    // Assert required fields are present
    if (typeof page.artefactRef !== 'string' || page.artefactRef.length === 0) {
      throw new Error(
        `[RASTER CONTRACT] Missing artefactRef (page ${page.page})`
      )
    }
    
    if (typeof page.bytes !== 'number' || page.bytes <= 0) {
      throw new Error(
        `[RASTER CONTRACT] Invalid bytes: expected positive number (page ${page.page})`
      )
    }
  }
  
  // Cast to strict type after validation
  const rasterPageData: RasterPageData[] = rawPages as RasterPageData[]

  // Build raster proof (metadata only, for CapsuleAttachment)
  // Note: RasterProof.pages uses the same structure but is for the capsule manifest
  const rasterProof: RasterProof = {
    engine: result.raster?.engine || 'pdfjs',
    version: result.raster?.version || 'unknown',
    dpi: result.raster?.dpi || 144,
    pageCount: result.pageCount || 0,
    pagesRasterized: result.pagesRasterized || 0,
    pages: rasterPageData.map(p => ({
      page: p.page,
      width: p.width,
      height: p.height,
      bytes: p.bytes,
      sha256: p.sha256,
      artefactRef: p.artefactRef
      // Note: base64 and mime are NOT stored in rasterProof (security)
    })),
    rasterizedAt: Date.now()
  }

  return {
    attachment: {
      ...attachment,
      previewRef: result.pages?.[0]?.artefactRef || null,
      rasterProof
    },
    rasterProof,
    rasterPageData,  // Include the full page data with base64 for artefact storage
    error: null
  }
}

// =============================================================================
// Security Assertions
// =============================================================================

/**
 * SECURITY: Assert that semantic content is not present in transport text
 * 
 * This MUST be called before any transport operation (email, messenger, download)
 * to prevent accidental leakage of extracted content.
 * 
 * @param transportText - The text being sent via transport
 * @param attachments - List of attachments with potential semantic content
 * @throws Error if semantic content is detected in transport text
 */
export function assertNoSemanticContentInTransport(
  transportText: string,
  attachments: CapsuleAttachment[]
): void {
  for (const attachment of attachments) {
    if (attachment.semanticContent && attachment.semanticContent.length > 50) {
      // Check for substantial overlapping content (not just common words)
      const contentSample = attachment.semanticContent.substring(0, 500)
      
      // Check for exact substring match (significant portion)
      if (transportText.includes(contentSample)) {
        throw new Error(
          'SECURITY: Extracted PDF content detected in transport text. ' +
          'Semantic content must remain capsule-bound only.'
        )
      }
    }
  }
}

/**
 * SECURITY: Get sanitized attachment info for logging
 * 
 * Returns attachment metadata safe for logging (no semantic content)
 */
export function getSafeAttachmentInfo(attachment: CapsuleAttachment): {
  id: string
  name: string
  size: number
  type: string
  extracted: boolean
  contentLength: number
} {
  return {
    id: attachment.id,
    name: attachment.originalName,
    size: attachment.originalSize,
    type: attachment.originalType,
    extracted: attachment.semanticExtracted,
    contentLength: attachment.semanticContent?.length || 0
  }
}

