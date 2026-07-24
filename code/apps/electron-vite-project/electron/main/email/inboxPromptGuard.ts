/**
 * build039 — prompt-side guard before inbox analyze/classify against local llama.cpp.
 * Truncates oversized email/context deterministically instead of silent server rejection.
 */

/** Matches {@link INBOX_LLM_MAX_OUTPUT_TOKENS} in inboxLlmChat.ts (avoid import cycle). */
const INBOX_LLM_MAX_OUTPUT_TOKENS = 2_048

/** Jinja/chat template + JSON schema overhead (conservative). */
export const INBOX_PROMPT_TEMPLATE_OVERHEAD_TOKENS = 256

const TRUNCATION_MARKER = '\n\n[… middle of email truncated for AI memory limits …]\n\n'

/** Conservative chars/token estimate for mixed email + JSON prompts. */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  if (maxChars <= TRUNCATION_MARKER.length + 16) return text.slice(0, maxChars)
  const available = maxChars - TRUNCATION_MARKER.length
  const headChars = Math.ceil(available * 0.55)
  const tailChars = Math.floor(available * 0.45)
  return text.slice(0, headChars) + TRUNCATION_MARKER + text.slice(-tailChars)
}

/** Keep email headers + head/tail of body when truncating. */
export function truncateEmailLikeContent(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return ''
  const maxChars = Math.floor(tokenBudget * 3.5)
  if (text.length <= maxChars) return text

  const headerSplit = text.indexOf('\n\n')
  if (headerSplit < 0) return truncateMiddle(text, maxChars)

  const headers = text.slice(0, headerSplit + 2)
  const body = text.slice(headerSplit + 2)
  const headerTokens = estimateTextTokens(headers)
  const bodyBudget = tokenBudget - headerTokens
  if (bodyBudget <= 32) return truncateMiddle(text, maxChars)

  const bodyMaxChars = Math.floor(bodyBudget * 3.5)
  if (body.length <= bodyMaxChars) return text

  const markerLen = TRUNCATION_MARKER.length
  const available = Math.max(0, bodyMaxChars - markerLen)
  const headChars = Math.ceil(available * 0.55)
  const tailChars = Math.floor(available * 0.45)
  return headers + body.slice(0, headChars) + TRUNCATION_MARKER + body.slice(-tailChars)
}

export function guardInboxPromptForCtxSlot(p: {
  system: string
  user: string
  ctxPerSlot: number
  maxOutputTokens?: number
}): {
  system: string
  user: string
  truncated: boolean
  estimatedPromptTokens: number
  slotLimit: number
} {
  const maxOut = p.maxOutputTokens ?? INBOX_LLM_MAX_OUTPUT_TOKENS
  const promptBudget = p.ctxPerSlot - maxOut - INBOX_PROMPT_TEMPLATE_OVERHEAD_TOKENS
  const sysTokens = estimateTextTokens(p.system)
  const userTokens = estimateTextTokens(p.user)
  const total = sysTokens + userTokens

  if (total <= promptBudget) {
    return {
      system: p.system,
      user: p.user,
      truncated: false,
      estimatedPromptTokens: total,
      slotLimit: p.ctxPerSlot,
    }
  }

  let system = p.system
  let user = p.user
  let truncated = false

  const userBudget = Math.max(64, promptBudget - sysTokens)
  if (userTokens > userBudget) {
    user = truncateEmailLikeContent(p.user, userBudget)
    truncated = true
  }

  const afterUserTokens = estimateTextTokens(system) + estimateTextTokens(user)
  if (afterUserTokens > promptBudget && sysTokens > 64) {
    const sysBudget = Math.max(64, promptBudget - estimateTextTokens(user))
    system = truncateMiddle(p.system, Math.floor(sysBudget * 3.5))
    truncated = true
  }

  const estimatedPromptTokens = estimateTextTokens(system) + estimateTextTokens(user)
  if (estimatedPromptTokens > promptBudget) {
    user = truncateEmailLikeContent(user, Math.max(64, promptBudget - estimateTextTokens(system)))
    truncated = true
  }

  return {
    system,
    user,
    truncated,
    estimatedPromptTokens: estimateTextTokens(system) + estimateTextTokens(user),
    slotLimit: p.ctxPerSlot,
  }
}
