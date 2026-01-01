/**
 * Bundled Tools Types
 * 
 * Type definitions for bundled third-party tools (parser, rasterizer).
 * These tools are installed locally and never downloaded at runtime.
 * 
 * @version 1.0.0
 */

// =============================================================================
// Tool Category
// =============================================================================

/**
 * Categories of bundled tools
 */
export type ToolCategory = 'parser' | 'rasterizer'

/**
 * Tool execution status
 */
export type ToolStatus = 'installed' | 'not_installed' | 'error'

// =============================================================================
// License Types
// =============================================================================

/**
 * SPDX License identifiers for bundled tools
 * Only permissive licenses allowed (NO GPL/AGPL)
 */
export type LicenseIdentifier = 
  | 'Apache-2.0'
  | 'BSD-3-Clause'
  | 'BSD-2-Clause'
  | 'MIT'
  | 'ISC'

/**
 * Full license information for a component
 */
export interface LicenseInfo {
  /** SPDX identifier */
  identifier: LicenseIdentifier
  
  /** Human-readable name */
  name: string
  
  /** Copyright holder(s) */
  copyrightHolders: string[]
  
  /** Full license text */
  fullText: string
  
  /** URL to upstream project */
  upstreamUrl: string
}

// =============================================================================
// Bundled Tool Definition
// =============================================================================

/**
 * Supported file formats for parsing
 */
export type SupportedFormat = 
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'html'
  | 'txt'
  | 'md'

/**
 * Output formats for rasterization
 */
export type RasterOutputFormat = 'webp' | 'png'

/**
 * A bundled third-party tool
 */
export interface BundledTool {
  /** Unique tool identifier */
  id: string
  
  /** Display name */
  name: string
  
  /** Short description of purpose */
  description: string
  
  /** Tool category */
  category: ToolCategory
  
  /** Installed version string */
  version: string
  
  /** SHA-256 hash of the tool binary/module */
  hash: string
  
  /** Installation path relative to /third_party/ */
  installPath: string
  
  /** License information */
  license: LicenseInfo
  
  /** Supported input formats (for parser) */
  supportedFormats?: SupportedFormat[]
  
  /** Output format (for rasterizer) */
  outputFormat?: RasterOutputFormat
  
  /** Current status */
  status: ToolStatus
  
  /** Error message if status is 'error' */
  error?: string
  
  /** Installation timestamp */
  installedAt: number
}

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Registry of all bundled tools
 */
export interface ToolRegistry {
  /** All registered tools */
  tools: Record<string, BundledTool>
  
  /** Registry version (installer version) */
  registryVersion: string
  
  /** Last verification timestamp */
  lastVerified: number
  
  /** Whether all tools passed verification */
  allVerified: boolean
}

// =============================================================================
// Execution Types
// =============================================================================

/**
 * Request to execute a parser task
 */
export interface ParserRequest {
  /** Tool ID to use */
  toolId: string
  
  /** Input file reference (path or blob ref) */
  inputRef: string
  
  /** Input format */
  format: SupportedFormat
  
  /** Request ID for tracking */
  requestId: string
}

/**
 * Parser execution result
 */
export interface ParserResult {
  /** Whether parsing succeeded */
  success: boolean
  
  /** Request ID */
  requestId: string
  
  /** Extracted plain text (if success) */
  text?: string
  
  /** Error message (if failure) */
  error?: string
  
  /** Execution time in ms */
  durationMs: number
  
  /** Tool version used */
  toolVersion: string
  
  /** Tool hash (for attestation) */
  toolHash: string
}

/**
 * Request to execute a rasterization task
 */
export interface RasterizerRequest {
  /** Tool ID to use */
  toolId: string
  
  /** Input file reference (path or blob ref) */
  inputRef: string
  
  /** Page number (for multi-page documents) */
  page?: number
  
  /** Output format */
  outputFormat: RasterOutputFormat
  
  /** DPI for rasterization */
  dpi?: number
  
  /** Request ID for tracking */
  requestId: string
}

/**
 * Rasterizer execution result
 */
export interface RasterizerResult {
  /** Whether rasterization succeeded */
  success: boolean
  
  /** Request ID */
  requestId: string
  
  /** Output image reference (blob URL or base64) */
  imageRef?: string
  
  /** Output format */
  format?: RasterOutputFormat
  
  /** Image dimensions */
  dimensions?: { width: number; height: number }
  
  /** Error message (if failure) */
  error?: string
  
  /** Execution time in ms */
  durationMs: number
  
  /** Tool version used */
  toolVersion: string
  
  /** Tool hash (for attestation) */
  toolHash: string
}

// =============================================================================
// Diagnostic/Attestation Types
// =============================================================================

/**
 * Tool information for diagnostic/attestation reports
 */
export interface ToolDiagnosticInfo {
  /** Tool ID */
  id: string
  
  /** Tool name */
  name: string
  
  /** Version string */
  version: string
  
  /** SHA-256 hash */
  hash: string
  
  /** License identifier */
  licenseId: LicenseIdentifier
  
  /** Status */
  status: ToolStatus
  
  /** Installation timestamp */
  installedAt: number
}

/**
 * Full diagnostic report for all bundled tools
 */
export interface ToolDiagnosticReport {
  /** Report generation timestamp */
  generatedAt: number
  
  /** Registry version */
  registryVersion: string
  
  /** All tools info */
  tools: ToolDiagnosticInfo[]
  
  /** Overall verification status */
  allVerified: boolean
}

