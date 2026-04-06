/**
 * Injects custom mode instructions into LLM routing / chat context (alongside chat-focus prefix).
 */

import type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'
import { formatCustomModeIntervalPresetLabel } from '../shared/ui/customModeIntervalPresets'

export function getCustomModeLlmPrefix(runtime: CustomModeRuntimeConfig | null): string | null {
  if (!runtime) return null
  const parts: string[] = []
  const focus = runtime.searchFocus?.trim()
  if (focus) parts.push(`[Mode focus: ${focus}]`)
  const ignore = runtime.ignoreInstructions?.trim()
  if (ignore) parts.push(`[Deprioritize or ignore: ${ignore}]`)

  if (runtime.sessionId?.trim()) {
    parts.push(`[Session id: ${runtime.sessionId.trim()}]`)
  } else if (runtime.sessionMode !== 'shared') {
    parts.push(`[Session mode: ${runtime.sessionMode}]`)
  }

  if (runtime.intervalSeconds != null && runtime.intervalSeconds >= 1) {
    parts.push(`[Periodic scan every ${formatCustomModeIntervalPresetLabel(runtime.intervalSeconds)}]`)
  }

  const scopeUrls = runtime.scopeUrls?.filter((u) => u.trim()) ?? []
  if (scopeUrls.length) {
    parts.push(`[Scope URLs: ${scopeUrls.join('; ')}]`)
  }
  const diffFolders = runtime.diffWatchFolders?.map((p) => p.trim()).filter(Boolean) ?? []
  if (diffFolders.length) {
    parts.push(`[Diff watch folders: ${diffFolders.join('; ')}]`)
  }

  if (parts.length === 0) return null
  return parts.join('\n')
}

export function mergeLlmContextPrefixes(
  chatFocusPrefix: string | null | undefined,
  customModePrefix: string | null | undefined,
): string | null {
  const chunks = [chatFocusPrefix, customModePrefix].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  )
  if (chunks.length === 0) return null
  return chunks.join('\n\n')
}
