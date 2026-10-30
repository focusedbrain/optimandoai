/**
 * Renderer / extension consumer API for Art. 50 provenance.
 * Does NOT export createProvenance / finalizeAiText — those are main-process only
 * (see ./generate.ts). Consumers may transform existing objects (markHumanEdited)
 * and serialize for carriers.
 */

export * from './types'
export {
  encodeProvenancePayload,
  decodeProvenancePayload,
  serializeForMime,
  serializeForHtmlMeta,
  withVisibleAiLabel,
  shouldApplyMachineMarking,
  shouldApplyVisibleSendLabel,
  buildClipboardHtml,
  buildCarrierOnlyHtmlMeta,
  buildCarrierOnlyClipboardHtml,
} from './serialize'
export { markHumanEdited, markEditorialResponsible, isAiProvenance } from './createProvenance'
export { sha256HexUtf8 } from './sha256'
