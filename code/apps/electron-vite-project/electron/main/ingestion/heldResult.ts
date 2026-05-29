/**
 * Shared helpers for ingestion hold results (success without distribution).
 */

import type { IngestionResult } from './types.js'

export function isHeldIngestionResult(
  result: IngestionResult,
): result is Extract<IngestionResult, { held: true }> {
  return result.success && 'held' in result && result.held === true
}
