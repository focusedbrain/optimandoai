/**
 * Runtime view of an active custom WR Chat mode — consumed by chat / LLM paths.
 * Built-in modes do not produce this shape; use {@link resolveModeForCapabilities} for UI behavior.
 */

import type { WrExpertParsedProfile } from '../../utils/parseWrExpertMarkdown'
import type { CustomModeDefinition, SessionMode } from './customModeTypes'
import { getCustomModeScopeFromMetadata } from './customModeTypes'

export interface CustomModeRuntimeConfig {
  modeId: string
  name: string
  modelProvider: string
  /** Empty string means no preset — WR Chat uses whichever model is active in the picker. */
  modelName: string
  endpoint: string
  sessionId: string | null
  sessionMode: SessionMode
  searchFocus: string
  ignoreInstructions: string
  intervalSeconds: number | null
  /** Optional http(s) URLs / host patterns this mode should prioritize. */
  scopeUrls: string[]
  /** Optional folder paths for desktop file-change diff triggers. */
  diffWatchFolders: string[]
  /** Parsed WR Expert profile (never raw markdown). */
  wrExpertProfile: WrExpertParsedProfile | null
}

function wrExpertFromMetadata(meta: Record<string, unknown> | undefined): WrExpertParsedProfile | null {
  const p = meta?.wrExpertProfile
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const emphasis = (p as { emphasis?: { terms?: unknown; entityHints?: unknown } }).emphasis
  const deemphasis = (p as { deemphasis?: { terms?: unknown } }).deemphasis
  const terms = Array.isArray(emphasis?.terms)
    ? emphasis.terms.filter((x): x is string => typeof x === 'string')
    : []
  const entityHints = Array.isArray(emphasis?.entityHints)
    ? emphasis.entityHints.filter((x): x is string => typeof x === 'string')
    : []
  const dterms = Array.isArray(deemphasis?.terms)
    ? deemphasis.terms.filter((x): x is string => typeof x === 'string')
    : []
  if (terms.length === 0 && entityHints.length === 0 && dterms.length === 0) return null
  return {
    emphasis: { terms, entityHints },
    deemphasis: { terms: dterms },
    fileSha256: typeof (p as { fileSha256?: unknown }).fileSha256 === 'string' ? (p as { fileSha256: string }).fileSha256 : undefined,
  }
}

export function customModeDefinitionToRuntime(def: CustomModeDefinition): CustomModeRuntimeConfig {
  const md = def.metadata as Record<string, unknown> | undefined
  const scope = getCustomModeScopeFromMetadata(md)
  const modelName = typeof def.modelName === 'string' ? def.modelName : ''
  return {
    modeId: def.id,
    name: def.name,
    modelProvider: def.modelProvider,
    modelName,
    endpoint: def.endpoint,
    sessionId: def.sessionId,
    sessionMode: def.sessionMode,
    searchFocus: def.searchFocus,
    ignoreInstructions: def.ignoreInstructions,
    intervalSeconds: def.intervalSeconds,
    scopeUrls: scope.scopeUrls,
    diffWatchFolders: scope.diffWatchFolders,
    wrExpertProfile: wrExpertFromMetadata(md),
  }
}
