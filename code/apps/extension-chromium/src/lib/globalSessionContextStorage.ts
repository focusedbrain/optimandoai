/**
 * Load Global Session Context blobs from chrome.storage (Stage 1 read helper — no LLM injection).
 */

import {
  GLOBAL_ACCOUNT_CONTEXT_KEY,
  globalSessionContextStorageKeys,
  normalizeOrchestratorSessionKey,
} from './resolveOrchestratorSessionKey'

export type GlobalSessionContextBlob = {
  text: string
  pdfFiles?: Array<{ name?: string; dataUrl?: string }>
}

export type LoadedGlobalSessionContext = {
  user: GlobalSessionContextBlob | null
  publisher: GlobalSessionContextBlob | null
  account: GlobalSessionContextBlob | null
  sessionKey: string | null
}

function normalizeBlob(raw: unknown): GlobalSessionContextBlob | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = typeof (raw as { text?: unknown }).text === 'string' ? (raw as { text: string }).text : ''
  const pdfRaw = (raw as { pdfFiles?: unknown }).pdfFiles
  const pdfFiles = Array.isArray(pdfRaw)
    ? pdfRaw.filter((f): f is { name?: string; dataUrl?: string } => !!f && typeof f === 'object')
    : undefined
  if (!text.trim() && (!pdfFiles || pdfFiles.length === 0)) return null
  return { text, pdfFiles }
}

function readStorageKeys(keys: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (keys.length === 0) {
      resolve({})
      return
    }
    try {
      chrome.storage?.local?.get(keys, (data: Record<string, unknown>) => {
        resolve(data ?? {})
      })
    } catch {
      resolve({})
    }
  })
}

/** Given a canonical session key, load user/publisher/account context blobs. */
export async function loadGlobalSessionContextForKey(
  sessionKey: string | null | undefined,
): Promise<LoadedGlobalSessionContext> {
  const canonical = normalizeOrchestratorSessionKey(sessionKey)
  const keys = canonical
    ? [
        globalSessionContextStorageKeys(canonical).userContextKey,
        globalSessionContextStorageKeys(canonical).publisherContextKey,
        GLOBAL_ACCOUNT_CONTEXT_KEY,
      ]
    : [GLOBAL_ACCOUNT_CONTEXT_KEY]

  const data = await readStorageKeys(keys)
  if (!canonical) {
    return {
      sessionKey: null,
      user: null,
      publisher: null,
      account: normalizeBlob(data[GLOBAL_ACCOUNT_CONTEXT_KEY]),
    }
  }

  const storageKeys = globalSessionContextStorageKeys(canonical)
  return {
    sessionKey: canonical,
    user: normalizeBlob(data[storageKeys.userContextKey]),
    publisher: normalizeBlob(data[storageKeys.publisherContextKey]),
    account: normalizeBlob(data[GLOBAL_ACCOUNT_CONTEXT_KEY]),
  }
}
