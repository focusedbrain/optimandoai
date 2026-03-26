/**
 * Unified PDF text extraction for BEAP draft attachments:
 * primary parse (pdfjs + optional Electron) then silent Anthropic Vision when a key is stored.
 */

import type { CapsuleAttachment } from './canonical-types'
import { processAttachmentForParsing } from './parserService'
import { extractPdfTextWithVision } from './visionExtractionService'
import { getAnthropicApiKey } from './anthropicApiKeyStorage'

export type DraftAttachmentParseItem = {
  id: string
  dataBase64: string
  capsuleAttachment: CapsuleAttachment
}

export type DraftAttachmentParseUpdate = {
  capsuleAttachment: CapsuleAttachment
  processing: { parsing: boolean; rasterizing: boolean; error?: string }
}

export async function runDraftAttachmentParseWithFallback(
  item: DraftAttachmentParseItem
): Promise<DraftAttachmentParseUpdate> {
  const parseResult = await processAttachmentForParsing(item.capsuleAttachment, item.dataBase64)

  const hasGoodText =
    parseResult.attachment.semanticExtracted &&
    !!parseResult.attachment.semanticContent?.trim()

  if (hasGoodText) {
    return {
      capsuleAttachment: parseResult.attachment,
      processing: { parsing: false, rasterizing: false },
    }
  }

  const baseError = parseResult.error ?? 'Text extraction failed'

  let usedVisionWithKey = false
  try {
    const apiKey = await getAnthropicApiKey()
    const trimmedKey = apiKey?.trim() ?? ''
    if (trimmedKey.startsWith('sk-ant-')) {
      usedVisionWithKey = true
      const visionResult = await extractPdfTextWithVision(item.dataBase64, trimmedKey)
      if (visionResult.success && visionResult.extractedText?.trim()) {
        return {
          capsuleAttachment: {
            ...parseResult.attachment,
            semanticContent: visionResult.extractedText,
            semanticExtracted: true,
          },
          processing: { parsing: false, rasterizing: false },
        }
      }
      return {
        capsuleAttachment: {
          ...parseResult.attachment,
          semanticContent: null,
          semanticExtracted: false,
        },
        processing: {
          parsing: false,
          rasterizing: false,
          error: visionResult.error ?? baseError,
        },
      }
    }
  } catch (e) {
    console.warn('[BEAP] Vision fallback failed:', e)
  }

  const hasKey = usedVisionWithKey
  const errorMsg = hasKey
    ? baseError
    : `${baseError} Add an API key in settings to enable AI extraction for scanned PDFs.`

  return {
    capsuleAttachment: {
      ...parseResult.attachment,
      semanticContent: null,
      semanticExtracted: false,
    },
    processing: { parsing: false, rasterizing: false, error: errorMsg },
  }
}
