/**
 * What an accept dialog (desktop app and extension) shows for a staged Connect
 * offer.
 *
 * Built only from the preview object main hashed (`buildConnectOfferPreview`);
 * the accept returns that object's `preview_hash` and consent refuses any other
 * preview (HC5). What the user reads here is therefore what consent pins.
 */

export interface ConnectOfferPreviewPayload {
  preview: Record<string, unknown>
  preview_hash: string
}

export interface ConnectOfferPreviewRow {
  label: string
  value: string
}

const PROFILE_LABELS: Record<string, string> = {
  internal_device: 'Pairing with your own device',
  legacy_v0: 'Handshake',
  private_personal: 'Personal handshake',
  org_internal: 'Within an organization',
  org_cross: 'Between organizations',
  pbeap_publisher: 'Publisher offer',
}

const PREVIEW_HASH_RE = /^[0-9a-f]{64}$/

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** ISO instant → `YYYY-MM-DD HH:MM UTC`; anything else is returned unchanged. */
export function formatPreviewInstant(iso: string): string {
  const t = Date.parse(iso)
  if (!iso || Number.isNaN(t)) return iso
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function externalProcessingLabel(v: string): string {
  if (v === '' || v === 'none') return 'Not allowed'
  if (v === 'local_only') return 'Local processing only'
  return v
}

/** Validated payload from a pending-list record, or null when it carries none. */
export function readConnectOfferPreview(raw: unknown): ConnectOfferPreviewPayload | null {
  const o = obj(raw)
  const hash = str(o.preview_hash)
  if (!PREVIEW_HASH_RE.test(hash)) return null
  const preview = obj(o.preview)
  if (Object.keys(preview).length === 0) return null
  return { preview, preview_hash: hash }
}

export function connectOfferPreviewRows(payload: ConnectOfferPreviewPayload): ConnectOfferPreviewRow[] {
  const p = payload.preview
  const bound = obj(p.bound_definition)
  const entry = obj(p.entry)
  const rows: ConnectOfferPreviewRow[] = []

  rows.push({ label: 'From', value: str(bound.sender_email) || '(no e-mail address)' })
  rows.push({ label: 'To', value: str(bound.receiver_email) || '(no e-mail address)' })
  const profileId = str(bound.profile_id)
  rows.push({ label: 'Kind', value: PROFILE_LABELS[profileId] ?? (profileId ? `Handshake (${profileId})` : 'Handshake') })

  const wrCode = str(entry.wr_code_canonical)
  if (wrCode) {
    rows.push({ label: 'WR Code', value: wrCode })
    rows.push({ label: 'Publisher domain', value: bound.publisher_domain_verified === true ? 'Verified' : 'Not verified' })
    const statement = str(entry.value_statement)
    if (statement) rows.push({ label: 'Offer', value: statement })
  }

  const scopes = Array.isArray(p.scopes) ? p.scopes.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []
  rows.push({ label: 'Context scopes', value: scopes.length > 0 ? scopes.join(', ') : 'None' })
  rows.push({ label: 'Outside processing', value: externalProcessingLabel(str(p.external_processing)) })
  rows.push({ label: 'Two-way sharing', value: p.reciprocal_allowed === true ? 'Allowed' : 'Not allowed' })

  const sessionEnds = str(p.session_bound_expires_at)
  if (sessionEnds) rows.push({ label: 'Session offer ends', value: formatPreviewInstant(sessionEnds) })
  const expires = str(p.expires_at)
  if (expires) rows.push({ label: 'Request expires', value: formatPreviewInstant(expires) })

  return rows
}

/** Human copy for the consent refusals the accept can return for a staged offer. */
export function connectOfferConsentErrorCopy(reason: unknown): string | null {
  if (reason === 'PREVIEW_HASH_MISMATCH') {
    return 'This request changed after you opened it. Close this dialog, open the request again and review it before accepting.'
  }
  if (reason === 'PREVIEW_HASH_REQUIRED') {
    return 'Open the handshake request again and review it before accepting.'
  }
  if (reason === 'OFFER_NOT_CONSENTABLE') {
    return 'This request can no longer be accepted. It may have expired or been answered already.'
  }
  return null
}
