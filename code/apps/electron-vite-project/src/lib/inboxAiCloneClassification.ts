/**
 * AI-layer classification for inbox rows stored as `direct_beap` (P2P) that are semantically
 * plain-mail clones (Host → sandbox). Shared by main-process IPC and renderer kind derivation.
 */

export type InboxMessageAiClassificationRow = {
  source_type?: string | null
  handshake_id?: string | null
  depackaged_json?: string | null
  beap_package_json?: string | null
  body_text?: string | null
  body_html?: string | null /** optional; same signals as renderer clone detection may appear here */
  /** Present only on augmented row objects; not a DB column today. */
  original_source_type?: string | null
  original_response_path?: string | null
  reply_transport?: string | null
  sandbox_clone?: boolean | null
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
    const p = prov as Record<string, unknown>
    const ost = p.original_source_type
    if (ost === 'email_plain') acc.plain = true
    else if (ost === 'direct_beap' || ost === 'email_beap') acc.beap = true
    if (p.original_response_path === 'email' || p.reply_transport === 'email') acc.plain = true
  }
  const bsc = o.beap_sandbox_clone
  if (bsc && typeof bsc === 'object' && bsc !== null && !Array.isArray(bsc)) {
    const b = bsc as Record<string, unknown>
    const oit = b.original_inbox_source_type
    if (oit === 'email_plain') acc.plain = true
    else if (oit === 'direct_beap' || oit === 'email_beap') acc.beap = true
    if (b.original_response_path === 'email' || b.reply_transport === 'email') acc.plain = true
  }
  if (o.original_response_path === 'email' || o.reply_transport === 'email') acc.plain = true
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
  if (row.sandbox_clone === true) return true
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
  if (row.original_response_path === 'email' || row.reply_transport === 'email') acc.plain = true

  return acc.plain && !acc.beap
}

export type InboxReplyModeMetadata = {
  sandboxClone: boolean
  originalSourceType: string | null
  originalResponsePath: string | null
  replyTransport: string | null
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function collectReplyModeMetadataFromObject(o: Record<string, unknown>, meta: InboxReplyModeMetadata): void {
  if (o.sandbox_clone === true || o.automation_sandbox_clone === true) meta.sandboxClone = true
  meta.originalSourceType = firstString(meta.originalSourceType, o.original_source_type)
  meta.originalResponsePath = firstString(meta.originalResponsePath, o.original_response_path)
  meta.replyTransport = firstString(meta.replyTransport, o.reply_transport)

  const prov = o.inbox_sandbox_clone_provenance
  if (prov && typeof prov === 'object' && !Array.isArray(prov)) {
    const p = prov as Record<string, unknown>
    meta.sandboxClone = true
    meta.originalSourceType = firstString(meta.originalSourceType, p.original_source_type)
    meta.originalResponsePath = firstString(meta.originalResponsePath, p.original_response_path)
    meta.replyTransport = firstString(meta.replyTransport, p.reply_transport)
  }

  const bsc = o.beap_sandbox_clone
  if (bsc === true) meta.sandboxClone = true
  if (bsc && typeof bsc === 'object' && !Array.isArray(bsc)) {
    const b = bsc as Record<string, unknown>
    meta.sandboxClone = true
    meta.originalSourceType = firstString(meta.originalSourceType, b.original_inbox_source_type, b.original_source_type)
    meta.originalResponsePath = firstString(meta.originalResponsePath, b.original_response_path)
    meta.replyTransport = firstString(meta.replyTransport, b.reply_transport)
  }
}

function walkReplyModeMetadata(v: unknown, depth: number, meta: InboxReplyModeMetadata): void {
  if (depth > 14 || v == null) return
  if (typeof v === 'string') {
    if (
      v.includes('inbox_sandbox_clone_provenance') ||
      v.includes('beap_sandbox_clone') ||
      v.includes('original_response_path') ||
      v.includes('reply_transport')
    ) {
      const inner = safeParseJsonObject(v)
      if (inner) walkReplyModeMetadata(inner, depth + 1, meta)
    }
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) walkReplyModeMetadata(x, depth + 1, meta)
    return
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    collectReplyModeMetadataFromObject(o, meta)
    for (const k of Object.keys(o)) walkReplyModeMetadata(o[k], depth + 1, meta)
  }
}

export function getInboxReplyModeMetadata(row: InboxMessageAiClassificationRow): InboxReplyModeMetadata {
  const meta: InboxReplyModeMetadata = {
    sandboxClone: row.sandbox_clone === true || sandboxCloneSignalsPresent(row),
    originalSourceType: firstString(row.original_source_type),
    originalResponsePath: firstString(row.original_response_path),
    replyTransport: firstString(row.reply_transport),
  }

  const dep = safeParseJsonObject(row.depackaged_json)
  if (dep) walkReplyModeMetadata(dep, 0, meta)

  const pkg = safeParseJsonObject(row.beap_package_json)
  if (pkg) walkReplyModeMetadata(pkg, 0, meta)

  forEachTrailingProvenanceJson(row.body_text, (o) => walkReplyModeMetadata(o, 0, meta))

  return meta
}

