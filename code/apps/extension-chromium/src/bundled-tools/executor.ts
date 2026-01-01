/**
 * Bundled Tools Executor
 * 
 * Isolated execution service for parser and rasterizer tools.
 * Tools run as separate processes, never linked into core runtime.
 * 
 * EXECUTION MODEL:
 * - Tools execute in isolated context (Web Worker or separate process)
 * - No direct memory access to core runtime
 * - Deterministic output for identical input
 * - All executions are logged for attestation
 * 
 * @version 1.0.0
 */

import type {
  ParserRequest,
  ParserResult,
  RasterizerRequest,
  RasterizerResult,
  SupportedFormat
} from './types'
import { getTool, areToolsReady, getParser, getRasterizer } from './registry'

// =============================================================================
// Execution Guards
// =============================================================================

/**
 * Verify tools are ready before execution
 */
function assertToolsReady(): void {
  if (!areToolsReady()) {
    throw new Error('[ToolExecutor] Tools not installed or verified. Cannot execute.')
  }
}

/**
 * Verify a specific tool is available
 */
function assertToolAvailable(toolId: string): void {
  const tool = getTool(toolId)
  if (!tool) {
    throw new Error(`[ToolExecutor] Tool not found: ${toolId}`)
  }
  if (tool.status !== 'installed') {
    throw new Error(`[ToolExecutor] Tool not installed: ${toolId}`)
  }
}

// =============================================================================
// Parser Execution
// =============================================================================

/**
 * Execute a parsing task
 * 
 * IMPORTANT: This is a stub implementation.
 * In production, this would spawn Tika as an isolated process.
 * 
 * Output: Plain text ONLY
 * Excluded: macros, scripts, executable logic
 */
export async function executeParser(request: ParserRequest): Promise<ParserResult> {
  const startTime = Date.now()
  
  try {
    // Verify tool is ready
    assertToolAvailable(request.toolId)
    
    const tool = getTool(request.toolId)!
    
    // In production, this would:
    // 1. Spawn Tika as a separate process
    // 2. Pass input via file reference (not direct memory)
    // 3. Capture stdout as plain text output
    // 4. Enforce timeout and resource limits
    
    // Stub implementation - returns placeholder
    console.log(`[ToolExecutor] Parser stub: ${request.toolId} processing ${request.format}`)
    
    // Simulate async execution
    await new Promise(resolve => setTimeout(resolve, 100))
    
    return {
      success: true,
      requestId: request.requestId,
      text: `[STUB] Parsed content from ${request.inputRef} (format: ${request.format})`,
      durationMs: Date.now() - startTime,
      toolVersion: tool.version,
      toolHash: tool.hash
    }
  } catch (error) {
    return {
      success: false,
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Unknown parser error',
      durationMs: Date.now() - startTime,
      toolVersion: '',
      toolHash: ''
    }
  }
}

/**
 * Check if a file format can be parsed
 */
export function canParse(format: SupportedFormat): boolean {
  const parser = getParser()
  if (!parser?.supportedFormats) return false
  return parser.supportedFormats.includes(format)
}

/**
 * Get supported formats for parsing
 */
export function getSupportedParseFormats(): SupportedFormat[] {
  const parser = getParser()
  return parser?.supportedFormats ?? []
}

// =============================================================================
// Rasterizer Execution
// =============================================================================

/**
 * Execute a rasterization task
 * 
 * IMPORTANT: This is a stub implementation.
 * In production, this would spawn PDFium as an isolated process.
 * 
 * Output: Non-executable images (WebP/PNG) ONLY
 * Purpose: Previews, reconstruction reference, integrity anchoring
 */
