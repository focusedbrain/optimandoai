/**
 * Sandbox orchestrator entry — routes quarantine/report viewing through isolated text display (P5.6).
 */

import type {
  PrepareSandboxViewResult,
  SandboxRenderMode,
  SandboxViewContent,
  SandboxViewRequest,
} from './types.js'
import { sandboxViewTitle } from './types.js'

export type SandboxViewShowHandler = (view: SandboxViewContent) => void

let showHandler: SandboxViewShowHandler | null = null
let prepareOverride: ((request: SandboxViewRequest) => Promise<PrepareSandboxViewResult>) | null =
  null

export function registerSandboxViewShowHandler(handler: SandboxViewShowHandler | null): void {
  showHandler = handler
}

/** Test seam — bypass dashboard IPC. */
export function _setSandboxPrepareOverrideForTest(
  fn: ((request: SandboxViewRequest) => Promise<PrepareSandboxViewResult>) | null,
): void {
  prepareOverride = fn
}

async function prepareSandboxContent(
  request: SandboxViewRequest,
): Promise<PrepareSandboxViewResult> {
  if (prepareOverride) {
    return prepareOverride(request)
  }
  const bridge = typeof window !== 'undefined' ? window.dashboard : undefined
  if (!bridge?.prepareSandboxView) {
    return { ok: false, error: 'Sandbox bridge unavailable' }
  }
  return bridge.prepareSandboxView(request)
}

export async function openSandboxOrchestratorView(
  request: SandboxViewRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prepared = await prepareSandboxContent(request)
  if (!prepared.ok || !prepared.textContent) {
    return { ok: false, error: prepared.error ?? 'Failed to prepare sandbox view' }
  }

  const view: SandboxViewContent = {
    mode: request.mode,
    title: sandboxViewTitle(request.mode),
    textContent: prepared.textContent,
  }

  if (!showHandler) {
    return { ok: false, error: 'Sandbox viewer not mounted' }
  }

  showHandler(view)
  return { ok: true }
}

export async function invokeSandboxOrchestrator(
  mode: SandboxRenderMode,
  replicaId: string,
  hash: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return openSandboxOrchestratorView({ mode, replicaId, hash })
}
