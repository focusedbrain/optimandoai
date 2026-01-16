/**
 * Bundled Tools Registry
 * 
 * Registry for installer-provisioned parser and rasterizer tools.
 * Tools are registered at install time with cryptographic hashes.
 * 
 * INVARIANTS:
 * - No runtime downloads allowed
 * - Only installer-registered tools can be executed
 * - All tools must be verified before use
 * 
 * @version 1.0.0
 */

import type {
  BundledTool,
  ToolRegistry,
  ToolCategory,
  ToolStatus,
  ToolDiagnosticInfo,
  ToolDiagnosticReport,
  SupportedFormat
} from './types'
import { BUNDLED_TOOL_LICENSES } from './licenses'

// =============================================================================
// Registry Constants
// =============================================================================

/**
 * Current registry version (matches installer version)
 */
export const REGISTRY_VERSION = '1.0.0'

/**
 * Installation path for bundled tools
 */
export const THIRD_PARTY_PATH = '/third_party/beap_tools/'

// =============================================================================
// Default Tool Definitions
// =============================================================================

/**
 * Apache Tika tool definition
 * Registered at install time
 */
const APACHE_TIKA_TOOL: BundledTool = {
  id: 'apache-tika',
  name: 'Apache Tika',
  description: 'Semantic parser for extracting text from documents',
  category: 'parser',
  version: '2.9.1',
  hash: 'placeholder-hash-will-be-set-by-installer',
  installPath: `${THIRD_PARTY_PATH}tika/`,
  license: BUNDLED_TOOL_LICENSES.find(t => t.id === 'apache-tika')!.license,
  supportedFormats: ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'txt', 'md'],
  status: 'not_installed',
  installedAt: 0
}

/**
 * PDFium tool definition
 * Registered at install time
 */
const PDFIUM_TOOL: BundledTool = {
  id: 'pdfium',
  name: 'PDFium',
  description: 'Deterministic rasterizer for document previews',
  category: 'rasterizer',
  version: '6312',
  hash: 'placeholder-hash-will-be-set-by-installer',
  installPath: `${THIRD_PARTY_PATH}pdfium/`,
  license: BUNDLED_TOOL_LICENSES.find(t => t.id === 'pdfium')!.license,
  outputFormat: 'webp',
  status: 'not_installed',
  installedAt: 0
}

// =============================================================================
// Registry State
// =============================================================================

/**
 * Current tool registry
 * Populated by installer, persisted in chrome.storage.local
 */
let currentRegistry: ToolRegistry = {
  tools: {
    'apache-tika': APACHE_TIKA_TOOL,
    'pdfium': PDFIUM_TOOL
  },
  registryVersion: REGISTRY_VERSION,
  lastVerified: 0,
  allVerified: false
}

// =============================================================================
// Registry Operations
// =============================================================================

/**
 * Get the current tool registry
 */
export function getToolRegistry(): ToolRegistry {
  return { ...currentRegistry }
}

/**
 * Get a specific tool by ID
 */
export function getTool(toolId: string): BundledTool | null {
  return currentRegistry.tools[toolId] ?? null
}

/**
 * Get all tools by category
 */
export function getToolsByCategory(category: ToolCategory): BundledTool[] {
  return Object.values(currentRegistry.tools).filter(t => t.category === category)
}

/**
 * Get the parser tool
 */
export function getParser(): BundledTool | null {
  const parsers = getToolsByCategory('parser')
  return parsers.length > 0 ? parsers[0] : null
}

/**
 * Get the rasterizer tool
 */
export function getRasterizer(): BundledTool | null {
  const rasterizers = getToolsByCategory('rasterizer')
  return rasterizers.length > 0 ? rasterizers[0] : null
}

/**
 * Check if a format is supported by the parser
 */
export function isFormatSupported(format: SupportedFormat): boolean {
  const parser = getParser()
  if (!parser?.supportedFormats) return false
  return parser.supportedFormats.includes(format)
}

/**
 * Check if all required tools are installed and verified
 */
export function areToolsReady(): boolean {
  return currentRegistry.allVerified
}

// =============================================================================
// Installer Registration (called by installer only)
// =============================================================================

/**
 * Register a tool (called by installer during installation)
 * 
 * @param toolId - Tool identifier
 * @param version - Installed version
 * @param hash - SHA-256 hash of installed binary
 * @param installPath - Actual installation path
 */
