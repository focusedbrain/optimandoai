/**
 * Shared payload builder for Initiate handshake RPC.
 * Used by SendHandshakeDelivery, InitiateHandshakeDialog, HandshakeRequestForm
 * to produce policy_selections, profile_items, context_blocks with policy_mode/policy.
 */

import { computeBlockHashClient } from '../utils/contextBlockHash'
import type { ProfileContextItem, ContextBlockWithPolicy } from '@shared/handshake/types'

export interface BuildInitiateContextOptionsParams {
  skipVaultContext: boolean
  policySelections?: { cloud_ai?: boolean; internal_ai?: boolean }
  selectedProfileItems: ProfileContextItem[]
  messageText?: string
  contextGraphText: string
  contextGraphType: 'text' | 'json'
  adhocBlockPolicy: { policy_mode: 'inherit' | 'override'; policy?: { cloud_ai?: boolean; internal_ai?: boolean } }
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
  const defaultPolicy = policySelections ?? { cloud_ai: false, internal_ai: false }
  if (defaultPolicy.cloud_ai !== undefined || defaultPolicy.internal_ai !== undefined) {
    opts.policy_selections = {
      cloud_ai: defaultPolicy.cloud_ai ?? false,
      internal_ai: defaultPolicy.internal_ai ?? false,
    }
  }
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
    const block: ContextBlockWithPolicy = {
      block_id: 'ctx-msg-pending',
      block_hash: blockHash,
      type: 'plaintext',
      content,
      scope_id: 'initiator',
      policy_mode: adhocBlockPolicy.policy_mode,
      policy: adhocBlockPolicy.policy,
    }
    opts.context_blocks = [block]
  }
  return opts
}
