/**
 * HandshakeWorkspace — Unified view for a selected handshake
 *
 * One click on a handshake shows: header, Context Graph, BEAP messages, summary.
 * Technical Details and Policies are accessible via header buttons (compact modals).
 * Pending is a slide-out, not a permanent column.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import VaultStatusIndicator from './VaultStatusIndicator'
import PolicyRadioGroup, { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'
import { parsePolicyToMode } from '@shared/handshake/policyUtils'
import { validateHsContextLink, linkEntityId } from '@shared/handshake/linkValidation'
import ProtectedAccessWarningDialog from './ProtectedAccessWarningDialog'
import StructuredHsContextPanel, { KNOWN_HS_CONTEXT_LINK_FIELDS } from './StructuredHsContextPanel'

// ── Types ──

interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: 'PENDING_ACCEPT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  last_seq_received: number
  last_seq_sent?: number
  last_capsule_hash_received: string
  last_capsule_hash_sent?: string
  initiator_context_commitment?: string | null
  acceptor_context_commitment?: string | null
  p2p_endpoint?: string | null
  context_sync_pending?: boolean
  policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
}

interface ContextBlockWithVisibility {
  sender_wrdesk_user_id: string
  block_id: string
  block_hash: string
  handshake_id: string
  relationship_id: string
  type: string
  data_classification: string
  visibility: 'public' | 'private'
  source: 'sent' | 'received'
  payload: string
  parsedContent: string
  isStructured: boolean
  hasStructuredProfile: boolean
  governance_json?: string
  created_at?: string
}

interface ContextGraphFilter {
  visibility: 'all' | 'public' | 'private'
  direction: 'all' | 'sent' | 'received'
  type: 'all' | 'structured' | 'unstructured'
}

interface HandshakeWorkspaceProps {
  record: HandshakeRecord
  handshakeEmail: string
  contextBlockCount: number
  vaultStatus?: { isUnlocked: boolean; name: string | null } | null
  vaultWarningEscalated?: boolean
  pendingCount: number
  onRevoke?: () => void
  onDelete?: () => void
  onPendingClick?: () => void
  onCapsuleSubmitted?: () => void
  onDocumentSelect?: (documentId: string | null) => void
}

// ── Helpers ──

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return '—' }
}

function shortHash(hash: string): string {
  if (!hash) return '—'
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash
}

function isBlockStructured(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch { return false }
}

/** Profile-like keys that indicate structured metadata (company, address, contact, etc.) */
const PROFILE_KEY_PATTERNS = [
  'company', 'legal', 'address', 'city', 'country', 'street', 'postal', 'contact',
  'email', 'phone', 'vat', 'registration', 'opening_hours', 'industry', 'founded',
  'employees', 'website', 'tax_id', 'legal_name', 'legalName', 'companyName',
]

function hasStructuredProfileData(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
    const keys = Object.keys(parsed)
    if (keys.length === 0) return false
    const keyStr = keys.join(' ').toLowerCase()
    const hasProfileKey = PROFILE_KEY_PATTERNS.some(p => keyStr.includes(p.toLowerCase()))
    if (!hasProfileKey) return false
    const values = Object.values(parsed)
    const allShort = values.every(v => typeof v !== 'string' || v.length < 500)
    return allShort
  } catch { return false }
}

