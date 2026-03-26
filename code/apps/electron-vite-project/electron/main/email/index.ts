/**
 * Email Gateway Module
 * 
 * Secure email pipeline for the orchestrator.
 * 
 * ## Security Model
 * - Raw HTML emails are NEVER rendered in the UI
 * - All content is sanitized server-side before being sent to the renderer
 * - PDFs are processed locally - never opened in browser
 * - OAuth tokens and credentials are stored securely
 * 
 * ## Architecture
 * 
 * ```
 * Email Provider (Gmail/IMAP/Microsoft)
 *         │
 *         ▼
 * ┌─────────────────────┐
 * │  Email Provider     │  ← Fetches raw messages
 * │  (gmail.ts, etc.)   │
 * └─────────────────────┘
 *         │
 *         ▼
 * ┌─────────────────────┐
 * │  Email Gateway      │  ← Orchestrates operations
 * │  (gateway.ts)       │
 * └─────────────────────┘
 *         │
 *    ┌────┴────┐
 *    ▼         ▼
 * ┌──────┐ ┌────────────┐
 * │Sanit-│ │PDF Extract │  ← Process content
 * │izer  │ └────────────┘
 * └──────┘
 *         │
 *         ▼
 * ┌─────────────────────┐
 * │  IPC Handlers       │  ← Expose to renderer
 * │  (ipc.ts)           │
 * └─────────────────────┘
 *         │
 *         ▼
 * ┌─────────────────────┐
 * │  Renderer / UI      │  ← Only sees sanitized data
 * └─────────────────────┘
 * ```
 * 
 * ## Adding a New Provider
 * 
 * 1. Add the provider to `EmailProvider` in `types.ts`
 * 2. Register `PROVIDER_IMPLEMENTATION_PROFILE` in `domain/capabilitiesRegistry.ts`
 * 3. Create `providers/<name>.ts` implementing `IEmailProvider` from `providers/base.ts`
 * 4. Register the provider in `gateway.ts` `getProvider()` / `getConnectedProvider()` switches
 * 
 * ## MCP Integration
 * 
 * The email gateway can be exposed as MCP tools for LLM agents.
 * All MCP tools should use the gateway's sanitized APIs - never raw data.
 * 
 * Example MCP tools:
 * - email_list_accounts: List configured email accounts
 * - email_list_messages: Fetch sanitized message list
 * - email_get_message: Get full sanitized message body
 * - email_get_pdf_text: Extract text from PDF attachment
 */

// Export types
export * from './types'

// Domain model (capabilities, identity, mailbox sync plan mappers)
export * from './domain'

// Export gateway
export { emailGateway } from './gateway'

// Export IPC registration
export { registerEmailHandlers, registerInboxHandlers } from './ipc'

// Export sanitizer utilities (for use in other modules)
export {
  sanitizeHtmlToText,
  sanitizeSubject,
  sanitizeEmailAddress,
  sanitizeDisplayName,
  generateSnippet
} from './sanitizer'

// Export PDF extractor
export { extractPdfText, isPdfFile, supportsTextExtraction, type ExtractPdfTextResult } from './pdf-extractor'


