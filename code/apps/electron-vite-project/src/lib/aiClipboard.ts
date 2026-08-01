/**
 * Art. 50 Layer B clipboard helper.
 *
 * Writes AI-generated text to the clipboard with:
 *  - text/plain: visible "[AI-generated]" label prepended
 *  - text/html: machine-readable provenance in <meta> tags + styled body
 *
 * When provenance is a valid AiProvenance, uses full buildClipboardHtml.
 * When provenance is absent, uses carrier-only HTML meta (no model_id / generated_at minted).
 *
 * Falls back to plain-text-only if ClipboardItem is unavailable (e.g. some
 * non-secure contexts).
 */

import {
  buildClipboardHtml,
  buildCarrierOnlyClipboardHtml,
  isAiProvenance,
  withVisibleAiLabel,
  type AiProvenance,
} from '@shared/aiProvenance'

export async function writeAiClipboard(
  text: string,
  provenance?: AiProvenance | null,
): Promise<void> {
  const plain = withVisibleAiLabel(text)
  const html = isAiProvenance(provenance)
    ? buildClipboardHtml(text, provenance)
    : buildCarrierOnlyClipboardHtml(text)

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(plain)
    }
  } catch {
    try {
      await navigator.clipboard.writeText(plain)
    } catch {
      // clipboard not available in this context
    }
  }
}
