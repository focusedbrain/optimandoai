/**
 * WR Chat model selector rows from Electron `llm.status` / GET `/api/llm/status`.
 * Prefers `wrChatAvailableModels` (merged with Host/cross-device rows) when present.
 */

export type WrChatSelectorRow = {
  /** Stable route id: Ollama tag, `host-internal:…`, or cloud id. */
  name: string
  displayLabel?: string
  /** PopupChatView `modelMenuPrimary` prefers this when set. */
  displayTitle?: string
  size?: string
  hostAi?: boolean
  section?: 'host' | 'cloud'
}

export function buildWrChatSelectorModelsFromLlmStatus(data: {
  modelsInstalled?: Array<{ name?: string; size?: number }>
  wrChatAvailableModels?: Array<{ id: string; displayName: string; kind: string }>
}): WrChatSelectorRow[] {
  const merged = data.wrChatAvailableModels
  if (Array.isArray(merged) && merged.length > 0) {
    return merged.map((r) => ({
      name: r.id,
      displayLabel: r.displayName,
      displayTitle: r.displayName,
      hostAi: r.kind === 'host_internal',
      section: r.kind === 'cloud' ? 'cloud' : r.kind === 'host_internal' ? 'host' : undefined,
    }))
  }
  const locals = data.modelsInstalled ?? []
  return locals
    .map((m) => ({
      name: (m.name ?? '').trim(),
      size: m.size != null ? String(m.size) : undefined,
    }))
    .filter((r) => r.name.length > 0)
}

/** Compact label for the Send button chip (never logs content). */
export function wrChatModelButtonShortLabel(modelId: string, rows: WrChatSelectorRow[]): string {
  if (!modelId) return 'No model'
  const row = rows.find((r) => r.name === modelId)
  const title = row?.displayTitle ?? row?.displayLabel
  if (title && (modelId.startsWith('host-internal:') || modelId.startsWith('host-inference:'))) {
    const stripped = title.replace(/^Host AI\s*·\s*/i, '').trim()
    const base = stripped || 'Host AI'
    return base.length > 14 ? `${base.slice(0, 14)}…` : base
  }
  const baseName = modelId.split(':')[0]
  return baseName.length > 12 ? `${baseName.slice(0, 12)}…` : baseName
}
