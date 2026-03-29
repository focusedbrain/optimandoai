/** Distinct from AI context uploads; parser only needs a stable id. */
const PACKAGE_PREVIEW_ATTACHMENT_ID = 'beap-inline-package-preview'

/** Electron renderer: PDF extract runs via main-process IPC (HTTP route requires X-Launch-Secret). */
function extractPdfViaMainProcess(opts: {
  attachmentId: string
  base64: string
}): Promise<{ success?: boolean; extractedText?: string; error?: string } | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const beap = window.beap as { extractPdfText?: (p: { attachmentId: string; base64: string }) => Promise<unknown> }
  if (typeof beap?.extractPdfText !== 'function') return Promise.resolve(null)
  return beap.extractPdfText(opts) as Promise<{ success?: boolean; extractedText?: string; error?: string }>
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/**
 * Extract readable text from a package attachment (PDF via main-process IPC `parser:extractPdfText`).
 * Returns empty text with optional error when preview is not available or extraction fails.
 */
export async function extractTextForPackagePreview(opts: {
  name: string
  mimeType?: string
  base64: string
}): Promise<{ text: string; error?: string }> {
  const lower = opts.name.toLowerCase()
  const mime = (opts.mimeType || '').toLowerCase()

  if (lower.endsWith('.pdf') || mime === 'application/pdf') {
    try {
      const ipc = await extractPdfViaMainProcess({
        attachmentId: PACKAGE_PREVIEW_ATTACHMENT_ID,
        base64: opts.base64,
      })
      if (ipc) {
        if (ipc.success && typeof ipc.extractedText === 'string' && ipc.extractedText.trim()) {
          return { text: ipc.extractedText.trim() }
        }
        return {
          text: '',
          error: ipc.error || 'Could not extract text from this PDF (empty or parser unavailable).',
        }
      }
      return {
        text: '',
        error: 'PDF extract is only available inside the WR Desk app (preload bridge missing).',
      }
    } catch (e) {
      return { text: '', error: e instanceof Error ? e.message : 'PDF extract failed' }
    }
  }

  const textLike =
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.json') ||
    mime.startsWith('text/')

  if (textLike) {
    try {
      const text = base64ToUtf8(opts.base64)
      if (text.trim()) return { text: text.trim() }
      return { text: '', error: 'File decoded but contained no readable text.' }
    } catch {
      return { text: '', error: 'Could not decode text from this file.' }
    }
  }

  return { text: '', error: 'No text preview for this file type (add a PDF or plain text file to inspect).' }
}
