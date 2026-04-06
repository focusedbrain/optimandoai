/**
 * Runtime view of an active custom WR Chat mode — consumed by chat / LLM paths.
 * Built-in modes do not produce this shape; use {@link resolveModeForCapabilities} for UI behavior.
 */

import type { CustomModeDefinition, SessionMode } from './customModeTypes'
import { getCustomModeScopeFromMetadata } from './customModeTypes'

export interface CustomModeRuntimeConfig {
  modeId: string
  name: string
  modelProvider: string
  modelName: string
  endpoint: string
  sessionId: string | null
  sessionMode: SessionMode
  searchFocus: string
  ignoreInstructions: string
  intervalMinutes: number | null
  /** Optional http(s) URLs / host patterns this mode should prioritize. */
  scopeUrls: string[]
  /** Optional folder path for desktop file-change diff triggers. */
  diffWatchFolder: string
}

export function customModeDefinitionToRuntime(def: CustomModeDefinition): CustomModeRuntimeConfig {
  const scope = getCustomModeScopeFromMetadata(def.metadata as Record<string, unknown> | undefined)
  return {
    modeId: def.id,
    name: def.name,
    modelProvider: def.modelProvider,
    modelName: def.modelName,
    endpoint: def.endpoint,
    sessionId: def.sessionId,
    sessionMode: def.sessionMode,
    searchFocus: def.searchFocus,
    ignoreInstructions: def.ignoreInstructions,
    intervalMinutes: def.intervalMinutes,
    scopeUrls: scope.scopeUrls,
    diffWatchFolder: scope.diffWatchFolder,
  }
}
