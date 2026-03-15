/**
 * useViewOriginalArtefact — Download original attachment artefact
 *
 * Triggers browser download of the decrypted original file.
 * Used when user confirms "Open Original" after the warning dialog.
 *
 * @version 1.0.0
 */

import { useCallback } from 'react'
import { getOriginalArtefact } from '../services'
import { useBeapInboxStore } from '../useBeapInboxStore'
import type { BeapAttachment } from '../beapInboxTypes'

/**
 * Trigger a browser download for a base64-encoded file.
 */
function triggerDownload(base64: string, filename: string, mime: string): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || 'attachment'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export interface UseViewOriginalArtefactResult {
  /** Attempt to download and open the original artefact. Returns error message if failed. */
  viewOriginal: (
    messageId: string,
    attachment: BeapAttachment,
  ) => Promise<string | null>
}

/**
 * Hook to get the viewOriginal handler for opening original artefacts.
 */
export function useViewOriginalArtefact(): UseViewOriginalArtefactResult {
  const getPackageForMessage = useBeapInboxStore((s) => s.getPackageForMessage)

  const viewOriginal = useCallback(
    async (
      messageId: string,
      attachment: BeapAttachment,
    ): Promise<string | null> => {
      const pkg = getPackageForMessage(messageId)
      if (!pkg) {
        return 'Message data not available.'
      }

      const artefact = getOriginalArtefact(pkg, attachment.attachmentId)
      if (!artefact) {
        return 'Original file not available (pBEAP packages may not include encrypted originals).'
      }

      if (!artefact.base64) {
        return 'Original file data not available.'
      }

      try {
        triggerDownload(
          artefact.base64,
          artefact.filename || attachment.filename,
          artefact.mime || attachment.mimeType,
        )
        return null
      } catch (err) {
        return err instanceof Error ? err.message : 'Download failed.'
      }
    },
    [getPackageForMessage],
  )

  return { viewOriginal }
}
