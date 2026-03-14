/**
 * StructuredHsContextPanel — Dedicated business context panel for HS Context
 *
 * Parsed-text-first model: extracted text is the default visible form; original
 * PDFs require protected View Original (warning + approval + audit).
 * Links use protected Open flow (validateHsContextLink; no direct href).
 * Sensitive badge shown when document.sensitive; policy restricts cloud/search.
 */

import React, { useState, useMemo } from 'react'
import { validateHsContextLink, linkEntityId } from '@shared/handshake/linkValidation'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import { HsContextDocumentReader } from './HsContextDocumentReader'

// ── Parsed payload types (backward-compatible with existing block payloads) ──
interface ParsedProfile {
  id?: string
  name?: string
  description?: string
  fields?: Record<string, unknown>
  custom_fields?: Array<{ label?: string; value?: string }>
}

interface ParsedDocument {
  id: string
  filename: string
  label?: string | null
  document_type?: string | null
  extracted_text?: string | null
  sensitive?: boolean
}

interface ParsedPayload {
  profile?: ParsedProfile | null
  documents?: ParsedDocument[]
}

function parseHsContextPayload(payload: string): ParsedPayload | null {
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    return null
  }
}

// ── Helpers: only show sections when data exists ──
function hasStr(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
function hasOpeningHours(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false
  return (v as Array<{ days?: string; from?: string; to?: string }>).some((h) => hasStr(h.days) || hasStr(h.from) || hasStr(h.to))
}
function hasPaymentMethods(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0
}
function hasContacts(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0
}
function hasAddressParts(f: Record<string, unknown>): boolean {
  const parts = [f.street, f.streetNumber, f.postalCode, f.city, f.state, f.country, f.address]
  return parts.some((p) => hasStr(p))
}
function hasCustomFieldsWithContent(arr: Array<{ label?: string; value?: string }>): boolean {
  return Array.isArray(arr) && arr.some((cf) => hasStr(cf.label) || hasStr(cf.value))
}

// ── Section helpers ──
function SectionRow({ label, value }: { label: string; value: string }) {
  if (!value?.trim()) return null
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '13px' }}>
      <span style={{ fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', minWidth: '140px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--color-text, #e2e8f0)', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginTop: '16px', marginBottom: '8px' }}>
      {title}
    </div>
  )
}

