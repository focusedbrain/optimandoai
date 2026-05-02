/**
 * Shared WR Chat model selection for extension sidebar + popup (not Hybrid Search / orchestrator).
 * Uses localStorage so sidepanel and popup (same extension origin) stay aligned; dispatches a
 * custom event for same-window sync and relies on the storage event for cross-window.
 */

export const WRCHAT_EXT_ACTIVE_MODEL_KEY = 'optimando-wr-chat-active-model'
const WRCHAT_EXT_META_KEY = 'optimando-wr-chat-extension-meta'

export type WrChatExtensionSelectionSource = 'user' | 'auto'

type PersistedMeta = {
  v: 1
  selectionSource: WrChatExtensionSelectionSource
  ts: number
}

function dispatchModelChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('optimando-wrchat-extension-model-changed'))
  } catch {
    /* noop */
  }
}

function parseMeta(raw: string | null): PersistedMeta | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as PersistedMeta
    if (j?.v === 1 && (j.selectionSource === 'user' || j.selectionSource === 'auto')) return j
  } catch {
    /* ignore */
  }
  return null
}

/** Persist the active WR Chat model id for sidebar + popup. Empty string clears. */
export function persistWrChatExtensionModelId(
  modelId: string,
  selectionSource: WrChatExtensionSelectionSource,
): void {
  const id = String(modelId ?? '').trim()
  try {
    if (!id) {
      localStorage.removeItem(WRCHAT_EXT_ACTIVE_MODEL_KEY)
      localStorage.removeItem(WRCHAT_EXT_META_KEY)
      dispatchModelChanged()
      return
    }
    localStorage.setItem(WRCHAT_EXT_ACTIVE_MODEL_KEY, id)
    const meta: PersistedMeta = { v: 1, selectionSource, ts: Date.now() }
    localStorage.setItem(WRCHAT_EXT_META_KEY, JSON.stringify(meta))
    dispatchModelChanged()
  } catch {
    /* ignore */
  }
}

export function loadPersistedWrChatExtensionModel(): {
  modelId: string
  selectionSource: WrChatExtensionSelectionSource
} | null {
  try {
    const id = localStorage.getItem(WRCHAT_EXT_ACTIVE_MODEL_KEY)?.trim()
    if (!id) return null
    const meta = parseMeta(localStorage.getItem(WRCHAT_EXT_META_KEY))
    return { modelId: id, selectionSource: meta?.selectionSource ?? 'auto' }
  } catch {
    return null
  }
}

export function clearPersistedWrChatExtensionModel(): void {
  persistWrChatExtensionModelId('', 'auto')
}

/**
 * Subscribe to sidebar/popup model changes (storage event from other extension pages + custom event).
 */
export function subscribeWrChatExtensionModel(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === WRCHAT_EXT_ACTIVE_MODEL_KEY || e.key === WRCHAT_EXT_META_KEY) onChange()
  }
  const onCustom = () => onChange()
  window.addEventListener('storage', onStorage)
  window.addEventListener('optimando-wrchat-extension-model-changed', onCustom as EventListener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('optimando-wrchat-extension-model-changed', onCustom as EventListener)
  }
}

export function mapExtensionSelectionSourceForLog(
  src: WrChatExtensionSelectionSource,
): 'user' | 'default' {
  return src === 'user' ? 'user' : 'default'
}
