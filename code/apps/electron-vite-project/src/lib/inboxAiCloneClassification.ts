/**
 * AI-layer classification for inbox rows stored as `direct_beap` (P2P) that are semantically
 * plain-mail clones (Host → sandbox). Shared by main-process IPC and renderer kind derivation.
 */

export type InboxMessageAiClassificationRow = {
  source_type: string
  handshake_id?: string | null
  depackaged_json?: string | null
  beap_package_json?: string | null
  body_text?: string | null
  body_html?: string | null /** optional; same signals as renderer clone detection may appear here */
  /** Present only on augmented row objects; not a DB column today. */
  original_source_type?: string | null
}

function safeParseJsonObject(s: string | null | undefined): Record<string, unknown> | null {
  if (!s?.trim()) return null
  try {
    const v = JSON.parse(s) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* fail closed */
  }
  return null
}

function considerProvKeys(o: Record<string, unknown>, acc: { plain: boolean; beap: boolean }): void {
  const prov = o.inbox_sandbox_clone_provenance
  if (prov && typeof prov === 'object' && prov !== null && !Array.isArray(prov)) {
    const ost = (prov as Record<string, unknown>).original_source_type
    if (ost === 'email_plain') acc.plain = true
    else if (ost === 'direct_beap' || ost === 'email_beap') acc.beap = true
  }
  const bsc = o.beap_sandbox_clone
  if (bsc && typeof bsc === 'object' && bsc !== null && !Array.isArray(bsc)) {
    const oit = (bsc as Record<string, unknown>).original_inbox_source_type
    if (oit === 'email_plain') acc.plain = true
    else if (oit === 'direct_beap' || oit === 'email_beap') acc.beap = true
  }
}

function walkClonePlainSignals(v: unknown, depth: number, acc: { plain: boolean; beap: boolean }): void {
  if (depth > 14) return
  if (v == null) return
  if (typeof v === 'string') {
    if (v.includes('inbox_sandbox_clone_provenance') || v.includes('beap_sandbox_clone')) {
      const inner = safeParseJsonObject(v)
      if (inner) walkClonePlainSignals(inner, depth + 1, acc)
    }
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) walkClonePlainSignals(x, depth + 1, acc)
    return
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    considerProvKeys(o, acc)
    for (const k of Object.keys(o)) {
      walkClonePlainSignals(o[k], depth + 1, acc)
    }
  }
}

function forEachTrailingProvenanceJson(text: string | null | undefined, visit: (o: Record<string, unknown>) => void): void {
  if (!text) return
  const sep = '\n\n---\n'
  let start = 0
  while (start <= text.length) {
    const i = text.indexOf(sep, start)
    if (i < 0) break
    const after = text.slice(i + sep.length).trim()
    const o = safeParseJsonObject(after)
    if (o) visit(o)
    start = i + sep.length
  }
}

function sandboxCloneSignalsPresent(row: InboxMessageAiClassificationRow): boolean {
  const bundle = `${row.body_text ?? ''}\n${row.body_html ?? ''}\n${row.depackaged_json ?? ''}\n${row.beap_package_json ?? ''}`
  if (bundle.includes('inbox_sandbox_clone_provenance')) return true
  if (bundle.includes('[BEAP sandbox clone — sent by you]')) return true
  if (bundle.includes('"beap_sandbox_clone"') && (bundle.includes('original_message_id') || bundle.includes('clone_reason'))) {
    return true
  }
  return /sandbox_clone"?\s*:\s*true/.test(bundle) && /automation_sandbox_clone"?\s*:\s*true/.test(bundle)
}

/**
 * True when provenance shows the **original** Host inbox row was plain email (`email_plain`).
 * Requires clone provenance (embedded JSON / depackaged walk); fail-closed to false on ambiguity.
 * If both plain and BEAP-shaped originals are seen, returns false (do not force plain).
 */