// ── Known link fields (shared with HandshakeWorkspace for consistency) ──
export const KNOWN_HS_CONTEXT_LINK_FIELDS = ['website', 'linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'officialLink', 'supportUrl'] as const

// ── Props ──
interface StructuredHsContextPanelProps {
  blocks: Array<{
    block_id: string
    block_hash: string
    payload: string
    source: 'sent' | 'received'
    visibility: 'public' | 'private'
  }>
  handshakeId: string
  vaultUnlocked: boolean
  onVisibilityChange?: (block: { block_id: string; block_hash: string; sender_wrdesk_user_id: string }) => void
  senderWrdeskUserId?: string
}

const PREVIEW_LINES = 3
const PREVIEW_TRUNCATE_LEN = 1500

// ── Single block with memoized parse ──
function StructuredHsContextBlock({
  block,
  handshakeId,
  vaultUnlocked,
  expandedDoc,
  setExpandedDoc,
  showFullForDoc,
  setShowFullForDoc,
  onViewOriginal,
  onOpenLink,
  onOpenReader,
}: {
  block: { block_id: string; block_hash: string; payload: string; source: 'sent' | 'received' }
  handshakeId: string
  vaultUnlocked: boolean
  expandedDoc: string | null
  setExpandedDoc: (id: string | null) => void
  showFullForDoc: string | null
  setShowFullForDoc: (id: string | null) => void
  onViewOriginal: (doc: { id: string; filename: string }) => void
  onOpenLink: (url: string) => void
  onOpenReader: (doc: { id: string; filename: string }) => void
}) {
  const parsed = useMemo(
    () => parseHsContextPayload(block.payload),
    [block.block_id, block.block_hash, block.payload],
  )
  if (!parsed?.profile) return null

  const profile = parsed.profile
  const fields = profile.fields ?? {}
  const documents = parsed.documents ?? []
  const customFields = profile.custom_fields ?? []

  const linkUrls: string[] = []
  for (const k of KNOWN_HS_CONTEXT_LINK_FIELDS) {
    const v = (fields as Record<string, unknown>)[k]
    if (typeof v === 'string' && v.trim()) linkUrls.push(v.trim())
  }
  for (const cf of customFields) {
    const v = cf.value
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) linkUrls.push(v.trim())
  }
  const validLinks = linkUrls
    .filter(Boolean)
    .map((url) => ({ url, validation: validateHsContextLink(url) }))
    .filter(({ validation }) => validation.ok) as Array<{ url: string; validation: { ok: true; url: string } }>

  return (
    <div
      key={`${block.block_id}-${block.block_hash}`}
      style={{
        padding: '16px',
        background: block.source === 'received' ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
        border: block.source === 'received' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        marginBottom: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
          {profile.name || 'Business Context'}
        </h4>
        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: block.source === 'received' ? 'rgba(139,92,246,0.2)' : 'rgba(34,197,94,0.15)', color: block.source === 'received' ? '#a78bfa' : '#22c55e' }}>
          {block.source === 'received' ? 'Received' : 'Sent'}
        </span>
      </div>

      {hasStr(profile.description) && (
        <>
          <SectionHeader title="Company" />
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary, #94a3b8)', lineHeight: 1.5, marginBottom: '8px' }}>
            {String(profile.description)}
          </div>
        </>
      )}

      {/* Business Identity — only show when at least one field has content */}
      {(hasStr(fields.legalCompanyName) || hasStr(fields.tradeName) || hasAddressParts(fields as Record<string, unknown>)) && (
        <>
          <SectionHeader title="Business Identity" />
          {hasStr(fields.legalCompanyName) && <SectionRow label="Legal Company" value={String(fields.legalCompanyName)} />}
          {hasStr(fields.tradeName) && <SectionRow label="Trade Name" value={String(fields.tradeName)} />}
          {(hasStr(fields.street) || hasStr(fields.streetNumber) || hasStr(fields.postalCode) || hasStr(fields.city) || hasStr(fields.state) || hasStr(fields.country))
            ? (
                <SectionRow
                  label="Address"
                  value={[
                    [fields.street, fields.streetNumber].filter(Boolean).join(' '),
                    [fields.postalCode, fields.city].filter(Boolean).join(' '),
                    [fields.state, fields.country].filter(Boolean).join(', '),
                  ].filter(Boolean).join(', ')}
                />
              )
            : hasStr(fields.address) && <SectionRow label="Address" value={String(fields.address)} />}
          {hasStr(fields.country) && <SectionRow label="Country" value={String(fields.country)} />}
        </>
      )}

      {/* Tax & Identifiers — only show when at least one field has content */}
      {(hasStr(fields.vatNumber) || hasStr(fields.companyRegistrationNumber) || hasStr(fields.supplierNumber) || hasStr(fields.customerNumber)) && (
        <>
          <SectionHeader title="Tax & Identifiers" />
          {hasStr(fields.vatNumber) && <SectionRow label="VAT Number" value={String(fields.vatNumber)} />}
          {hasStr(fields.companyRegistrationNumber) && <SectionRow label="Registration" value={String(fields.companyRegistrationNumber)} />}
          {hasStr(fields.supplierNumber) && <SectionRow label="Supplier No." value={String(fields.supplierNumber)} />}
          {hasStr(fields.customerNumber) && <SectionRow label="Customer No." value={String(fields.customerNumber)} />}
        </>
      )}

      {/* General Contact — only show when at least one field has content */}
      {(hasStr(fields.generalPhone) || hasStr(fields.generalEmail) || hasStr(fields.supportEmail)) && (
        <>
          <SectionHeader title="General Contact" />
          {hasStr(fields.generalPhone) && <SectionRow label="Phone" value={String(fields.generalPhone)} />}
          {hasStr(fields.generalEmail) && <SectionRow label="Email" value={String(fields.generalEmail)} />}
          {hasStr(fields.supportEmail) && <SectionRow label="Support Email" value={String(fields.supportEmail)} />}
        </>
      )}

      {/* Contacts (contact persons) */}
      {hasContacts(fields.contacts) && (
        <>
          <SectionHeader title="Contacts" />
          {(fields.contacts as Array<Record<string, unknown>>).map((c, i) => (
            <div key={i} style={{ marginBottom: '8px', fontSize: '13px' }}>
              {[c.name, c.role, c.email, c.phone].filter(Boolean).map((v, j) => (
                <span key={j}>{String(v)}{j < 3 ? ' · ' : ''}</span>
              ))}
              {c.notes && <div style={{ marginTop: '4px', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>{String(c.notes)}</div>}
            </div>
          ))}
        </>
      )}

      {/* Opening Hours / Operations — only show when at least one field has content */}
      {(hasOpeningHours(fields.openingHours) || hasStr(fields.timezone) || hasStr(fields.receivingHours) || hasStr(fields.supportHours) || hasStr(fields.deliveryInstructions) || hasStr(fields.holidayNotes) || hasStr(fields.escalationContact)) && (
        <>
          <SectionHeader title="Opening Hours & Operations" />
          {hasOpeningHours(fields.openingHours) && (
            <div style={{ marginBottom: '8px', fontSize: '13px' }}>
              {(fields.openingHours as Array<{ days?: string; from?: string; to?: string }>).map((h, i) => (
                <div key={i}>{h.days}: {h.from}–{h.to}</div>
              ))}
            </div>
          )}
          {hasStr(fields.timezone) && <SectionRow label="Timezone" value={String(fields.timezone)} />}
          {hasStr(fields.receivingHours) && <SectionRow label="Receiving Hours" value={String(fields.receivingHours)} />}
          {hasStr(fields.supportHours) && <SectionRow label="Support Hours" value={String(fields.supportHours)} />}
          {hasStr(fields.deliveryInstructions) && <SectionRow label="Delivery" value={String(fields.deliveryInstructions)} />}
          {hasStr(fields.holidayNotes) && <SectionRow label="Holiday Notes" value={String(fields.holidayNotes)} />}
          {hasStr(fields.escalationContact) && <SectionRow label="Escalation Contact" value={String(fields.escalationContact)} />}
        </>
      )}

      {/* Billing — only show when at least one field has content */}
      {(hasStr(fields.billingEmail) || hasStr(fields.paymentTerms) || hasStr(fields.bankDetails) || hasPaymentMethods(fields.paymentMethods)) && (
        <>
          <SectionHeader title="Billing" />
          {hasStr(fields.billingEmail) && <SectionRow label="Billing Email" value={String(fields.billingEmail)} />}
          {hasStr(fields.paymentTerms) && <SectionRow label="Payment Terms" value={String(fields.paymentTerms)} />}
          {hasPaymentMethods(fields.paymentMethods)
            ? (
                <SectionRow
                  label="Payment Methods"
                  value={(fields.paymentMethods as Array<{ type: string; iban?: string; bic?: string; bank_name?: string; account_holder?: string; paypal_email?: string }>)
                    .map((m) => {
                      if (m.type === 'bank_account') return [m.iban, m.bic, m.bank_name, m.account_holder].filter(Boolean).join(' — ')
                      if (m.type === 'paypal' && m.paypal_email) return `PayPal: ${m.paypal_email}`
                      if (m.type === 'credit_card') return 'Card (masked)'
                      return ''
                    })
                    .filter(Boolean)
                    .join(' | ')}
                />
              )
            : hasStr(fields.bankDetails) && <SectionRow label="Bank Details" value={String(fields.bankDetails)} />}
        </>
      )}

      {/* Links */}
      {validLinks.length > 0 && (
        <>
          <SectionHeader title="Links" />
          {validLinks.map(({ url, validation }) => (
            <div key={validation.url} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--color-text-muted, #94a3b8)', wordBreak: 'break-all' }}>{validation.url}</span>
              {vaultUnlocked && (
                <button
                  type="button"
                  onClick={() => onOpenLink(url)}
                  style={{
                    fontSize: '10px', padding: '4px 8px', flexShrink: 0,
                    background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                    borderRadius: '4px', color: '#60a5fa', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Open link
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Documents */}
      {documents.length > 0 && (
        <>
          <SectionHeader title="Documents" />
          {documents.map((doc) => {
            const isPreviewExpanded = expandedDoc === doc.id
            const firstLines = doc.extracted_text
              ? doc.extracted_text.split('\n').slice(0, PREVIEW_LINES).join('\n')
              : ''
            const hasMore = (doc.extracted_text?.split('\n').length ?? 0) > PREVIEW_LINES
            return (
              <div
                key={doc.id}
                style={{
                  padding: '12px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '6px',
                  marginBottom: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                    📄 {doc.label?.trim() || doc.filename}
                    {doc.document_type && <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', marginLeft: '6px' }}>({doc.document_type})</span>}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {doc.sensitive && (
                      <span style={{ fontSize: '9px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600 }}>Sensitive</span>
                    )}
                    {doc.extracted_text && (
                      <button
                        type="button"
                        onClick={() => onOpenReader(doc)}
                        style={{
                          fontSize: '10px', padding: '4px 8px',
                          background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                          borderRadius: '4px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        Open Document Reader
                      </button>
                    )}
                    {vaultUnlocked && doc.id && (
                      <button
                        type="button"
                        onClick={() => onViewOriginal(doc)}
                        style={{
                          fontSize: '10px', padding: '4px 8px',
                          background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                          borderRadius: '4px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        View original
                      </button>
                    )}
                  </div>
                </div>
                {doc.extracted_text && (
                  <div style={{ marginTop: '10px' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedDoc(isPreviewExpanded ? null : doc.id)}
                      style={{
                        fontSize: '11px', padding: 0, background: 'none', border: 'none',
                        color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {isPreviewExpanded ? '▾ Hide preview' : '▸ Show preview'}
                    </button>
                    {isPreviewExpanded && (
                      <>
                        <pre style={{
                          marginTop: '8px', padding: '10px', fontSize: '11px',
                          background: 'rgba(0,0,0,0.25)',
                          borderRadius: '6px',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          maxHeight: '72px', overflowY: 'auto',
                          color: 'var(--color-text, #e2e8f0)',
                          fontFamily: 'inherit',
                        }}>
                          {firstLines}{hasMore ? '\n…' : ''}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* Custom Fields — only show when at least one has label or value */}
      {hasCustomFieldsWithContent(customFields) && (
        <>
          <SectionHeader title="Custom Fields" />
          {customFields.filter((cf) => hasStr(cf.label) || hasStr(cf.value)).map((cf, i) => (
            <SectionRow key={i} label={cf.label?.trim() || 'Custom'} value={cf.value ?? ''} />
          ))}
        </>
      )}
    </div>
  )
}

export default function StructuredHsContextPanel({
  blocks,
  handshakeId,
  vaultUnlocked,
  onVisibilityChange,
  senderWrdeskUserId = '',
}: StructuredHsContextPanelProps) {
  const [warningDialog, setWarningDialog] = useState<{ kind: 'original' | 'link'; targetLabel: string; documentId?: string; linkUrl?: string } | null>(null)
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)
  const [showFullForDoc, setShowFullForDoc] = useState<string | null>(null)
  const [readerDoc, setReaderDoc] = useState<{ id: string; filename: string } | null>(null)

  const handleViewOriginal = (doc: { id: string; filename: string }) => {
    setWarningDialog({ kind: 'original', targetLabel: doc.filename, documentId: doc.id })
  }
  const handleOpenReader = (doc: { id: string; filename: string }) => {
    setReaderDoc(doc)
  }
  const handleOpenLink = (url: string) => {
    setWarningDialog({ kind: 'link', targetLabel: url, linkUrl: url })
  }
  const handleWarningAcknowledge = async () => {
    if (!warningDialog) return
    const { kind, documentId, linkUrl } = warningDialog
    setWarningDialog(null)
    if (kind === 'original' && documentId) {
      const result = await window.handshakeView?.requestOriginalDocument?.(documentId, true, handshakeId)
      if (result?.success && result.contentBase64 && result.filename) {
        try {
          const bin = Uint8Array.from(atob(result.contentBase64), c => c.charCodeAt(0))
          const blob = new Blob([bin], { type: result.mimeType || 'application/pdf' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = result.filename
          a.click()
          URL.revokeObjectURL(a.href)
        } catch { /* ignore */ }
      }
    } else if (kind === 'link' && linkUrl) {
      const validation = validateHsContextLink(linkUrl)
      if (validation.ok) {
        const result = await window.handshakeView?.requestLinkOpenApproval?.(linkEntityId(validation.url), true, handshakeId)
        if (result?.success) window.open(validation.url, '_blank', 'noopener,noreferrer')
      }
    }
  }

  return (
    <>
      {blocks.map((block) => (
        <StructuredHsContextBlock
          key={`${block.block_id}-${block.block_hash}`}
          block={block}
          handshakeId={handshakeId}
          vaultUnlocked={vaultUnlocked}
          expandedDoc={expandedDoc}
          setExpandedDoc={setExpandedDoc}
          showFullForDoc={showFullForDoc}
          setShowFullForDoc={setShowFullForDoc}
          onViewOriginal={handleViewOriginal}
          onOpenLink={handleOpenLink}
          onOpenReader={handleOpenReader}
        />
      ))}

      {readerDoc && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => e.target === e.currentTarget && setReaderDoc(null)}
        >
          <div style={{ width: '100%', maxWidth: 900, height: '85vh', maxHeight: 700 }} onClick={(e) => e.stopPropagation()}>
            <HsContextDocumentReader
              documentId={readerDoc.id}
              filename={readerDoc.filename}
              mimeType="application/pdf"
              canViewOriginal={vaultUnlocked}
              onViewOriginal={() => {
                setReaderDoc(null)
                handleViewOriginal(readerDoc)
              }}
              onClose={() => setReaderDoc(null)}
            />
          </div>
        </div>
      )}

      {warningDialog && (
        <ProtectedAccessWarningDialog
          kind={warningDialog.kind}
          targetLabel={warningDialog.targetLabel}
          open={!!warningDialog}
          onClose={() => setWarningDialog(null)}
          onAcknowledge={handleWarningAcknowledge}
        />
      )}
    </>
  )
}
