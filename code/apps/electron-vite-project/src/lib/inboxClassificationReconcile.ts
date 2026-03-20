/**
 * Reconciles inbox LLM output with WR Desk / WRExpert coherence rules.
 *
 * Spec: electron/WRExpert.default.md — promotional and unsolicited commercial email
 * → pending_delete, urgency 1–3, not urgent/action_required.
 *
 * Used by Electron main (ipc) and renderer (streaming analysis).
 */

export type ReconcileClassifyInput = {
  /** Normalized category (lowercase, from VALID_NEW set). */
  category: string
  urgency: number
  needsReply: boolean
  reason: string
  summary: string
}

export type ReconcileContext = {
  subject?: string | null
  body?: string | null
}

/** Combine fields the model often uses to describe the same message (may contradict scores). */
export function combinedClassificationText(ctx: ReconcileContext & Pick<ReconcileClassifyInput, 'reason' | 'summary'>): string {
  const subj = ctx.subject ?? ''
  const body = (ctx.body ?? '').slice(0, 4000)
  return `${ctx.reason}\n${ctx.summary}\n${subj}\n${body}`
}

/**
 * High-stakes signals: if present, we do NOT downgrade marketing-looking mail
 * (e.g. "payment overdue" in a newsletter wrapper).
 */
const HIGH_STAKES_RE = new RegExp(
  [
    '\\boverdue\\b',
    '\\bpast due\\b',
    '\\bmust pay\\b',
    '\\bpay(ment)?\\s+(by|before|within)\\b',
    '\\binvoice\\b.*\\b(due|payable|outstanding)\\b',
    '\\blegal\\b',
    '\\blawsuit\\b',
    '\\bcourt\\b',
    '\\bsubpoena\\b',
    '\\bwire transfer\\b',
    '\\bfraud\\b',
    '\\bphishing\\b',
    '\\bdata breach\\b',
    '\\bunauthorized\\s+(access|transaction)\\b',
    '\\bsecurity alert\\b',
    '\\baccount\\s+(locked|suspended|compromised)\\b',
    '\\bpayment\\s+failed\\b',
    '\\bfinal notice\\b.*\\b(utility|tax|irs|finanzamt)\\b',
    // DE
    '\\bmahnung\\b',
    '\\binkasso\\b',
    '\\bgericht\\b',
    '\\banwalt\\b',
    '\\bzahlungserinnerung\\b',
    '\\bvertragsstrafe\\b',
    '\\bfrist\\b',
  ].join('|'),
  'i'
)

/** Marketing / bulk / unsolicited — aligned with WRExpert pending_delete examples. */
const PROMOTIONAL_RE = new RegExp(
  [
    '\\bnewsletter\\b',
    '\\bmarketing\\b',
    '\\bemail marketing\\b',
    '\\bpromotional\\b',
    '\\bpromotion\\b',
    '\\bunsolicited\\s+commercial\\b',
    '\\bunsolicited\\b.*\\b(commercial|email)\\b',
    '\\bspecial offer\\b',
    '\\badvertisement\\b',
    '\\badvertising\\b',
    '\\bpercent\\s+off\\b',
    '\\b%\\s*off\\b',
    '\\bdiscount code\\b',
    '\\blimited time offer\\b',
    '\\breach\\s+\\d+\\s*(million|mio|m)\\b',
    '\\bunsubscribe\\b',
    '\\bmit uns erreichen\\b',
    '\\bwerbung\\b',
    '\\bangebot\\b',
    '\\baktion\\b',
    '\\bgesponsert\\b',
    'without\\s+clear\\s+action\\s+required',
    'no\\s+clear\\s+action\\s+required',
    '\\binformational only\\b',
    '\\bautomated notification\\b',
  ].join('|'),
  'i'
)

export function detectPromotionalAndHighStakes(text: string): { promotional: boolean; highStakes: boolean } {
  const t = text.toLowerCase()
  return {
    promotional: PROMOTIONAL_RE.test(t),
    highStakes: HIGH_STAKES_RE.test(t),
  }
}

const ESCALATED_CATEGORIES = new Set(['urgent', 'action_required'])

/**
 * Enforce coherence: promotional / unsolicited commercial without high-stakes cues
 * must not be urgent, must not claim critical urgency, and should not need a reply.
 *
 * Escalated categories are remapped to pending_delete per WRExpert (marketing → pending_delete).
 */
export function reconcileInboxClassification(
  input: ReconcileClassifyInput,
  context: ReconcileContext
): ReconcileClassifyInput {
  const combined = combinedClassificationText({ ...input, ...context })
  const { promotional, highStakes } = detectPromotionalAndHighStakes(combined)

  if (!promotional || highStakes) {
    return { ...input }
  }

  let category = input.category
  const urgency = Math.min(Math.max(1, input.urgency), 3)
  const needsReply = false

  if (ESCALATED_CATEGORIES.has(category)) {
    category = 'pending_delete'
  }

  return {
    category,
    urgency,
    needsReply,
    reason: input.reason,
    summary: input.summary,
  }
}

/** Same promotional cap for normal-inbox triage JSON (no category field from model). */
export function reconcileAnalyzeTriage(
  fields: { urgencyScore: number; needsReply: boolean; urgencyReason: string; summary: string },
  context: ReconcileContext
): { urgencyScore: number; needsReply: boolean; urgencyReason: string; summary: string } {
  const r = reconcileInboxClassification(
    {
      category: 'normal',
      urgency: fields.urgencyScore,
      needsReply: fields.needsReply,
      reason: fields.urgencyReason,
      summary: fields.summary,
    },
    context
  )
  return {
    urgencyScore: r.urgency,
    needsReply: r.needsReply,
    urgencyReason: fields.urgencyReason,
    summary: fields.summary,
  }
}
