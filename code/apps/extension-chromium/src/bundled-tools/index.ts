/**
 * Bundled Tools Module
 * 
 * Manages parser (Apache Tika) and rasterizer (PDFium) tools.
 * These tools are bundled by the installer and execute locally.
 * 
 * GUARANTEES:
 * - No runtime downloads
 * - Isolated execution (separate processes)
 * - Deterministic output
 * - Full license disclosure
 * 
 * @version 1.0.0
 */

// Types
export * from './types'

// Licenses
export {
  BUNDLED_TOOL_LICENSES,
  APACHE_TIKA_LICENSE,
  PDFIUM_LICENSE,
  LICENSE_TEMPLATES,
  getLicenseForTool,
  isPermissiveLicense
} from './licenses'
export type { BundledToolLicenseEntry } from './licenses'

// Registry
export {
  REGISTRY_VERSION,
  THIRD_PARTY_PATH,
  getToolRegistry,
  getTool,
  getToolsByCategory,
  getParser,
  getRasterizer,
  isFormatSupported,
  areToolsReady,
  registerTool,
  verifyAllTools,
  getToolDiagnostic,
  generateDiagnosticReport,
  exportToolInfo,
  loadRegistry,
  resetRegistry
} from './registry'

// Executor
export {
  executeParser,
  executeRasterizer,
  canParse,
  canRasterize,
  getSupportedParseFormats,
  parseDocument,
  rasterizePage,
  logExecution,
  getExecutionLog,
  clearExecutionLog
} from './executor'

// Components
export { ThirdPartyLicensesView } from './components'

