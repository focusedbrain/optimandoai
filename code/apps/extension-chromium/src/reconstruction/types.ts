/**
 * Reconstruction Pipeline Types
 * 
 * Types for post-verification content reconstruction.
 * 
 * This pipeline runs ONLY after a message is Accepted.
 * Produces:
 *   1. Semantic text via Apache Tika
 *   2. Rasterized visual references via PDFium
 *   3. Originals remain encrypted
 * 
 * @version 1.0.0
 */

// =============================================================================
// Reconstruction States
// =============================================================================

/**
 * Reconstruction state
 */
export type ReconstructionState = 'none' | 'running' | 'done' | 'failed'

/**
 * Semantic text source
 */
export type SemanticTextSource = 'tika' | 'transcript' | 'none'

// =============================================================================
// Artefact Types
// =============================================================================

/**
 * Semantic text extracted from an artefact
 */
export interface SemanticTextEntry {
  /** Artefact ID (attachment reference) */
  artefactId: string
  
  /** Extracted text (empty if unavailable) */
  text: string
  
  /** Source of extraction */
  source: SemanticTextSource
  
  /** Whether text was unavailable */
  unavailable: boolean
  
  /** Hash of extracted text for integrity */
  textHash: string
  
  /** MIME type of original */
  mimeType?: string
  
  /** Extraction timestamp */
  extractedAt: number
}

/**
 * Single rasterized page
 */
export interface RasterPage {
  /** Page number (1-indexed) */
  pageNumber: number
  
  /** Data URL or blob reference */
  dataRef: string
  
  /** Width in pixels */
  width: number
  
  /** Height in pixels */
  height: number
  
  /** Format (webp/png) */
  format: 'webp' | 'png'
  
  /** Hash of page image for integrity */
  imageHash: string
}

/**
 * Rasterized references for an artefact
 */
export interface RasterRef {
  /** Artefact ID (attachment reference) */
  artefactId: string
  
  /** Rasterized pages */
  pages: RasterPage[]
  
  /** Output format */
  format: 'webp' | 'png'
  
  /** Total page count */
  totalPages: number
  
  /** Rasterization timestamp */
  rasterizedAt: number
  
  /** Hash of original artefact for binding */
  originalHash: string
}

// =============================================================================
// Reconstruction Record
// =============================================================================

/**
 * Complete reconstruction record for a message
 */
export interface ReconstructionRecord {
  /** Message ID */
  messageId: string
  
  /** Current reconstruction state */
  state: ReconstructionState
  
  /** Error message if failed */
  error?: string
  
  /** Semantic text by artefact */
  semanticTextByArtefact: SemanticTextEntry[]
  
  /** Raster references by artefact */
  rasterRefs: RasterRef[]
  
  /** Reconstruction started at */
  startedAt?: number
  
  /** Reconstruction completed at */
  completedAt?: number
  
  /** Hash of envelope for binding */
  envelopeHash: string
  
  /** Reconstruction version/revision */
  version: number
}

// =============================================================================
// Reconstruction Request/Result
// =============================================================================

/**
 * Request to reconstruct a message
 */
export interface ReconstructionRequest {
  /** Message ID */
  messageId: string
  
  /** Attachments to process */
  attachments: ReconstructionAttachment[]
  
  /** Message body text */
  bodyText?: string
  
  /** Envelope hash for binding */
  envelopeHash: string
}

/**
 * Attachment info for reconstruction
 */
export interface ReconstructionAttachment {
  /** Artefact ID */
  artefactId: string
  
  /** Filename */
  name: string
  
  /** MIME type */
  mimeType: string
  
  /** Size in bytes */
  size: number
  
  /** Reference to encrypted data (not the actual data) */
  encryptedRef: string
  
  /** Hash of original for integrity */
  originalHash: string
}

/**
 * Result of reconstruction
 */
export interface ReconstructionResult {
  /** Whether reconstruction succeeded */
  success: boolean
  
  /** Error message if failed */
  error?: string
  
  /** Semantic text entries */
  semanticTextByArtefact?: SemanticTextEntry[]
  
  /** Raster references */
  rasterRefs?: RasterRef[]
  
  /** Processing duration in ms */
  durationMs?: number
}

// =============================================================================
// Tool Execution Types (isolated process)
// =============================================================================

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
  /** Tool to execute */
  tool: 'tika' | 'pdfium'
  
  /** Input data (base64 or reference) */
  input: string
  
  /** Input MIME type */
  inputMimeType: string
  
  /** Timeout in ms */
  timeoutMs: number
  
  /** Memory limit in MB */
  memoryLimitMb?: number
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  /** Whether execution succeeded */
  success: boolean
  
  /** Exit code */
  exitCode?: number
  
  /** Standard output */
  stdout?: string
  
  /** Standard error */
  stderr?: string
  
  /** Output data (base64 or reference) */
  output?: string
  
  /** Error message if failed */
  error?: string
  
  /** Whether timeout occurred */
  timedOut?: boolean
  
  /** Execution duration in ms */
  durationMs: number
}

// =============================================================================
// Supported Formats
// =============================================================================

/**
 * MIME types supported by Tika for text extraction
 */
export const TIKA_SUPPORTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/html',
  'text/csv',
  'application/rtf',
  'application/epub+zip'
] as const

/**
 * MIME types supported by PDFium for rasterization
 */
export const PDFIUM_SUPPORTED_TYPES = [
  'application/pdf'
] as const

/**
 * Check if MIME type is supported by Tika
 */
export function isTikaSupported(mimeType: string): boolean {
  return TIKA_SUPPORTED_TYPES.includes(mimeType as typeof TIKA_SUPPORTED_TYPES[number])
}

/**
 * Check if MIME type is supported by PDFium
 */
export function isPdfiumSupported(mimeType: string): boolean {
  return PDFIUM_SUPPORTED_TYPES.includes(mimeType as typeof PDFIUM_SUPPORTED_TYPES[number])
}

