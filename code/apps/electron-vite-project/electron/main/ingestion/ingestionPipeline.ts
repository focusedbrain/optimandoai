/**
 * Pipeline Orchestrator — mode-aware dispatch (EdgeActive / HostPodActive / Blocked).
 *
 * All entry points call processIncomingInput(), which consults the mode resolver
 * via ingestionDispatcher. No silent fallback when edge tier is enabled.
 */

import type { RawInput, SourceType, TransportMetadata, IngestionResult } from './types'
import { dispatchProcessIncomingInput } from './ingestionDispatcher.js'

export async function processIncomingInput(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: TransportMetadata,
): Promise<IngestionResult> {
  return dispatchProcessIncomingInput(rawInput, sourceType, transportMeta)
}

/** @deprecated Use processIncomingInput — kept for tests importing pod path directly. */
export { processIncomingInputViaPod } from './ingestionPipelinePod.js'
