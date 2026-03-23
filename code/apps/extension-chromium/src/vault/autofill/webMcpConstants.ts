/**
 * WebMCP constants — safe for service worker (no DOM, no vault imports).
 * Background script imports from here to avoid loading DOM-dependent webMcpAdapter.
 */
export const WEBMCP_RESULT_VERSION = 'webmcp-preview-v1' as const
