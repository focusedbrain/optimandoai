/**
 * WRC Registry API Contract v1.0 — wire object shapes and fail-closed decoders.
 *
 * Contract reference: `docs/spec/WRC-Registry-API-Contract_v1.0.md` @20794bff.
 * This module is an INTERFACE REFERENCE implementation for the Phase-3 client
 * only. It contains no service code and never constructs objects a publisher
 * or the WRC would sign — it only reads them, and refuses whatever it cannot
 * fully understand.
 *
 * Decoding discipline: every decoder returns `null` rather than a partially
 * populated object. A field the client would later branch on must be present
 * and well-typed at decode time, so no downstream code has to ask "was that
 * actually in the response, or is it my default?".
 */

// ── Primitives ────────────────────────────────────────────────────────────────

/** `sha256:<base64url>` per contract §2. */
export type WrcHash = string

export const WRC_HASH_RE = /^sha256:[A-Za-z0-9_-]{43}$/

export function isWrcHash(v: unknown): v is WrcHash {
  return typeof v === 'string' && WRC_HASH_RE.test(v)
}

/** Base64url, unpadded — signatures and raw keys. */
export const WRC_B64URL_RE = /^[A-Za-z0-9_-]+$/

function isB64Url(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && WRC_B64URL_RE.test(v)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isSafeNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

// ── §3.1 CatalogHead ──────────────────────────────────────────────────────────

export interface WrcCatalogHead {
  type: 'wrc/catalog-head'
  publisher_part: string
  domain: string
  catalog_root: WrcHash
  epoch: number
  issued_at: number
  freshness_window_s: number
  kid: string
  /**
   * Delta v1.1 §A. REQUIRED non-null whenever `kid` is not the publisher's
   * root key; null for a root-signed head. Carried in the head so that
   * verification completes from the DNS-pinned root plus this record alone —
   * no fetch may occur in the verification path, which also makes the chain
   * immune to selective blocking of a side-fetch.
   *
   * Decoded as `null` when absent so v1.0 heads still parse; the requirement
   * is enforced in `verifyCatalogHead`, which is the only place that knows
   * which key is the root.
   */
  delegation: WrcDelegationRecord | null
  sig: string
}

export function decodeCatalogHead(value: unknown): WrcCatalogHead | null {
  const o = asRecord(value)
  if (!o) return null
  if (o.type !== 'wrc/catalog-head') return null
  if (!isNonEmptyString(o.publisher_part) || !isNonEmptyString(o.domain)) return null
  if (!isWrcHash(o.catalog_root)) return null
  if (!isSafeNonNegativeInt(o.epoch) || !isSafeNonNegativeInt(o.issued_at)) return null
  if (!isSafeNonNegativeInt(o.freshness_window_s)) return null
  if (!isNonEmptyString(o.kid) || !isB64Url(o.sig)) return null

  // A present-but-malformed delegation is a decode failure, not a silent null:
  // downgrading it would turn a broken chain into "root-signed head" and hand
  // the verifier the wrong question.
  let delegation: WrcDelegationRecord | null = null
  if (o.delegation !== null && o.delegation !== undefined) {
    delegation = decodeDelegationRecord(o.delegation)
    if (!delegation) return null
  }

  return {
    type: 'wrc/catalog-head',
    publisher_part: o.publisher_part,
    domain: o.domain.toLowerCase(),
    catalog_root: o.catalog_root,
    epoch: o.epoch,
    issued_at: o.issued_at,
    freshness_window_s: o.freshness_window_s,
    kid: o.kid,
    delegation,
    sig: o.sig,
  }
}

// ── §3.2 Entry ────────────────────────────────────────────────────────────────

/** Publisher-signed entry status. `draft` never appears on the wire (§3.2). */
export type WrcEntryStatus = 'published' | 'suspended' | 'retired'

export interface WrcEntryCode {
  canonical: string
  channels: string[]
}

export interface WrcEntry {
  type: 'wrc/entry'
  entry_id: string
  publisher_part: string
  display: { name: string; icon: WrcHash | null; value_statement: string }
  codes: WrcEntryCode[]
  scopes: WrcHash[]
  evp_ref: WrcHash
  template_ref: WrcHash | null
  status: WrcEntryStatus
  epoch: number
  kid: string
  sig: string
}

export function decodeEntry(value: unknown): WrcEntry | null {
  const o = asRecord(value)
  if (!o) return null
  if (o.type !== 'wrc/entry') return null
  if (!isNonEmptyString(o.entry_id) || !isNonEmptyString(o.publisher_part)) return null

  const d = asRecord(o.display)
  if (!d || !isNonEmptyString(d.name) || typeof d.value_statement !== 'string') return null
  const icon = d.icon === null || d.icon === undefined ? null : isWrcHash(d.icon) ? d.icon : undefined
  if (icon === undefined) return null

  if (!Array.isArray(o.codes)) return null
  const codes: WrcEntryCode[] = []
  for (const c of o.codes) {
    const cr = asRecord(c)
    if (!cr || !isNonEmptyString(cr.canonical) || !Array.isArray(cr.channels)) return null
    if (!cr.channels.every((ch) => typeof ch === 'string')) return null
    codes.push({ canonical: cr.canonical, channels: cr.channels as string[] })
  }

  if (!Array.isArray(o.scopes) || !o.scopes.every(isWrcHash)) return null
  if (!isWrcHash(o.evp_ref)) return null
  const templateRef =
    o.template_ref === null || o.template_ref === undefined
      ? null
      : isWrcHash(o.template_ref)
        ? o.template_ref
        : undefined
  if (templateRef === undefined) return null

  if (o.status !== 'published' && o.status !== 'suspended' && o.status !== 'retired') return null
  if (!isSafeNonNegativeInt(o.epoch)) return null
  if (!isNonEmptyString(o.kid) || !isB64Url(o.sig)) return null

  return {
    type: 'wrc/entry',
    entry_id: o.entry_id,
    publisher_part: o.publisher_part,
    display: { name: d.name, icon, value_statement: d.value_statement },
    codes,
    scopes: o.scopes as WrcHash[],
    evp_ref: o.evp_ref,
    template_ref: templateRef,
    status: o.status,
    epoch: o.epoch,
    kid: o.kid,
    sig: o.sig,
  }
}

// ── §3.3 EntryValuePackage ────────────────────────────────────────────────────

export interface WrcScopeDirectoryItem {
  scope: WrcHash
  name: string
  desc: string
  size_hint_b: number
  prefetch: 'none' | 'recommended'
}

export interface WrcEvp {
  type: 'wrc/evp'
  publisher_part: string
  entry_id: string
  self_description: string
  value_statement: string
  scope_directory: WrcScopeDirectoryItem[]
  preparation_view: WrcHash | null
  next_steps: string[]
  audit_links: boolean
  epoch: number
  kid: string
  sig: string
}

/** §3.3 platform-wide budget: canonical bytes ≤ 64 KiB. Never truncate. */
export const WRC_EVP_MAX_CANONICAL_BYTES = 65_536

export function decodeEvp(value: unknown): WrcEvp | null {
  const o = asRecord(value)
  if (!o) return null
  if (o.type !== 'wrc/evp') return null
  if (!isNonEmptyString(o.publisher_part) || !isNonEmptyString(o.entry_id)) return null
  if (typeof o.self_description !== 'string' || typeof o.value_statement !== 'string') return null

  if (!Array.isArray(o.scope_directory)) return null
  const dir: WrcScopeDirectoryItem[] = []
  for (const s of o.scope_directory) {
    const sr = asRecord(s)
    if (!sr || !isWrcHash(sr.scope)) return null
    if (typeof sr.name !== 'string' || typeof sr.desc !== 'string') return null
    if (!isSafeNonNegativeInt(sr.size_hint_b)) return null
    if (sr.prefetch !== 'none' && sr.prefetch !== 'recommended') return null
    dir.push({
      scope: sr.scope,
      name: sr.name,
      desc: sr.desc,
      size_hint_b: sr.size_hint_b,
      prefetch: sr.prefetch,
    })
  }

  const prep =
    o.preparation_view === null || o.preparation_view === undefined
      ? null
      : isWrcHash(o.preparation_view)
        ? o.preparation_view
        : undefined
  if (prep === undefined) return null

  if (!Array.isArray(o.next_steps) || !o.next_steps.every((s) => typeof s === 'string')) return null
  if (typeof o.audit_links !== 'boolean') return null
  if (!isSafeNonNegativeInt(o.epoch)) return null
  if (!isNonEmptyString(o.kid) || !isB64Url(o.sig)) return null

  return {
    type: 'wrc/evp',
    publisher_part: o.publisher_part,
    entry_id: o.entry_id,
    self_description: o.self_description,
    value_statement: o.value_statement,
    scope_directory: dir,
    preparation_view: prep,
    next_steps: o.next_steps as string[],
    audit_links: o.audit_links,
    epoch: o.epoch,
    kid: o.kid,
    sig: o.sig,
  }
}

// ── §3.4 DualAssuranceEnvelope ────────────────────────────────────────────────

export interface WrcInclusionStep {
  pos: 'left' | 'right'
  hash: WrcHash
}

export interface WrcSuspension {
  since: number
  reason_code: string
  reversible: boolean
}

export interface WrcEnvelope {
  object: Record<string, unknown>
  hash: WrcHash
  publisher_sig_valid_kid: string
  ingest_countersig: { kid: string; at: number; sig: string }
  epoch: number
  inclusion_proof: WrcInclusionStep[]
  suspension: WrcSuspension | null
}

export function decodeEnvelope(value: unknown): WrcEnvelope | null {
  const o = asRecord(value)
  if (!o) return null
  const obj = asRecord(o.object)
  if (!obj) return null
  if (!isWrcHash(o.hash)) return null
  if (!isNonEmptyString(o.publisher_sig_valid_kid)) return null

  const cs = asRecord(o.ingest_countersig)
  if (!cs || !isNonEmptyString(cs.kid) || !isSafeNonNegativeInt(cs.at) || !isB64Url(cs.sig)) return null
  if (!isSafeNonNegativeInt(o.epoch)) return null

  if (!Array.isArray(o.inclusion_proof)) return null
  const proof: WrcInclusionStep[] = []
  for (const step of o.inclusion_proof) {
    const sr = asRecord(step)
    if (!sr) return null
    if (sr.pos !== 'left' && sr.pos !== 'right') return null
    if (!isWrcHash(sr.hash)) return null
    proof.push({ pos: sr.pos, hash: sr.hash })
  }

  let suspension: WrcSuspension | null = null
  if (o.suspension !== null && o.suspension !== undefined) {
    const s = asRecord(o.suspension)
    if (!s || !isSafeNonNegativeInt(s.since) || !isNonEmptyString(s.reason_code)) return null
    if (typeof s.reversible !== 'boolean') return null
    suspension = { since: s.since, reason_code: s.reason_code, reversible: s.reversible }
  }

  return {
    object: obj,
    hash: o.hash,
    publisher_sig_valid_kid: o.publisher_sig_valid_kid,
    ingest_countersig: { kid: cs.kid, at: cs.at, sig: cs.sig },
    epoch: o.epoch,
    inclusion_proof: proof,
    suspension,
  }
}

// ── §3.6 DelegationRecord ─────────────────────────────────────────────────────

export interface WrcDelegationRecord {
  type: 'wrc/catalog-delegation'
  publisher_part: string
  delegate_kid: string
  delegate_pub: string
  authority: 'catalog-signing-only'
  valid_from_epoch: number
  revoked_from_epoch: number | null
  root_kid: string
  sig: string
}

export function decodeDelegationRecord(value: unknown): WrcDelegationRecord | null {
  const o = asRecord(value)
  if (!o) return null
  if (o.type !== 'wrc/catalog-delegation') return null
  if (!isNonEmptyString(o.publisher_part)) return null
  if (!isNonEmptyString(o.delegate_kid) || !isB64Url(o.delegate_pub)) return null
  if (o.authority !== 'catalog-signing-only') return null
  if (!isSafeNonNegativeInt(o.valid_from_epoch)) return null
  const revoked =
    o.revoked_from_epoch === null || o.revoked_from_epoch === undefined
      ? null
      : isSafeNonNegativeInt(o.revoked_from_epoch)
        ? o.revoked_from_epoch
        : undefined
  if (revoked === undefined) return null
  if (!isNonEmptyString(o.root_kid) || !isB64Url(o.sig)) return null
  return {
    type: 'wrc/catalog-delegation',
    publisher_part: o.publisher_part,
    delegate_kid: o.delegate_kid,
    delegate_pub: o.delegate_pub,
    authority: 'catalog-signing-only',
    valid_from_epoch: o.valid_from_epoch,
    revoked_from_epoch: revoked,
    root_kid: o.root_kid,
    sig: o.sig,
  }
}

// ── §4.2 resolve response (the CLAIM) ─────────────────────────────────────────

/** D4 publisher-part status enum, authoritative at the registry (§4.2). */
export type WrcPublisherStatus =
  | 'active'
  | 'inactive'
  | 'revoked'
  | 'superseded'
  | 'compromised'

export interface WrcResolveClaim {
  domain: string
  status: WrcPublisherStatus
  generation: number
  catalog_head: WrcCatalogHead
  root_fingerprint: string
}

const PUBLISHER_STATUSES: readonly string[] = [
  'active',
  'inactive',
  'revoked',
  'superseded',
  'compromised',
]

export function decodeResolveClaim(value: unknown): WrcResolveClaim | null {
  const o = asRecord(value)
  if (!o) return null
  if (!isNonEmptyString(o.domain)) return null
  if (typeof o.status !== 'string' || !PUBLISHER_STATUSES.includes(o.status)) return null
  if (!isSafeNonNegativeInt(o.generation)) return null
  const head = decodeCatalogHead(o.catalog_head)
  if (!head) return null
  if (!isNonEmptyString(o.root_fingerprint)) return null
  return {
    domain: o.domain.toLowerCase(),
    status: o.status as WrcPublisherStatus,
    generation: o.generation,
    catalog_head: head,
    root_fingerprint: o.root_fingerprint,
  }
}

// ── Publisher manifest (`/.well-known/wr/manifest`) ───────────────────────────

/**
 * The publisher-served side of the dual channel. Its `publisher_part` is a
 * CROSS-CHECK against the resolved part (§1.1) — never a resolution source.
 */
export interface WrcPublisherManifest {
  type: 'wr/manifest'
  domain: string
  publisher_part: string
  root_kid: string
  root_pub: string
  sig: string
}

export function decodePublisherManifest(value: unknown): WrcPublisherManifest | null {
  const o = asRecord(value)
  if (!o) return null
  if (o.type !== 'wr/manifest') return null
  if (!isNonEmptyString(o.domain) || !isNonEmptyString(o.publisher_part)) return null
  if (!isNonEmptyString(o.root_kid) || !isB64Url(o.root_pub) || !isB64Url(o.sig)) return null
  return {
    type: 'wr/manifest',
    domain: o.domain.toLowerCase(),
    publisher_part: o.publisher_part,
    root_kid: o.root_kid,
    root_pub: o.root_pub,
    sig: o.sig,
  }
}
