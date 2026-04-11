/**
 * Shared guards for BEAP inbox → content-script bridges (Edit / Run).
 * Keeps invalid payloads from reaching tab handlers; does not replace sessionImportPayloadResolver UI gating.
 */

export type BeapImportPayloadGuardResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string }

/**
 * Tab bridges require a plain object payload (structured-clone safe). Arrays / primitives are rejected.
 */
export function narrowBeapImportPayloadForBridge(importData: unknown): BeapImportPayloadGuardResult {
  if (importData === null || importData === undefined) {
    return { ok: false, reason: 'Import payload is missing.' }
  }
  if (typeof importData !== 'object' || Array.isArray(importData)) {
    return { ok: false, reason: 'Import payload must be a session object, not an array or primitive.' }
  }
  return { ok: true, payload: importData as Record<string, unknown> }
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
