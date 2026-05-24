/**
 * Sandbox orchestrator render modes (P5.6).
 *
 * Structured-text-only display — no HTML, link-ification, or syntax highlighting.
 */

export type SandboxRenderMode = 'diagnostic_report' | 'raw_email_body'

export interface SandboxViewRequest {
  mode: SandboxRenderMode
  replicaId: string
  hash: string
}

export interface SandboxViewContent {
  mode: SandboxRenderMode
  title: string
  textContent: string
}

export interface PrepareSandboxViewResult {
  ok: boolean
  textContent?: string
  error?: string
}

export function sandboxViewTitle(mode: SandboxRenderMode): string {
  return mode === 'diagnostic_report' ? 'Diagnostic Report' : 'Quarantined Message'
}
