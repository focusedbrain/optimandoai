/**
 * Main-process helper: attach AiProvenance + append to generation log.
 */

import {
  createProvenance,
  finalizeAiText,
  type AiTextWithProvenance,
  type CreateProvenanceInput,
} from '../../../../../packages/shared/src/aiProvenance/generate'
import { logGeneration } from './provenanceLog'

export function attachAndLogProvenance(
  content: string,
  input: CreateProvenanceInput,
): AiTextWithProvenance {
  const result = finalizeAiText(content, input)
  logGeneration(result.provenance)
  return result
}

export function provenanceOnly(content: string, input: CreateProvenanceInput) {
  const p = createProvenance(content, input)
  logGeneration(p)
  return p
}

export { createProvenance, finalizeAiText, logGeneration }