export async function executeRasterizer(request: RasterizerRequest): Promise<RasterizerResult> {
  const startTime = Date.now()
  
  try {
    // Verify tool is ready
    assertToolAvailable(request.toolId)
    
    const tool = getTool(request.toolId)!
    
    // In production, this would:
    // 1. Spawn PDFium as a separate process
    // 2. Pass input via file reference (not direct memory)
    // 3. Render to specified format at specified DPI
    // 4. Return image as blob reference
    // 5. Enforce timeout and resource limits
    
    // Stub implementation - returns placeholder
    console.log(`[ToolExecutor] Rasterizer stub: ${request.toolId} processing page ${request.page ?? 1}`)
    
    // Simulate async execution
    await new Promise(resolve => setTimeout(resolve, 150))
    
    return {
      success: true,
      requestId: request.requestId,
      imageRef: `blob:stub-rasterized-${request.requestId}`,
      format: request.outputFormat,
      dimensions: { width: 612, height: 792 }, // Letter size at 72 DPI
      durationMs: Date.now() - startTime,
      toolVersion: tool.version,
      toolHash: tool.hash
    }
  } catch (error) {
    return {
      success: false,
      requestId: request.requestId,
      error: error instanceof Error ? error.message : 'Unknown rasterizer error',
      durationMs: Date.now() - startTime,
      toolVersion: '',
      toolHash: ''
    }
  }
}

/**
 * Check if rasterizer is available
 */
export function canRasterize(): boolean {
  const rasterizer = getRasterizer()
  return rasterizer?.status === 'installed'
}

// =============================================================================
// High-Level Convenience Functions
// =============================================================================

/**
 * Parse a document and extract text
 * Uses the default parser (Apache Tika)
 */
export async function parseDocument(
  inputRef: string,
  format: SupportedFormat
): Promise<ParserResult> {
  const parser = getParser()
  if (!parser) {
    return {
      success: false,
      requestId: crypto.randomUUID(),
      error: 'No parser available',
      durationMs: 0,
      toolVersion: '',
      toolHash: ''
    }
  }
  
  return executeParser({
    toolId: parser.id,
    inputRef,
    format,
    requestId: crypto.randomUUID()
  })
}

/**
 * Rasterize a document page to image
 * Uses the default rasterizer (PDFium)
 */
export async function rasterizePage(
  inputRef: string,
  page: number = 1,
  dpi: number = 150
): Promise<RasterizerResult> {
  const rasterizer = getRasterizer()
  if (!rasterizer) {
    return {
      success: false,
      requestId: crypto.randomUUID(),
      error: 'No rasterizer available',
      durationMs: 0,
      toolVersion: '',
      toolHash: ''
    }
  }
  
  return executeRasterizer({
    toolId: rasterizer.id,
    inputRef,
    page,
    outputFormat: rasterizer.outputFormat ?? 'webp',
    dpi,
    requestId: crypto.randomUUID()
  })
}

// =============================================================================
// Execution Logging (for attestation)
// =============================================================================

interface ExecutionLogEntry {
  timestamp: number
  toolId: string
  toolVersion: string
  toolHash: string
  requestId: string
  operation: 'parse' | 'rasterize'
  success: boolean
  durationMs: number
  error?: string
}

const executionLog: ExecutionLogEntry[] = []

/**
 * Log an execution for attestation purposes
 */
export function logExecution(
  result: ParserResult | RasterizerResult,
  operation: 'parse' | 'rasterize'
): void {
  executionLog.push({
    timestamp: Date.now(),
    toolId: operation === 'parse' ? 'apache-tika' : 'pdfium',
    toolVersion: result.toolVersion,
    toolHash: result.toolHash,
    requestId: result.requestId,
    operation,
    success: result.success,
    durationMs: result.durationMs,
    error: result.error
  })
  
  // Keep only last 1000 entries
  if (executionLog.length > 1000) {
    executionLog.shift()
  }
}

/**
 * Get execution log for diagnostics
 */
export function getExecutionLog(): ExecutionLogEntry[] {
  return [...executionLog]
}

/**
 * Clear execution log
 */
export function clearExecutionLog(): void {
  executionLog.length = 0
}