function rowIsActualNativeBeap(row: InboxMessageAiClassificationRow): boolean {
  const st = String(row.source_type ?? '')
  const hid = row.handshake_id != null ? String(row.handshake_id).trim() : ''
  return st === 'direct_beap' || (!!hid && st !== 'email_plain')
}

/** Shared renderer / AI / send semantics for inbox replies. */
export type InboxReplyMode = 'email' | 'native_beap'

export function resolveInboxReplyMode(row: InboxMessageAiClassificationRow): InboxReplyMode {
  const st = String(row.source_type ?? '')
  if (st === 'email_plain') {
    return 'email'
  }
  const meta = getInboxReplyModeMetadata(row)
  if (meta.originalSourceType === 'email_plain') {
    return 'email'
  }
  if (meta.originalResponsePath === 'email') {
    return 'email'
  }
  if (meta.replyTransport === 'email') {
    return 'email'
  }
  if (inboxRowIsClonedPlainEmail(row)) {
    return 'email'
  }
  return rowIsActualNativeBeap(row) ? 'native_beap' : 'email'
}

/** Native BEAP capsule semantics for AI (analyze + draft), after clone-of-plain override. */
export function classifyInboxRowForAi(row: InboxMessageAiClassificationRow): { isNativeBeap: boolean } {
  return { isNativeBeap: resolveInboxReplyMode(row) === 'native_beap' }
}

/** Outbound reply/send transport: SMTP/email vs native BEAP / capsule / clipboard compose. */
export type InboxReplyTransport = InboxReplyMode

export type InboxReplyTransportRouterReason =
  | 'source_type_email_plain'
  | 'original_source_type_email_plain'
  | 'original_response_path_email'
  | 'reply_transport_email'
  | 'sandbox_clone_plain_email_provenance'
  | 'not_native_beap'
  | 'default_native_beap'

export type InboxReplyTransportResolutionMeta = {
  transport: InboxReplyTransport
  routerReason: InboxReplyTransportRouterReason
}

/**
 * Outbound reply/send transport: never gate on `source_type === 'direct_beap'` alone.
 * Returns `email` when the row is stored as plain mail OR is a sandbox/P2P clone whose provenance
 * says the original Host row was `email_plain` (see {@link inboxRowIsClonedPlainEmail}).
 */
export function resolveInboxReplyTransportMeta(row: InboxMessageAiClassificationRow): InboxReplyTransportResolutionMeta {
  const st = String(row.source_type ?? '')
  if (st === 'email_plain') {
    return { transport: 'email', routerReason: 'source_type_email_plain' }
  }
  const meta = getInboxReplyModeMetadata(row)
  if (meta.originalSourceType === 'email_plain') {
    return { transport: 'email', routerReason: 'original_source_type_email_plain' }
  }
  if (meta.originalResponsePath === 'email') {
    return { transport: 'email', routerReason: 'original_response_path_email' }
  }
  if (meta.replyTransport === 'email') {
    return { transport: 'email', routerReason: 'reply_transport_email' }
  }
  if (inboxRowIsClonedPlainEmail(row)) {
    return { transport: 'email', routerReason: 'sandbox_clone_plain_email_provenance' }
  }
  if (rowIsActualNativeBeap(row)) {
    return { transport: 'native_beap', routerReason: 'default_native_beap' }
  }
  return { transport: 'email', routerReason: 'not_native_beap' }
}

export function resolveInboxReplyTransport(row: InboxMessageAiClassificationRow): InboxReplyTransport {
  return resolveInboxReplyMode(row)
}

/** Temporary debug: which UX/IPC path was selected after transport resolution. */
export type InboxReplySelectedPath = 'email_send' | 'native_beap_compose' | 'blocked_missing_email_metadata'
export type InboxReplyDecisionPhase = 'render' | 'reply' | 'send_draft'

export function logInboxReplyTransportDecision(
  row: InboxMessageAiClassificationRow,
  opts: {
    messageId: string
    phase: InboxReplyDecisionPhase
    selectedPath: InboxReplySelectedPath
    selectedUiSchema?: InboxReplyMode
  },
): void {
  const st = String(row.source_type ?? '')
  const clonedPlain = inboxRowIsClonedPlainEmail(row)
  const meta = getInboxReplyModeMetadata(row)
  const transport = resolveInboxReplyMode(row)
  const payload = {
    messageId: opts.messageId,
    source_type: st,
    sandboxClone: meta.sandboxClone,
    original_source_type: meta.originalSourceType,
    original_response_path: meta.originalResponsePath,
    reply_transport: meta.replyTransport,
    inboxRowIsClonedPlainEmail: clonedPlain,
    resolvedResponsePath: transport,
    selectedUiSchema: opts.selectedUiSchema ?? transport,
    selectedSendPath: opts.selectedPath,
    selectedPath: opts.selectedPath,
    phase: opts.phase,
  }
  // eslint-disable-next-line no-console
  console.info(`[INBOX_REPLY_TRANSPORT] ${JSON.stringify(payload)}`)
}

/** User-visible / toast copy when `resolveInboxReplyTransport` is `email` but SMTP metadata is missing. */
export const INBOX_EMAIL_REPLY_METADATA_MISSING =
  'Cannot send email reply because email metadata is missing'
