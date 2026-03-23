/**
 * Shared payload builder for Initiate handshake RPC.
 * Used by SendHandshakeDelivery, InitiateHandshakeDialog, HandshakeRequestForm
 * to produce policy_selections, profile_items, context_blocks with policy_mode/policy.
 */

import { computeBlockHashClient } from '../utils/contextBlockHash'
import { parsePolicyToMode } from '@shared/handshake/policyUtils'
import type { AiProcessingMode, ProfileContextItem, ContextBlockWithPolicy } from '@shared/handshake/types'

export interface BuildInitiateContextOptionsParams {
  skipVaultContext: boolean
  policySelections?: { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean }
  selectedProfileItems: ProfileContextItem[]
  messageText?: string
  contextGraphText: string
  contextGraphType: 'text' | 'json'
  adhocBlockPolicy: { policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode?: AiProcessingMode } }
}

export async function buildInitiateContextOptions(
  params: BuildInitiateContextOptionsParams,
): Promise<Record<string, unknown>> {
  const {
    skipVaultContext,
    policySelections,
    selectedProfileItems,
    messageText = '',
    contextGraphText,
    contextGraphType,
    adhocBlockPolicy,
  } = params

  const opts: Record<string, unknown> = { skipVaultContext }
  const mode = parsePolicyToMode(policySelections)
  opts.policy_selections = { ai_processing_mode: mode }
  if (selectedProfileItems.length > 0) {
    opts.profile_ids = selectedProfileItems.map((i) => i.profile_id)
    opts.profile_items = selectedProfileItems
  }
  const contextText = contextGraphText.trim()
  const msgText = (messageText ?? '').trim()
  const combinedText = [msgText, contextText].filter(Boolean).join('\n\n')
  if (combinedText) {
    let content: string | Record<string, unknown>
    if (contextGraphType === 'json' && contextText && !msgText) {
      try {
        content = JSON.parse(contextText) as Record<string, unknown>
      } catch {
        content = combinedText
      }
    } else {
      content = combinedText
    }
    const blockHash = await computeBlockHashClient(content)
    const blockPolicy = adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy
      ? { ai_processing_mode: adhocBlockPolicy.policy.ai_processing_mode ?? parsePolicyToMode(policySelections) }
      : undefined
    const block: ContextBlockWithPolicy = {
      block_id: 'ctx-msg-pending',
      block_hash: blockHash,
      type: 'plaintext',
      content,
      scope_id: 'initiator',
      policy_mode: adhocBlockPolicy.policy_mode,
      policy: blockPolicy,
    }
    opts.context_blocks = [block]
  }
  return opts
}

/** Build context options for handshake.accept (responder attaching profiles + ad-hoc). */
export interface BuildAcceptContextOptionsParams {
  policySelections?: { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean }
  selectedProfileItems: ProfileContextItem[]
  contextGraphText: string
  contextGraphType: 'text' | 'json'
  adhocBlockPolicy: { policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode?: AiProcessingMode } }
}

export async function buildAcceptContextOptions(
  params: BuildAcceptContextOptionsParams,
): Promise<Record<string, unknown>> {
  const {
    policySelections,
    selectedProfileItems,
    contextGraphText,
    contextGraphType,
    adhocBlockPolicy,
  } = params

  const opts: Record<string, unknown> = {}
  const mode = parsePolicyToMode(policySelections)
  opts.policy_selections = { ai_processing_mode: mode }
  if (selectedProfileItems.length > 0) {
    opts.profile_ids = selectedProfileItems.map((i) => i.profile_id)
    opts.profile_items = selectedProfileItems
  }
  const contextText = contextGraphText.trim()
  if (contextText) {
    let content: string | Record<string, unknown>
    if (contextGraphType === 'json') {
      try {
        content = JSON.parse(contextText) as Record<string, unknown>
      } catch {
        content = contextText
      }
    } else {
      content = contextText
    }
    const blockHash = await computeBlockHashClient(content)
    const blockPolicy = adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy
      ? { ai_processing_mode: adhocBlockPolicy.policy.ai_processing_mode ?? parsePolicyToMode(policySelections) }
      : undefined
    const block: ContextBlockWithPolicy = {
      block_id: 'ctx-msg-pending',
      block_hash: blockHash,
      type: 'plaintext',
      content,
      scope_id: 'acceptor',
      policy_mode: adhocBlockPolicy.policy_mode,
      policy: blockPolicy,
    }
    opts.context_blocks = [block]
  }
  return opts
}
