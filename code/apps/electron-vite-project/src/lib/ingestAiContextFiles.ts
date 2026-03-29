import { useAiDraftContextStore } from '../stores/useAiDraftContextStore'

/** Local parser id for AI context PDFs (not inbox attachments). */
export const CONTEXT_PDF_ATTACHMENT_ID = 'context-upload'

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(binary)
}

/**
 * Extract text from user-selected files and append to shared AI drafting context store.
 * Same behavior as the top-bar 📎 control in HybridSearch (Prompt 5).
 */
export async function ingestAiContextFiles(files: File[]): Promise<void> {
  const addDocuments = useAiDraftContextStore.getState().addDocuments
  const batch: Array<{ name: string; text: string }> = []

  for (const file of files) {
    let text = ''
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.pdf')) {
      const buf = await file.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      try {
        const beap = typeof window !== 'undefined' ? window.beap : undefined
        if (beap && typeof beap.extractPdfText === 'function') {
          const data = (await beap.extractPdfText({
            attachmentId: CONTEXT_PDF_ATTACHMENT_ID,
            base64: b64,
          })) as { success?: boolean; extractedText?: string }
          text =
            data?.success && typeof data.extractedText === 'string' ? data.extractedText : ''
        } else {
          console.warn('PDF extract: window.beap.extractPdfText unavailable')
        }
      } catch (err) {
        console.warn('PDF extract failed:', err)
      }
    } else {
      text = await file.text()
    }
    if (text.trim()) {
      batch.push({ name: file.name, text: text.trim() })
    }
  }

  if (batch.length > 0) {
    addDocuments(batch)
  }
}