export function inboxRowIsClonedPlainEmail(row: InboxMessageAiClassificationRow): boolean {
  const acc = { plain: false, beap: false }

  const dep = safeParseJsonObject(row.depackaged_json)
  if (dep) walkClonePlainSignals(dep, 0, acc)

  const pkg = safeParseJsonObject(row.beap_package_json)
  if (pkg) walkClonePlainSignals(pkg, 0, acc)

  forEachTrailingProvenanceJson(row.body_text, (o) => walkClonePlainSignals(o, 0, acc))

  const top = row.original_source_type != null ? String(row.original_source_type) : ''
  if (top === 'email_plain' && sandboxCloneSignalsPresent(row)) acc.plain = true
  else if (top === 'direct_beap' || top === 'email_beap') acc.beap = true

  return acc.plain && !acc.beap
}

/** Native BEAP capsule semantics for AI (analyze + draft), after clone-of-plain override. */
export function classifyInboxRowForAi(row: InboxMessageAiClassificationRow): { isNativeBeap: boolean } {
  const st = String(row.source_type ?? '')
  const hid = row.handshake_id != null ? String(row.handshake_id).trim() : ''
  const rawIsNativeBeap = st === 'direct_beap' || (!!hid && st !== 'email_plain')
  if (rawIsNativeBeap && inboxRowIsClonedPlainEmail(row)) {
    return { isNativeBeap: false }
  }
  return { isNativeBeap: rawIsNativeBeap }
}

/** Outbound reply/send transport: SMTP/email vs native BEAP / capsule / clipboard compose. */
export type InboxReplyTransport = 'email' | 'native_beap'

export type InboxReplyTransportRouterReason =
  | 'source_email_plain_or_depackaged_storage'
  | 'sandbox_p2p_clone_of_plain_email'
  | 'default_native_beap'

export type InboxReplyTransportResolutionMeta = {
  transport: InboxReplyTransport
  routerReason: InboxReplyTransportRouterReason
}

/**
 * Same semantic gate as AI/kind classification: plain-email origin always uses email transport,
 * including sandbox P2P rows stored as `direct_beap` with clone provenance of `email_plain`.
 *
 * `depackaged` is treated like `email_plain` for transport (legacy storage label).
 */
export function resolveInboxReplyTransportMeta(row: InboxMessageAiClassificationRow): InboxReplyTransportResolutionMeta {
  const st = String(row.source_type ?? '')
  if (st === 'email_plain' || st === 'depackaged') {
    return { transport: 'email', routerReason: 'source_email_plain_or_depackaged_storage' }
  }
  if (inboxRowIsClonedPlainEmail(row)) {
    return { transport: 'email', routerReason: 'sandbox_p2p_clone_of_plain_email' }
  }
  return { transport: 'native_beap', routerReason: 'default_native_beap' }
}

export function resolveInboxReplyTransport(row: InboxMessageAiClassificationRow): InboxReplyTransport {
  return resolveInboxReplyTransportMeta(row).transport
}

export type LogInboxReplyTransportInput = {
  messageId: string
  phase: 'reply' | 'send_draft'
  /** Set when known (e.g. after listing accounts). Omit / null when not applicable or unknown. */
  accountId?: string | null
  /** True only if code incorrectly fell back to BEAP after choosing email (should stay false). */
  fallbackUsed?: boolean
  derivedMessageKind?: 'handshake' | 'depackaged' | null
  hasFromAddress: boolean
}

/**
 * Structured observability for reply/send routing. Avoids logging full addresses, bodies, or payloads.
 */
export function logInboxReplyTransportResolution(
  row: InboxMessageAiClassificationRow,
  input: LogInboxReplyTransportInput,
): void {
  const { transport, routerReason } = resolveInboxReplyTransportMeta(row)
  const clonedPlain = inboxRowIsClonedPlainEmail(row)
  const st = String(row.source_type ?? '')
  const payload = {
    scope: 'inbox_reply_transport',
    messageId: input.messageId,
    phase: input.phase,
    source_type: st,
    resolvedReplyTransport: transport,
    routerReason,
    inboxRowIsClonedPlainEmail: clonedPlain,
    derivedMessageKind: input.derivedMessageKind ?? null,
    hasFromAddress: input.hasFromAddress,
    hasRecipient: input.hasFromAddress,
    accountId: input.accountId ?? null,
    fallbackUsed: input.fallbackUsed ?? false,
  }
  // eslint-disable-next-line no-console
  console.info(`[INBOX_REPLY_TRANSPORT] ${JSON.stringify(payload)}`)
}
