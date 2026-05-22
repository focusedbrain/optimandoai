/**
 * Shared guards for BEAP inbox → content-script bridges (Edit / Run).
 * Keeps invalid payloads from reaching tab handlers; does not replace sessionImportPayloadResolver UI gating.
 */

import { unwrapSessionImportPayloadForTab } from '../services/sessionImportArtefactUnwrap'

export type BeapImportPayloadGuardResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Tab bridges require a plain object payload (structured-clone safe). Arrays / primitives are rejected.
 * Unwraps SessionImportArtefact wrappers and maps orchestrator session content to tab-import shape.
 */
export function narrowBeapImportPayloadForBridge(importData: unknown): BeapImportPayloadGuardResult {
  return unwrapSessionImportPayloadForTab(importData)
}

export function narrowBeapFallbackModel(fallbackModel: unknown, fallbackWhenEmpty: string): string {
  if (typeof fallbackModel === 'string' && fallbackModel.trim()) {
    return fallbackModel.trim()
  }
  return fallbackWhenEmpty
}

/** Use in the content script after session JSON crosses the tab boundary. */
export function assertBeapTabImportPayload(importData: unknown): asserts importData is Record<string, unknown> {
  const g = narrowBeapImportPayloadForBridge(importData)
  if (!g.ok) {
    throw new Error(g.reason)
  }
}