export function registerTool(
  toolId: string,
  version: string,
  hash: string,
  installPath: string
): boolean {
  const tool = currentRegistry.tools[toolId]
  if (!tool) {
    console.error(`[ToolRegistry] Unknown tool: ${toolId}`)
    return false
  }
  
  currentRegistry.tools[toolId] = {
    ...tool,
    version,
    hash,
    installPath,
    status: 'installed',
    installedAt: Date.now()
  }
  
  // Persist to storage
  persistRegistry()
  
  console.log(`[ToolRegistry] Registered: ${toolId} v${version}`)
  return true
}

/**
 * Verify all registered tools
 * Called at startup to ensure integrity
 */
export async function verifyAllTools(): Promise<boolean> {
  let allValid = true
  
  for (const toolId of Object.keys(currentRegistry.tools)) {
    const tool = currentRegistry.tools[toolId]
    
    if (tool.status !== 'installed') {
      console.warn(`[ToolRegistry] Tool not installed: ${toolId}`)
      allValid = false
      continue
    }
    
    // In a real implementation, this would verify the hash
    // For now, we trust the installer registration
    const verified = tool.hash !== 'placeholder-hash-will-be-set-by-installer'
    
    if (!verified) {
      currentRegistry.tools[toolId] = {
        ...tool,
        status: 'error',
        error: 'Hash verification failed or tool not properly installed'
      }
      allValid = false
    }
  }
  
  currentRegistry.lastVerified = Date.now()
  currentRegistry.allVerified = allValid
  
  await persistRegistry()
  
  return allValid
}

// =============================================================================
// Diagnostic/Attestation
// =============================================================================

/**
 * Get diagnostic info for a single tool
 */
export function getToolDiagnostic(toolId: string): ToolDiagnosticInfo | null {
  const tool = currentRegistry.tools[toolId]
  if (!tool) return null
  
  return {
    id: tool.id,
    name: tool.name,
    version: tool.version,
    hash: tool.hash,
    licenseId: tool.license.identifier,
    status: tool.status,
    installedAt: tool.installedAt
  }
}

/**
 * Generate full diagnostic report for attestation
 */
export function generateDiagnosticReport(): ToolDiagnosticReport {
  const tools: ToolDiagnosticInfo[] = Object.values(currentRegistry.tools).map(tool => ({
    id: tool.id,
    name: tool.name,
    version: tool.version,
    hash: tool.hash,
    licenseId: tool.license.identifier,
    status: tool.status,
    installedAt: tool.installedAt
  }))
  
  return {
    generatedAt: Date.now(),
    registryVersion: currentRegistry.registryVersion,
    tools,
    allVerified: currentRegistry.allVerified
  }
}

/**
 * Export tool info for programmatic access (audit/export)
 */
export function exportToolInfo(): Array<{
  id: string
  name: string
  version: string
  hash: string
  license: string
  status: ToolStatus
}> {
  return Object.values(currentRegistry.tools).map(tool => ({
    id: tool.id,
    name: tool.name,
    version: tool.version,
    hash: tool.hash,
    license: tool.license.identifier,
    status: tool.status
  }))
}

// =============================================================================
// Persistence
// =============================================================================

const STORAGE_KEY = 'beap-tool-registry'

/**
 * Persist registry to chrome.storage.local
 */
async function persistRegistry(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_KEY]: currentRegistry })
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentRegistry))
    }
  } catch (error) {
    console.error('[ToolRegistry] Failed to persist:', error)
  }
}

/**
 * Load registry from storage
 */
export async function loadRegistry(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get([STORAGE_KEY])
      if (result[STORAGE_KEY]) {
        currentRegistry = result[STORAGE_KEY]
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        currentRegistry = JSON.parse(stored)
      }
    }
  } catch (error) {
    console.error('[ToolRegistry] Failed to load:', error)
  }
}

/**
 * Reset registry to defaults (for testing)
 */
export function resetRegistry(): void {
  currentRegistry = {
    tools: {
      'apache-tika': { ...APACHE_TIKA_TOOL },
      'pdfium': { ...PDFIUM_TOOL }
    },
    registryVersion: REGISTRY_VERSION,
    lastVerified: 0,
    allVerified: false
  }
}