function formatStructuredProfileCompact(payload: string): string {
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const entries = Object.entries(parsed)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .slice(0, 6)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v).slice(0, 80)}${String(v).length > 80 ? '…' : ''}`)
    return entries.join(' · ')
  } catch { return '' }
}

function extractTextFromPayload(payload: string): string {
  if (!payload || typeof payload !== 'string') return ''
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'number' || typeof parsed === 'boolean') return String(parsed)
    if (Array.isArray(parsed)) {
      return parsed.map((v, i) => {
        if (typeof v === 'object' && v !== null) return `${i}: ${JSON.stringify(v)}`
        return String(v)
      }).join(', ')
    }
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.entries(parsed)
        .map(([k, v]) => {
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) return `${k}: ${JSON.stringify(v)}`
          return `${k}: ${String(v)}`
        })
        .join(', ')
    }
    return payload
  } catch { return payload }
}

function blockTitle(block: ContextBlockWithVisibility): string {
  const id = block.block_id || ''
  if (id.startsWith('ctx-')) {
    const rest = id.slice(4).replace(/-/g, ' ')
    return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : 'Context'
  }
  try {
    const parsed = JSON.parse(block.payload)
    if (typeof parsed === 'object' && parsed !== null) {
      const firstKey = Object.keys(parsed)[0]
      if (firstKey) return firstKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
  } catch { /* ignore */ }
  return id || 'Block'
}

// ── StateBadge ──

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    ACTIVE: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
    ACCEPTED: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
    PENDING_ACCEPT: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    PENDING_REVIEW: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    REVOKED: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
    EXPIRED: { bg: 'rgba(107,114,128,0.12)', text: '#6b7280', border: 'rgba(107,114,128,0.3)' },
  }
  const c = colors[state] || colors.EXPIRED
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '3px 10px',
      borderRadius: '5px', background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, textTransform: 'uppercase',
    }}>
      {state.replace('_', ' ')}
    </span>
  )
}

// ── InlineFilterChip (compact, for section header) ──

function InlineFilterChip({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      style={{
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '4px',
        border: 'none',
        backgroundColor: active ? 'rgba(124,58,237,0.4)' : 'transparent',
        color: active ? '#fff' : (disabled ? 'var(--color-text-muted, #64748b)' : 'var(--color-text-muted, #94a3b8)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  )
}

// ── BlockCard with Read more + Block Details ──

function BlockCard({
  block,
  vaultUnlocked,
  handshakeId,
  onVisibilityChange,
}: {
  block: ContextBlockWithVisibility
  vaultUnlocked: boolean
  handshakeId: string
  onVisibilityChange: () => void
}) {
  const [readMore, setReadMore] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [unstructuredExpanded, setUnstructuredExpanded] = useState(false)
  const [warningDialog, setWarningDialog] = useState<{ kind: 'original' | 'link'; targetLabel: string; documentId?: string; linkUrl?: string } | null>(null)
  const isPrivate = block.visibility === 'private'
  const contentHidden = isPrivate && !vaultUnlocked
  const canToggle = vaultUnlocked
  const hasProfile = block.hasStructuredProfile
  const isOwnBlock = block.source === 'sent'
  const { documents, links } = parseBlockPayloadForProtectedAccess(block.payload)
  const validLinks = links
    .map(({ url }) => ({ url, validation: validateHsContextLink(url) }))
    .filter(({ validation }) => validation.ok) as Array<{ url: string; validation: { ok: true; url: string } }>

  const handleViewOriginal = (doc: { id: string; filename: string }) => {
    setWarningDialog({ kind: 'original', targetLabel: doc.filename, documentId: doc.id })
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
    <div style={{
      width: '100%', margin: '0 0 12px', padding: '16px',
      background: block.source === 'received' ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
      border: block.source === 'received' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>{isPrivate ? '🔒' : '🟢'}</span>
          <span style={{
            fontSize: '12px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {blockTitle(block)}
          </span>
          <span style={{
            fontSize: '9px', padding: '2px 6px', borderRadius: '3px',
            background: block.isStructured ? 'rgba(59,130,246,0.12)' : 'rgba(107,114,128,0.15)',
            color: block.isStructured ? '#3b82f6' : '#94a3b8',
            fontWeight: 600, flexShrink: 0,
          }}>
            {block.isStructured ? 'Structured' : 'Unstructured'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <span style={{
            fontSize: '9px', padding: '2px 6px', borderRadius: '3px',
            background: block.source === 'received' ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.1)',
            color: block.source === 'received' ? '#a78bfa' : '#22c55e',
            fontWeight: 600,
          }}>
            {block.source === 'received' ? 'Received' : 'Sent'}
          </span>
          <span style={{
            fontSize: '9px', padding: '2px 6px', borderRadius: '3px',
            background: block.visibility === 'public' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
            color: block.visibility === 'public' ? '#22c55e' : '#f59e0b',
            fontWeight: 600,
          }}>
            {block.visibility === 'public' ? 'Public' : 'Private'}
          </span>
          {canToggle && (
            <button
              type="button"
              onClick={onVisibilityChange}
              title={`Toggle to ${isPrivate ? 'public' : 'private'}`}
              style={{
                padding: '3px 8px', fontSize: '10px', fontWeight: 600,
                background: isPrivate ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)',
                color: isPrivate ? '#f59e0b' : '#22c55e',
                border: `1px solid ${isPrivate ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.3)'}`,
                borderRadius: '4px', cursor: 'pointer',
              }}
            >
              {isPrivate ? 'Private' : 'Public'}
            </button>
          )}
        </div>
      </div>
      {contentHidden ? (
        <div style={{ color: 'var(--color-text-muted, #94a3b8)', fontStyle: 'italic', fontSize: '12px' }}>
          🔒 Vault locked – unlock to view content
        </div>
      ) : hasProfile ? (
        <>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary, #94a3b8)', lineHeight: 1.5 }}>
            {readMore ? block.parsedContent : (formatStructuredProfileCompact(block.payload) || block.parsedContent.substring(0, 150))}
            {!readMore && block.parsedContent.length > 150 && '...'}
          </div>
          {block.parsedContent.length > 0 && (
            <button
              type="button"
              onClick={() => setReadMore(!readMore)}
              style={{
                marginTop: '8px', padding: 0, background: 'none', border: 'none',
                fontSize: '11px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
              }}
            >
              {readMore ? 'Show less' : 'Show more'}
            </button>
          )}
          {vaultUnlocked && (
            <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {isOwnBlock && documents.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => handleViewOriginal(doc)}
                  style={{
                    fontSize: '10px', padding: '4px 8px',
                    background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                    borderRadius: '4px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  View original: {doc.filename}
                </button>
              ))}
              {validLinks.map(({ url, validation }) => (
                <button
                  key={validation.url}
                  type="button"
                  onClick={() => handleOpenLink(url)}
                  style={{
                    fontSize: '10px', padding: '4px 8px',
                    background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                    borderRadius: '4px', color: '#60a5fa', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Open link
                </button>
              ))}
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
      ) : (
        <>
          {!unstructuredExpanded ? (
            <button
              type="button"
              onClick={() => setUnstructuredExpanded(true)}
              style={{
                padding: 0, background: 'none', border: 'none',
                fontSize: '11px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
              }}
            >
              ▸ Show content
            </button>
          ) : (
            <>
              <div style={{ fontSize: '13px', color: 'var(--color-text-secondary, #94a3b8)', lineHeight: 1.5 }}>
                {readMore ? block.parsedContent : block.parsedContent.substring(0, 150)}
                {block.parsedContent.length > 150 && !readMore && '...'}
              </div>
              {block.parsedContent.length > 150 && (
                <button
                  type="button"
                  onClick={() => setReadMore(!readMore)}
                  style={{
                    marginTop: '8px', padding: 0, background: 'none', border: 'none',
                    fontSize: '11px', color: '#a78bfa', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {readMore ? 'Read less' : 'Read more'}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setUnstructuredExpanded(false); setReadMore(false) }}
                style={{
                  marginTop: '8px', marginLeft: '12px', padding: 0, background: 'none', border: 'none',
                  fontSize: '11px', color: 'var(--color-text-muted, #6b7280)', cursor: 'pointer',
                }}
              >
                ▾ Hide content
              </button>
            </>
          )}
        </>
      )}
      <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: '10px', color: 'var(--color-text-muted, #6b7280)',
            textAlign: 'left', fontFamily: 'inherit',
          }}
        >
          {showDetails ? '▾' : '▸'} Block Details
        </button>
        {showDetails && (
          <div style={{ marginTop: '6px', fontSize: '10px', fontFamily: 'monospace', color: 'var(--color-text-muted, #94a3b8)' }}>
            <div>block_id: {block.block_id}</div>
            <div>hash: {shortHash(block.block_hash)}</div>
            <div>data_classification: {block.data_classification}</div>
            {block.created_at && <div>created_at: {block.created_at}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Crypto Details (proof chain + technical) ──

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </span>
      <span style={{ fontSize: '12px', color: 'var(--color-text, #e2e8f0)', fontFamily: 'monospace', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function CopyableHash({ label, hash }: { label: string; hash: string | null }) {
  const display = hash ? shortHash(hash) : '—'
  const copyable = !!hash
  const handleClick = () => { if (hash) try { navigator.clipboard.writeText(hash) } catch { /* ignore */ } }
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</span>
      <span onClick={handleClick} title={copyable ? hash : undefined} style={{
        fontSize: '12px', color: copyable ? 'var(--color-text, #e2e8f0)' : 'var(--color-text-muted, #94a3b8)',
        fontFamily: 'monospace', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all',
        cursor: copyable ? 'pointer' : 'default', userSelect: 'none',
      }}>
        {display}
      </span>
    </div>
  )
}

interface P2PQueueEntry { status: 'pending' | 'sent' | 'failed'; retry_count: number; error: string | null }

function RelayStatusHint() {
  const [health, setHealth] = useState<{ relay_mode?: string; last_relay_pull_error?: string | null } | null>(null)
  useEffect(() => {
    ;(window as any).p2p?.getHealth?.().then((h: any) => setHealth(h)).catch(() => setHealth(null))
    const t = setInterval(() => { ;(window as any).p2p?.getHealth?.().then((h: any) => setHealth(h)).catch(() => {}) }, 15_000)
    return () => clearInterval(t)
  }, [])
  if (!health || health.relay_mode !== 'remote') return null
  const err = health.last_relay_pull_error
  if (err) {
    const isAuth = err.toLowerCase().includes('auth')
    return <MetaRow label="Relay" value={isAuth ? 'Auth failed — check configuration' : `Unreachable — ${err.slice(0, 50)}${err.length > 50 ? '…' : ''}`} />
  }
  return <MetaRow label="Relay" value="Active — last sync OK" />
}

function P2PDeliveryStatus({ handshakeId, p2pEndpoint }: { handshakeId: string; p2pEndpoint: string | null | undefined }) {
  const [entries, setEntries] = useState<P2PQueueEntry[]>([])
  const [useCoordination, setUseCoordination] = useState(false)
  useEffect(() => {
    if (!handshakeId || !(window as any).p2p?.getQueueStatus) return
    ;(window as any).p2p.getQueueStatus(handshakeId).then((r: { entries: P2PQueueEntry[] }) => setEntries(r?.entries ?? [])).catch(() => setEntries([]))
    ;(window as any).p2p?.getHealth?.().then((h: { use_coordination?: boolean }) => setUseCoordination(!!h?.use_coordination)).catch(() => {})
    const t = setInterval(() => {
      ;(window as any).p2p?.getQueueStatus(handshakeId).then((r: { entries: P2PQueueEntry[] }) => setEntries(r?.entries ?? [])).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [handshakeId])
  if (!p2pEndpoint) return <MetaRow label="P2P" value="No endpoint — context exchanged manually" />
  const pending = entries.filter((e) => e.status === 'pending')
  const sent = entries.filter((e) => e.status === 'sent')
  const failed = entries.filter((e) => e.status === 'failed')
  const deliveryLabel = useCoordination ? 'wrdesk.com' : 'P2P'
  if (sent.length > 0 && pending.length === 0 && failed.length === 0) return <MetaRow label="P2P" value={`Delivered via ${deliveryLabel} ✓`} />
  if (pending.length > 0) return <MetaRow label="P2P" value={useCoordination ? 'Delivery pending — recipient may be offline' : `Context delivery in progress... (attempt ${(pending[0]?.retry_count ?? 0) + 1})`} />
  if (failed.length > 0) {
    const err = failed[0]?.error ?? 'Unknown error'
    return <MetaRow label="P2P" value={`Context delivery failed — ${err.slice(0, 60)}${err.length > 60 ? '…' : ''}`} />
  }
  return <MetaRow label="P2P" value="No queue entries" />
}

function CryptoDetailsContent({
  record,
  contextBlocks,
}: {
  record: HandshakeRecord
  contextBlocks: ContextBlockWithVisibility[]
}) {
  const myCommitment = record.local_role === 'initiator' ? (record.initiator_context_commitment ?? null) : (record.acceptor_context_commitment ?? null)
  const counterpartyCommitment = record.local_role === 'initiator' ? (record.acceptor_context_commitment ?? null) : (record.initiator_context_commitment ?? null)
  const myRoleLabel = record.local_role === 'initiator' ? '(Initiator)' : '(Acceptor)'
  const counterpartyRoleLabel = record.local_role === 'initiator' ? '(Acceptor)' : '(Initiator)'
  const lastSeqReceived = record.last_seq_received ?? 0
  const lastSeqSent = record.last_seq_sent ?? 0
  const latestCapsuleHash = lastSeqReceived >= lastSeqSent ? record.last_capsule_hash_received : (record.last_capsule_hash_sent ?? record.last_capsule_hash_received)
  const latestSeq = Math.max(lastSeqReceived, lastSeqSent)
  const bothCommitments = !!(record.initiator_context_commitment ?? null) && !!(record.acceptor_context_commitment ?? null)
  const contextSyncPending = !!record.context_sync_pending
  const copyHash = (hash: string | null) => { if (hash) try { navigator.clipboard.writeText(hash) } catch { /* ignore */ } }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ background: 'var(--color-surface, rgba(255,255,255,0.03))', border: '1px solid var(--color-border, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid rgba(139,92,246,0.4)' }}>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>
            Your Context Commitment {myRoleLabel}
          </div>
          {myCommitment ? (
            <span onClick={() => copyHash(myCommitment)} title={myCommitment} style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text, #e2e8f0)', cursor: 'pointer', userSelect: 'none' }}>
              {shortHash(myCommitment)}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>Not yet generated</span>
          )}
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>
            Counterparty Context Commitment {counterpartyRoleLabel}
          </div>
          {counterpartyCommitment ? (
            <span onClick={() => copyHash(counterpartyCommitment)} title={counterpartyCommitment} style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text, #e2e8f0)', cursor: 'pointer', userSelect: 'none' }}>
              {shortHash(counterpartyCommitment)}
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>Awaiting counterparty</span>
          )}
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>Capsule Chain Integrity</div>
          <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text, #e2e8f0)' }}>
            {latestCapsuleHash ? <span onClick={() => copyHash(latestCapsuleHash)} title={latestCapsuleHash} style={{ cursor: 'pointer', userSelect: 'none' }}>{shortHash(latestCapsuleHash)}</span> : <span style={{ color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>—</span>}
            {' · seq '}{latestSeq}
          </div>
          <div style={{ fontSize: '11px', color: contextSyncPending ? '#f59e0b' : bothCommitments ? '#22c55e' : '#f59e0b' }}>
            {contextSyncPending ? '⏳ Context delivery in progress' : bothCommitments ? '✓ Both context commitments are signed into the capsule chain' : '⏳ Awaiting counterparty commitment'}
          </div>
        </div>
      </div>
      <div style={{ background: 'var(--color-surface, rgba(255,255,255,0.03))', border: '1px solid var(--color-border, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>Delivery</div>
        <RelayStatusHint />
        <P2PDeliveryStatus handshakeId={record.handshake_id} p2pEndpoint={record.p2p_endpoint} />
      </div>
      <div style={{ background: 'var(--color-surface, rgba(255,255,255,0.03))', border: '1px solid var(--color-border, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>Chain Metadata</div>
        <MetaRow label="Handshake ID" value={record.handshake_id} />
        <MetaRow label="Relationship ID" value={record.relationship_id} />
        <MetaRow label="Last seq received" value={String(record.last_seq_received)} />
        <MetaRow label="Last capsule hash" value={shortHash(record.last_capsule_hash_received)} />
      </div>
      <div style={{ background: 'var(--color-surface, rgba(255,255,255,0.03))', border: '1px solid var(--color-border, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>Context Commitments</div>
        <CopyableHash label="Sender" hash={record.initiator_context_commitment} />
        <CopyableHash label="Receiver" hash={record.acceptor_context_commitment} />
      </div>
      <div style={{ background: 'var(--color-surface, rgba(255,255,255,0.03))', border: '1px solid var(--color-border, rgba(255,255,255,0.08))', borderRadius: '8px', padding: '12px 14px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>Timeline</div>
        <MetaRow label="Created" value={formatDate(record.created_at)} />
        <MetaRow label="Activated" value={formatDate(record.activated_at)} />
        <MetaRow label="Expires" value={formatDate(record.expires_at)} />
      </div>
    </div>
  )
}

// ── Main Component ──

// ── Parse block payload for documents and links ──
function parseBlockPayloadForProtectedAccess(payload: string): { documents: Array<{ id: string; filename: string }>; links: Array<{ url: string; label: string }> } {
  const documents: Array<{ id: string; filename: string }> = []
  const links: Array<{ url: string; label: string }> = []
  try {
    const parsed = JSON.parse(payload)
    if (typeof parsed !== 'object' || parsed === null) return { documents, links }
    if (Array.isArray(parsed.documents)) {
      for (const d of parsed.documents) {
        if (d?.id && d?.filename) documents.push({ id: d.id, filename: d.filename })
      }
    }
    const profile = parsed.profile
    const fields = profile?.fields
    if (fields && typeof fields === 'object') {
      for (const k of KNOWN_HS_CONTEXT_LINK_FIELDS) {
        const v = (fields as Record<string, unknown>)[k]
        if (typeof v === 'string' && v.trim()) links.push({ url: v.trim(), label: v.trim() })
      }
      const customFields = (profile as { custom_fields?: Array<{ value?: string }> }).custom_fields
      if (Array.isArray(customFields)) {
        for (const cf of customFields) {
          const v = cf?.value
          if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) links.push({ url: v.trim(), label: v.trim() })
        }
      }
    }
  } catch { /* ignore */ }
  return { documents, links }
}

export default function HandshakeWorkspace({
  record,
  handshakeEmail,
  contextBlockCount,
  vaultStatus,
  vaultWarningEscalated,
  pendingCount,
  onRevoke,
  onDelete,
  onPendingClick,
  onCapsuleSubmitted,
  onDocumentSelect,
}: HandshakeWorkspaceProps) {
  const vaultUnlocked = vaultStatus?.isUnlocked ?? false
  const showVaultIndicator = ((record.state === 'PENDING_ACCEPT' || record.state === 'PENDING_REVIEW') && record.local_role === 'acceptor') || record.state === 'ACCEPTED'

  const [blocks, setBlocks] = useState<ContextBlockWithVisibility[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<ContextGraphFilter>({ visibility: 'all', direction: 'received', type: 'all' })
  const [contextGraphExpanded, setContextGraphExpanded] = useState(false)
  const [showAllBeapMessages, setShowAllBeapMessages] = useState(false)
  const [cryptoModalOpen, setCryptoModalOpen] = useState(false)
  const [policyModalOpen, setPolicyModalOpen] = useState(false)
  const cryptoModalRef = useRef<HTMLDivElement>(null)
  const policyModalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (cryptoModalOpen) cryptoModalRef.current?.focus()
  }, [cryptoModalOpen])
  useEffect(() => {
    if (policyModalOpen) policyModalRef.current?.focus()
  }, [policyModalOpen])
  const initialPolicy: PolicySelection = record.policy_selections ? { ai_processing_mode: parsePolicyToMode(record.policy_selections) } : DEFAULT_AI_POLICY
  const [policies, setPolicies] = useState<PolicySelection>(initialPolicy)

  const loadBlocks = useCallback(async () => {
    if (record.state !== 'ACCEPTED' && record.state !== 'ACTIVE') return
    setLoading(true)
    try {
      const qcb = window.handshakeView?.queryContextBlocks
      const raw = typeof qcb === 'function' ? await qcb(record.handshake_id) : []
      const arr = Array.isArray(raw) ? raw : []
      const mapped: ContextBlockWithVisibility[] = arr.map((b: any) => {
        const payload = b?.payload_ref ?? b?.payload ?? ''
        return {
          sender_wrdesk_user_id: b?.sender_wrdesk_user_id ?? '',
          block_id: b?.block_id ?? '',
          block_hash: b?.block_hash ?? '',
          handshake_id: b?.handshake_id ?? record.handshake_id,
          relationship_id: b?.relationship_id ?? '',
          type: b?.type ?? 'text',
          data_classification: b?.data_classification ?? 'public',
          visibility: (b?.visibility ?? 'public') as 'public' | 'private',
          source: b?.source ?? 'received',
          payload,
          parsedContent: extractTextFromPayload(payload),
          isStructured: isBlockStructured(payload),
          hasStructuredProfile: hasStructuredProfileData(payload),
          governance_json: b?.governance_json,
          created_at: b?.created_at,
        }
      })
      setBlocks(mapped)
    } catch { setBlocks([]) }
    finally { setLoading(false) }
  }, [record.handshake_id, record.state])

  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  // Auto-expand only when the SENDER (other party) provided HS Context (vault_profile blocks we received).
  // Normal Pro-tier generic context must NOT trigger auto-expansion.
  useEffect(() => {
    if (loading) return
    const hasSenderHsStructuredContext = blocks.some(
      (b) => b.type === 'vault_profile' && b.source === 'received'
    )
    setContextGraphExpanded(hasSenderHsStructuredContext)
  }, [loading, blocks])

  useEffect(() => {
    setPolicies(record.policy_selections ? { ai_processing_mode: parsePolicyToMode(record.policy_selections) } : DEFAULT_AI_POLICY)
  }, [record.policy_selections])

  const handlePolicyChange = (next: PolicySelection) => {
    setPolicies(next)
    window.handshakeView?.updateHandshakePolicies?.(record.handshake_id, { ai_processing_mode: next.ai_processing_mode })
  }

  const handleAttachData = () => {
    window.dispatchEvent(new CustomEvent('handshake:requestAttachContext', { detail: { handshakeId: record.handshake_id } }))
  }

  const handleToggleVisibility = async (block: ContextBlockWithVisibility) => {
    const setVis = window.handshakeView?.setBlockVisibility
    if (typeof setVis !== 'function') return
    const newVis = block.visibility === 'public' ? 'private' : 'public'
    const result = await setVis({ sender_wrdesk_user_id: block.sender_wrdesk_user_id, block_id: block.block_id, block_hash: block.block_hash, visibility: newVis })
    if (result?.success) loadBlocks()
  }

  const filteredBlocks = blocks.filter((b) => {
    if (filter.visibility !== 'all' && b.visibility !== filter.visibility) return false
    if (filter.direction !== 'all' && b.source !== filter.direction) return false
    if (filter.type === 'structured' && !b.isStructured) return false
    if (filter.type === 'unstructured' && b.isStructured) return false
    return true
  })

  // HS Context blocks (vault_profile) → structured panel. All others → generic BlockCard.
  const hsContextBlocks = filteredBlocks.filter((b) => b.type === 'vault_profile')
  const genericBlocks = filteredBlocks.filter((b) => b.type !== 'vault_profile')

  const INITIAL_MESSAGE_COUNT = 15
  const beapMessages: any[] = [] // Placeholder until BEAP messages are loaded
  const visibleBeapMessages = showAllBeapMessages ? beapMessages : beapMessages.slice(0, INITIAL_MESSAGE_COUNT)

  const publicCount = blocks.filter(b => b.visibility === 'public').length
  const privateCount = blocks.filter(b => b.visibility === 'private').length
  const structuredCount = blocks.filter(b => b.isStructured).length
  const unstructuredCount = blocks.filter(b => !b.isStructured).length
  const sentCount = blocks.filter(b => b.source === 'sent').length
  const receivedCount = blocks.filter(b => b.source === 'received').length

  const isActiveOrAccepted = record.state === 'ACCEPTED' || record.state === 'ACTIVE'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'visible',
      background: 'var(--color-bg, #0f172a)', color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* ── Workspace Header ── */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ minWidth: 0, flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>
              {handshakeEmail}
            </h2>
            <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
              {record.local_role} · {record.sharing_mode ?? 'reciprocal'} · {formatDate(record.created_at)}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center', justifyContent: 'flex-end' }}>
            {/* status/meta group: metadata links + badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px 6px', flexWrap: 'wrap' }}>
              {isActiveOrAccepted && (
                <>
                  <button
                    type="button"
                    onClick={() => setCryptoModalOpen(true)}
                    style={{
                      padding: 0, margin: 0, border: 'none', background: 'none',
                      fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)',
                      cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
                    }}
                  >
                    Technical Details
                  </button>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-muted, #64748b)' }}>·</span>
                  <button
                    type="button"
                    onClick={() => setPolicyModalOpen(true)}
                    style={{
                      padding: 0, margin: 0, border: 'none', background: 'none',
                      fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)',
                      cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
                    }}
                  >
                    Policies
                  </button>
                  <span style={{ fontSize: '10px', color: 'var(--color-text-muted, #64748b)' }}>·</span>
                </>
              )}
              <StateBadge state={record.state} />
            </div>
            {/* action group: Revoke, Pending Requests */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {isActiveOrAccepted && onRevoke && (
                <button
                  onClick={onRevoke}
                  style={{
                    padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                    background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  Revoke
                </button>
              )}
              {(record.state === 'REVOKED' || record.state === 'EXPIRED') && onDelete && (
                <button
                  onClick={onDelete}
                  style={{
                    padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                    background: 'rgba(107,114,128,0.15)', color: '#94a3b8',
                    border: '1px solid rgba(107,114,128,0.3)', borderRadius: '6px', cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={onPendingClick}
                style={{
                  padding: '4px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
                  backgroundColor: pendingCount > 0 ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: pendingCount > 0 ? '#f59e0b' : 'var(--color-text-muted, #94a3b8)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                Pending Requests
                {pendingCount > 0 ? (
                  <span style={{
                    backgroundColor: '#f0ad4e',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '1px 7px',
                    fontSize: '11px',
                    fontWeight: 700,
                    minWidth: '18px',
                    textAlign: 'center',
                  }}>
                    {pendingCount}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #64748b)' }}>(0)</span>
                )}
              </button>
            </div>
          </div>
        </div>

        {showVaultIndicator && (
          <div style={{ marginTop: '12px' }}>
            <VaultStatusIndicator
              vaultName={vaultStatus?.name ?? null}
              isUnlocked={vaultUnlocked}
              warningEscalated={vaultWarningEscalated ?? false}
            />
          </div>
        )}

        {/* State notices */}
        {record.state === 'PENDING_ACCEPT' && (
          <div style={{ marginTop: '12px', padding: '14px 16px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>Awaiting acceptance</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>The counterparty has not yet accepted this handshake request.</div>
          </div>
        )}
        {record.state === 'REVOKED' && (
          <div style={{ marginTop: '12px', padding: '14px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', marginBottom: '4px' }}>Handshake revoked</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>This relationship has been terminated.</div>
          </div>
        )}
        {record.state === 'EXPIRED' && (
          <div style={{ marginTop: '12px', padding: '14px 16px', background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>Handshake expired</div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>This relationship has expired.</div>
          </div>
        )}
      </div>

      {/* ── Content sections ── */}
      <div style={{ padding: '16px 20px', minWidth: 0 }}>
        {isActiveOrAccepted && (
          <>
            {/* Context Graph — collapsible, filter chips in header (stacked for full visibility) */}
            <div style={{
              marginBottom: '16px',
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px',
              overflow: 'hidden',
            }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setContextGraphExpanded(!contextGraphExpanded)}
                onKeyDown={(e) => e.key === 'Enter' && setContextGraphExpanded(!contextGraphExpanded)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  background: 'rgba(255,255,255,0.02)',
                  border: 'none',
                  width: '100%',
                  minWidth: 0,
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <span style={{ fontSize: '18px', flexShrink: 0 }}>📦</span>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text, #e2e8f0)' }}>Context Graph</span>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>({filteredBlocks.length})</span>
                    {record.state === 'ACCEPTED' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAttachData() }}
                        disabled={!vaultUnlocked}
                        title={!vaultUnlocked ? 'Unlock vault to attach context data' : 'Attach context data'}
                        style={{
                          padding: '4px 10px', fontSize: '10px', fontWeight: 600,
                          background: 'rgba(139,92,246,0.2)', color: '#a78bfa',
                          border: '1px solid rgba(139,92,246,0.4)', borderRadius: '6px', cursor: 'pointer',
                        }}
                      >
                        Attach
                      </button>
                    )}
                  </div>
                  <span style={{
                    flexShrink: 0, fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)',
                    transform: contextGraphExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s',
                  }}>
                    ▼
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 8px', alignItems: 'center' }}>
                  {['All', 'Public', 'Private'].map((f) => (
                    <InlineFilterChip
                      key={f}
                      label={f}
                      active={filter.visibility === f.toLowerCase()}
                      disabled={f === 'Private' && !vaultUnlocked}
                      onClick={() => setFilter(prev => ({ ...prev, visibility: f.toLowerCase() as any }))}
                    />
                  ))}
                  <span style={{ color: 'var(--color-border, rgba(255,255,255,0.15))', margin: '0 2px', flexShrink: 0 }}>·</span>
                  {['All', 'Sent', 'Received'].map((f) => (
                    <InlineFilterChip
                      key={f}
                      label={f}
                      active={filter.direction === f.toLowerCase()}
                      onClick={() => setFilter(prev => ({ ...prev, direction: f.toLowerCase() as any }))}
                    />
                  ))}
                  {blocks.length > 5 && (
                    <>
                      <span style={{ color: 'var(--color-border, rgba(255,255,255,0.15))', margin: '0 2px', flexShrink: 0 }}>·</span>
                      <InlineFilterChip label="All Types" active={filter.type === 'all'} onClick={() => setFilter(prev => ({ ...prev, type: 'all' }))} />
                      <InlineFilterChip label="Structured" active={filter.type === 'structured'} onClick={() => setFilter(prev => ({ ...prev, type: 'structured' }))} />
                      <InlineFilterChip label="Unstructured" active={filter.type === 'unstructured'} onClick={() => setFilter(prev => ({ ...prev, type: 'unstructured' }))} />
                    </>
                  )}
                </div>
              </div>
              {contextGraphExpanded && (
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.06))' }}>
                  {loading ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>Loading…</div>
                  ) : filteredBlocks.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>No blocks match the current filters.</div>
                  ) : (
                    <>
                      {hsContextBlocks.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
                            Business Context
                          </div>
                          <StructuredHsContextPanel
                            blocks={hsContextBlocks}
                            handshakeId={record.handshake_id}
                            vaultUnlocked={vaultUnlocked}
                            onVisibilityChange={(b) => {
                              const block = blocks.find((x) => x.block_id === b.block_id)
                              if (block) handleToggleVisibility(block)
                            }}
                            onDocumentSelect={onDocumentSelect}
                            senderWrdeskUserId={hsContextBlocks[0]?.sender_wrdesk_user_id}
                          />
                        </div>
                      )}
                      {genericBlocks.length > 0 && (
                        <div>
                          {hsContextBlocks.length > 0 && (
                            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
                              Other Context
                            </div>
                          )}
                          {genericBlocks.map((block) => (
                            <BlockCard
                              key={`${block.block_id}-${block.block_hash}`}
                              block={block}
                              vaultUnlocked={vaultUnlocked}
                              handshakeId={record.handshake_id}
                              onVisibilityChange={() => handleToggleVisibility(block)}
                            />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* BEAP Messages — always open, non-collapsible */}
            <div style={{
              marginBottom: '16px',
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.02)',
                borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.06))',
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', minWidth: 0,
              }}>
                <span style={{ fontSize: '18px' }}>📨</span>
                <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--color-text, #e2e8f0)' }}>BEAP Messages</span>
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>({beapMessages.length})</span>
              </div>
              <div style={{ padding: '12px 16px' }}>
                {beapMessages.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '13px' }}>
                    No messages in this relationship yet.
                  </div>
                ) : (
                  <>
                    {visibleBeapMessages.map((msg: any, i: number) => (
                      <div key={msg?.id ?? i} style={{
                        padding: '12px', marginBottom: '8px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
                            {msg?.date ?? '—'} · {msg?.time ?? '—'}
                          </span>
                          <span style={{ fontSize: '10px', fontWeight: 600, color: msg?.direction === 'incoming' ? '#a78bfa' : '#22c55e' }}>
                            {msg?.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
                          </span>
                        </div>
                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{msg?.title ?? 'Message'}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>{msg?.body ?? ''}</div>
                      </div>
                    ))}
                    {!showAllBeapMessages && beapMessages.length > INITIAL_MESSAGE_COUNT && (
                      <button
                        type="button"
                        onClick={() => setShowAllBeapMessages(true)}
                        style={{
                          width: '100%', padding: '12px', textAlign: 'center', fontSize: '13px',
                          color: '#a78bfa', backgroundColor: 'transparent',
                          border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px',
                          cursor: 'pointer', marginTop: '8px',
                        }}
                      >
                        Show {beapMessages.length - INITIAL_MESSAGE_COUNT} more messages
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Summary Bar (sticky bottom) ── */}
      <div style={{
        padding: '10px 20px', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)',
        position: 'sticky', bottom: 0, background: 'var(--color-bg, #0f172a)',
      }}>
        {isActiveOrAccepted ? (
          vaultUnlocked ? (
            <>
              {blocks.length} Context Item{blocks.length !== 1 ? 's' : ''}
              {' · '}{publicCount} Public · {privateCount} Private
              {' · '}0 Messages
              {' · '}{structuredCount} Structured · {unstructuredCount} Unstructured
              {' · '}{sentCount} Sent · {receivedCount} Received
            </>
          ) : (
            <>
              {publicCount} Context Item{publicCount !== 1 ? 's' : ''} (public)
              {privateCount > 0 ? ` · 🔒 ${privateCount} private block${privateCount !== 1 ? 's' : ''} hidden` : ' · 🔒 Unlock to view private blocks'}
              {' · '}0 Messages
            </>
          )
        ) : (
          <span>Select an active handshake to see summary</span>
        )}
      </div>

      {/* ── Technical Details modal ── */}
      {cryptoModalOpen && (
        <div
          ref={cryptoModalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="crypto-modal-title"
          onClick={(e) => e.target === e.currentTarget && setCryptoModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setCryptoModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: 480, maxHeight: '85vh', overflowY: 'auto',
              background: 'var(--color-bg, #0f172a)', color: 'var(--color-text, #e2e8f0)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
              borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              padding: '16px 20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 id="crypto-modal-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Technical Details</h3>
              <button
                onClick={() => setCryptoModalOpen(false)}
                style={{
                  padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                  background: 'var(--color-input-bg, rgba(255,255,255,0.08))',
                  color: 'var(--color-text, #e2e8f0)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                  borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <CryptoDetailsContent record={record} contextBlocks={blocks} />
          </div>
        </div>
      )}

      {/* ── Policies modal ── */}
      {policyModalOpen && (
        <div
          ref={policyModalRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="policy-modal-title"
          onClick={(e) => e.target === e.currentTarget && setPolicyModalOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setPolicyModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)', padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: 420, maxHeight: '85vh', overflowY: 'auto',
              background: 'var(--color-bg, #0f172a)', color: 'var(--color-text, #e2e8f0)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.15))',
              borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              padding: '16px 20px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 id="policy-modal-title" style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Policies</h3>
              <button
                onClick={() => setPolicyModalOpen(false)}
                style={{
                  padding: '4px 10px', fontSize: '11px', fontWeight: 600,
                  background: 'var(--color-input-bg, rgba(255,255,255,0.08))',
                  color: 'var(--color-text, #e2e8f0)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.2))',
                  borderRadius: '6px', cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <PolicyRadioGroup value={policies} onChange={handlePolicyChange} readOnly={record.state === 'ACTIVE'} />
          </div>
        </div>
      )}
    </div>
  )
}
