/**
 * Global Session Context (Layer 1) formatting and inference prefix assembly.
 * Scope A: direct text injection only — no RAG/embeddings.
 */

import type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'
import {
  getCustomModeLlmPrefix,
  getCustomModeLlmPrefixForWrChat,
  mergeLlmContextPrefixes,
} from '../utils/customModeLlmPrefix'
import {
  loadGlobalSessionContextForKey,
  type LoadedGlobalSessionContext,
} from './globalSessionContextStorage'

export const GLOBAL_SESSION_CONTEXT_MAX_CHARS = 32_000

function pdfAttachmentNote(count: number): string {
  if (count <= 0) return ''
  return count === 1 ? '[1 attached document]' : `[${count} attached documents]`
}

function formatBlobSection(
  header: string,
  blob: { text: string; pdfFiles?: Array<unknown> } | null,
): string | null {
  if (!blob) return null
  const parts: string[] = []
  const text = blob.text?.trim()
  if (text) parts.push(text)
  const pdfNote = pdfAttachmentNote(blob.pdfFiles?.length ?? 0)
  if (pdfNote) parts.push(pdfNote)
  if (parts.length === 0) return null
  return `[${header}]\n${parts.join('\n')}`
}

/** Format loaded user / publisher / account blobs into a single Layer-1 block. */
export function formatGlobalSessionContextForLlmPrefix(loaded: LoadedGlobalSessionContext): string | null {
  const sections = [
    formatBlobSection('Session context — user', loaded.user),
    formatBlobSection('Session context — publisher', loaded.publisher),
    formatBlobSection('Account context', loaded.account),
  ].filter((x): x is string => !!x)

  if (sections.length === 0) return null

  let joined = sections.join('\n\n')
  if (joined.length > GLOBAL_SESSION_CONTEXT_MAX_CHARS) {
    joined = `${joined.slice(0, GLOBAL_SESSION_CONTEXT_MAX_CHARS)}\n[… context truncated …]`
  }
  return joined
}

export async function loadAndFormatGlobalSessionContextPrefix(
  sessionKey: string | null | undefined,
): Promise<string | null> {
  const loaded = await loadGlobalSessionContextForKey(sessionKey)
  return formatGlobalSessionContextForLlmPrefix(loaded)
}

/** Layer 2 (mode profileFields block) applies only to the mode's allocated model. */
export function shouldApplyModeContextLayer(
  modeRuntime: CustomModeRuntimeConfig | null | undefined,
  resolvedModelId: string,
  wrChatPickerModelId: string,
): boolean {
  if (!modeRuntime) return false
  const resolved = resolvedModelId.trim()
  if (!resolved) return false
  const allocated = modeRuntime.modelName?.trim()
  if (allocated) return resolved === allocated
  const picker = wrChatPickerModelId.trim()
  return !picker || resolved === picker
}

/**
 * Build full inference prefix: Layer 1 (global) → chat focus → Layer 2 (mode, allocated model only).
 */
export async function buildInferenceContextPrefix(options: {
  sessionKey: string | null | undefined
  chatFocusPrefix?: string | null
  modeRuntime?: CustomModeRuntimeConfig | null
  resolvedModelId: string
  wrChatPickerModelId: string
  /** Mode-action / automation run — full prefix incl. systemInstructions + searchFocus. */
  runMode?: boolean
}): Promise<string | null> {
  const globalBlock = await loadAndFormatGlobalSessionContextPrefix(options.sessionKey)
  let modeBlock: string | null = null
  if (options.runMode && options.modeRuntime) {
    modeBlock = getCustomModeLlmPrefix(options.modeRuntime)
  } else if (
    shouldApplyModeContextLayer(
      options.modeRuntime,
      options.resolvedModelId,
      options.wrChatPickerModelId,
    )
  ) {
    modeBlock = getCustomModeLlmPrefixForWrChat(options.modeRuntime ?? null)
  }

  return mergeLlmContextPrefixes(globalBlock, options.chatFocusPrefix, modeBlock)
}

/** Layer 1 only — for agent-box models that are not the mode allocation. */
export async function buildGlobalSessionContextPrefixOnly(
  sessionKey: string | null | undefined,
  chatFocusPrefix?: string | null,
): Promise<string | null> {
  const globalBlock = await loadAndFormatGlobalSessionContextPrefix(sessionKey)
  return mergeLlmContextPrefixes(globalBlock, chatFocusPrefix)
}
