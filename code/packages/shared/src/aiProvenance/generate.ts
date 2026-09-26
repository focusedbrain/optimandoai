/**
 * MAIN-PROCESS / generation-boundary entry for Art. 50 provenance creation.
 * Renderer and content-script bundles must NOT import this module.
 * Use `@shared/aiProvenance` (index) for types and read-only helpers.
 */

export {
  createProvenance,
  finalizeAiText,
  extractUpstreamMarking,
} from './createProvenance'

export type { CreateProvenanceInput, AiTextWithProvenance } from './types'
