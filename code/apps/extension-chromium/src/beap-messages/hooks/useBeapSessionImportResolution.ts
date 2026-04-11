import { useMemo } from 'react'
import type { BeapMessage } from '../beapInboxTypes'
import {
  resolveBeapSessionImportPayload,
  type BeapSessionImportResolution,
} from '../sessionImportPayloadResolver'

/**
 * Memoized {@link resolveBeapSessionImportPayload} for inbox/detail UI.
 * When `message` is null/undefined, returns a stable `none` resolution.
 */
export function useBeapSessionImportResolution(
  message: BeapMessage | null | undefined,
  options?: { pageUrlFallback?: string },
): BeapSessionImportResolution {
  const pageUrl = options?.pageUrlFallback
  return useMemo(() => {
    if (!message) {
      return {
        status: 'none',
        code: 'no_candidate_attachment',
        reason: 'No message selected.',
      } as const
    }
    return resolveBeapSessionImportPayload(message, { pageUrlFallback: pageUrl })
  }, [message, pageUrl])
}
