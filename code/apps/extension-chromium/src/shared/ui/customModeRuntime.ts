/**
 * Runtime view of an active custom WR Chat mode — consumed by chat / LLM paths.
 * Built-in modes do not produce this shape; use {@link resolveModeForCapabilities} for UI behavior.
 */

import type { CustomModeDefinition, CustomRunMode, SessionMode } from './customModeTypes'

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
  runMode: CustomRunMode
  intervalMinutes: number | null
}

export function customModeDefinitionToRuntime(def: CustomModeDefinition): CustomModeRuntimeConfig {
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
    runMode: def.runMode,
    intervalMinutes: def.intervalMinutes,
  }
}
