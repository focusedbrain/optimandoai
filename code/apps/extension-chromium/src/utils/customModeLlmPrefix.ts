/**
 * Injects custom mode instructions into LLM routing / chat context (alongside chat-focus prefix).
 */

import type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'
import { formatCustomModeIntervalPresetLabel } from '../shared/ui/customModeIntervalPresets'
import { formatCustomModeProfileFieldsForPrefix } from '../shared/ui/customModeTypes'

function appendWrChatContextParts(runtime: CustomModeRuntimeConfig, parts: string[]): void {
  const profileBlock = formatCustomModeProfileFieldsForPrefix(runtime.profileFields)
  if (profileBlock) parts.push(profileBlock)

  if (runtime.sessionId?.trim()) {
    parts.push(`[Session id: ${runtime.sessionId.trim()}]`)
  } else if (runtime.sessionMode !== 'shared') {
    parts.push(`[Session mode: ${runtime.sessionMode}]`)
  }

  const scopeUrls = runtime.scopeUrls?.filter((u) => u.trim()) ?? []
  if (scopeUrls.length) {
    parts.push(`[Scope URLs: ${scopeUrls.join('; ')}]`)
  }
  const diffFolders = runtime.diffWatchFolders?.map((p) => p.trim()).filter(Boolean) ?? []
  if (diffFolders.length) {
    parts.push(`[Diff watch folders: ${diffFolders.join('; ')}]`)
  }

  const wx = runtime.wrExpertProfile
  if (wx) {
    const et = wx.emphasis?.terms?.filter(Boolean) ?? []
    const eh = wx.emphasis?.entityHints?.filter(Boolean) ?? []
    const dt = wx.deemphasis?.terms?.filter(Boolean) ?? []
    if (et.length) parts.push(`[WR Expert emphasis: ${et.join('; ')}]`)
    if (eh.length) parts.push(`[WR Expert entity hints: ${eh.join('; ')}]`)
    if (dt.length) parts.push(`[WR Expert deprioritize: ${dt.join('; ')}]`)
  }
}

/**
 * Full mode prefix — includes analysis/scan instructions (`searchFocus`, `systemInstructions`).
 * Use on mode RUN / scan paths, not normal WR Chat.
 */
export function getCustomModeLlmPrefix(runtime: CustomModeRuntimeConfig | null): string | null {
  if (!runtime) return null
  const parts: string[] = []
  const system = runtime.systemInstructions?.trim()
  if (system) parts.push(`[System instructions for this mode]\n${system}`)
  const focus = runtime.searchFocus?.trim()
  if (focus) parts.push(`[Mode focus: ${focus}]`)
  const ignore = runtime.ignoreInstructions?.trim()
  if (ignore) parts.push(`[Deprioritize or ignore: ${ignore}]`)

  appendWrChatContextParts(runtime, parts)

  if (runtime.intervalSeconds != null && runtime.intervalSeconds >= 1) {
    parts.push(`[Periodic scan every ${formatCustomModeIntervalPresetLabel(runtime.intervalSeconds)}]`)
  }

  if (parts.length === 0) return null
  return parts.join('\n')
}

/**
 * WR Chat conversational prefix — user-provided context only.
 * Does NOT inject mode analysis/scan instructions (`searchFocus`, `systemInstructions`, scan interval).
 * Mode behavior applies when the mode is RUN, not because it is selected in the UI.
 */
export function getCustomModeLlmPrefixForWrChat(runtime: CustomModeRuntimeConfig | null): string | null {
  if (!runtime) return null
  const parts: string[] = []
  appendWrChatContextParts(runtime, parts)
  if (parts.length === 0) return null
  return parts.join('\n')
}

export function mergeLlmContextPrefixes(
  ...chunks: Array<string | null | undefined>
): string | null {
  const parts = chunks.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (parts.length === 0) return null
  return parts.join('\n\n')
}
