/**
 * Art. 50 Layer B clipboard helper.
 *
 * Writes AI-generated text to the clipboard with:
 *  - text/plain: visible "[AI-generated]" label prepended
 *  - text/html: machine-readable provenance in <meta> tags + styled body
 *
 * If provenance is not supplied, creates a minimal one (model_id:'unknown',
 * provider:'local') so the Layer A machine-readable carrier is always present.
 *
 * Falls back to plain-text-only if ClipboardItem is unavailable (e.g. some
 * non-secure contexts).
 */

import {
  buildClipboardHtml,
  createProvenance,
  isAiProvenance,
  withVisibleAiLabel,
  type AiProvenance,
} from '@shared/aiProvenance'

export async function writeAiClipboard(
  text: string,
  provenance?: AiProvenance | null,
): Promise<void> {
  const prov: AiProvenance = isAiProvenance(provenance)
    ? provenance
    : createProvenance(text, { model_id: 'unknown', provider: 'local' })

  const plain = withVisibleAiLabel(text)
  const html = buildClipboardHtml(text, prov)

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
