/**
 * HandshakeQuickReview — Fullscreen overview of context blocks
 *
 * Shows all blocks grouped by visibility, direction, and type.
 * Filter bar, block cards with visibility toggle, BEAP Messages placeholder.
 */

import { useEffect, useState, useCallback } from 'react'

// ── Types ──

export interface ContextBlockWithVisibility {
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
  governance_json?: string
  created_at?: string
}

interface QuickReviewFilter {
  visibility: 'all' | 'public' | 'private'
  direction: 'all' | 'sent' | 'received'
  type: 'all' | 'structured' | 'unstructured'
  search: string
}

interface DataSectionProps {
  title: string
  icon: string
  count: number
  enabled: boolean
  defaultExpanded?: boolean
  children: React.ReactNode
}

// ── Helpers ──

function isBlockStructured(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
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
          if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
            return `${k}: ${JSON.stringify(v)}`
          }
          return `${k}: ${String(v)}`
        })
        .join(', ')
    }
    return payload
  } catch {
    return payload
  }
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

function matchesSearch(block: ContextBlockWithVisibility, search: string): boolean {
  if (!search.trim()) return true
  const q = search.toLowerCase()
  return (
    block.block_id.toLowerCase().includes(q) ||
    block.parsedContent.toLowerCase().includes(q) ||
    block.type.toLowerCase().includes(q)
  )
}

// ── DataSection ──

function DataSection({ title, icon, count, enabled, defaultExpanded = true, children }: DataSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!enabled) {
    return (
      <div style={{
        marginBottom: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px',
        overflow: 'hidden',
      }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 16px', background: 'rgba(255,255,255,0.02)',
            border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted, #94a3b8)', fontSize: '13px', fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '18px' }}>{icon}</span>
          <span>{title}</span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.7 }}>Coming soon</span>
          <span style={{ fontSize: '10px' }}>{expanded ? '▾' : '▸'}</span>
        </button>
        {expanded && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      marginBottom: '16px',
      background: 'var(--color-surface, rgba(255,255,255,0.03))',
      border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px 16px', background: 'rgba(255,255,255,0.02)',
          border: 'none', cursor: 'pointer',
          color: 'var(--color-text, #e2e8f0)', fontSize: '13px', fontWeight: 600,
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '18px' }}>{icon}</span>
        <span>{title}</span>
        <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', fontWeight: 400 }}>
          ({count})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '10px' }}>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{ padding: '0 16px 12px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── BlockCard ──

function BlockCard({
  block,
  vaultUnlocked,
  onVisibilityChange,
}: {
  block: ContextBlockWithVisibility
  vaultUnlocked: boolean
  onVisibilityChange: () => void
}) {
  const isPrivate = block.visibility === 'private'
  const contentHidden = isPrivate && !vaultUnlocked
  const canToggle = vaultUnlocked

  return (
    <div style={{
      width: '100%', margin: '0 0 12px', padding: '16px',
      background: block.source === 'received' ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.04)',
      border: block.source === 'received' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: '14px', flexShrink: 0 }}>
            {isPrivate ? '🔒' : '🟢'}
          </span>
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
      <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>
        {block.source === 'sent' ? 'Sent' : 'Received'} · {block.block_id}
      </div>
      {contentHidden ? (
        <div style={{ color: 'var(--color-text-muted, #94a3b8)', fontStyle: 'italic', fontSize: '12px' }}>
          🔒 Vault locked – unlock to view content
        </div>
      ) : (
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary, #94a3b8)', lineHeight: 1.5 }}>
          {block.parsedContent.substring(0, 150)}
          {block.parsedContent.length > 150 && '...'}
        </div>
      )}
    </div>
  )
}

// ── FilterChip ──

function FilterChip({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 14px', fontSize: '13px', fontWeight: active ? 600 : 500,
        background: active ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.04)'}`,
        borderRadius: '5px',
        color: active ? '#a78bfa' : (disabled ? 'var(--color-text-muted, #64748b)' : 'var(--color-text-muted, #94a3b8)'),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  )
}

// ── Main Component ──

interface HandshakeQuickReviewProps {
  handshakeId: string
  handshakeEmail: string
  vaultUnlocked: boolean
  onClose: () => void
}

export default function HandshakeQuickReview({
  handshakeId,
  handshakeEmail,
  vaultUnlocked,
  onClose,
}: HandshakeQuickReviewProps) {
  const [blocks, setBlocks] = useState<ContextBlockWithVisibility[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<QuickReviewFilter>({
    visibility: 'all',
    direction: 'all',
    type: 'all',
    search: '',
  })

  const loadBlocks = useCallback(async () => {
    setLoading(true)
    try {
      const qcb = window.handshakeView?.queryContextBlocks
      const raw = typeof qcb === 'function' ? await qcb(handshakeId) : []
      const arr = Array.isArray(raw) ? raw : []
      const mapped: ContextBlockWithVisibility[] = arr.map((b: any) => {
        const payload = b?.payload_ref ?? b?.payload ?? ''
        const isStructured = isBlockStructured(payload)
        const parsedContent = extractTextFromPayload(payload)
        return {
          sender_wrdesk_user_id: b?.sender_wrdesk_user_id ?? '',
          block_id: b?.block_id ?? '',
          block_hash: b?.block_hash ?? '',
          handshake_id: b?.handshake_id ?? handshakeId,
          relationship_id: b?.relationship_id ?? '',
          type: b?.type ?? 'text',
          data_classification: b?.data_classification ?? 'public',
          visibility: (b?.visibility ?? 'public') as 'public' | 'private',
          source: b?.source ?? 'received',
          payload,
          parsedContent,
          isStructured,
          governance_json: b?.governance_json,
          created_at: b?.created_at,
        }
      })
      setBlocks(mapped)
    } catch {
      setBlocks([])
    } finally {
      setLoading(false)
    }
  }, [handshakeId])

  useEffect(() => {
    let mounted = true
    const run = async () => {
      setLoading(true)
      try {
        const qcb = window.handshakeView?.queryContextBlocks
        const raw = typeof qcb === 'function' ? await qcb(handshakeId) : []
        if (!mounted) return
        const arr = Array.isArray(raw) ? raw : []
        const mapped: ContextBlockWithVisibility[] = arr.map((b: any) => {
          const payload = b?.payload_ref ?? b?.payload ?? ''
          return {
            sender_wrdesk_user_id: b?.sender_wrdesk_user_id ?? '',
            block_id: b?.block_id ?? '',
            block_hash: b?.block_hash ?? '',
            handshake_id: b?.handshake_id ?? handshakeId,
            relationship_id: b?.relationship_id ?? '',
            type: b?.type ?? 'text',
            data_classification: b?.data_classification ?? 'public',
            visibility: (b?.visibility ?? 'public') as 'public' | 'private',
            source: b?.source ?? 'received',
            payload,
            parsedContent: extractTextFromPayload(payload),
            isStructured: isBlockStructured(payload),
            governance_json: b?.governance_json,
            created_at: b?.created_at,
          }
        })
        setBlocks(mapped)
      } catch {
        if (mounted) setBlocks([])
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [handshakeId])

  const filteredBlocks = blocks.filter((b) => {
    if (filter.visibility !== 'all' && b.visibility !== filter.visibility) return false
    if (filter.direction !== 'all' && b.source !== filter.direction) return false
    if (filter.type === 'structured' && !b.isStructured) return false
    if (filter.type === 'unstructured' && b.isStructured) return false
    if (!matchesSearch(b, filter.search)) return false
    return true
  })

  const loadBlocksSafe = useCallback(async () => {
    const qcb = window.handshakeView?.queryContextBlocks
    if (typeof qcb !== 'function') return
    try {
      const raw = await qcb(handshakeId)
      const arr = Array.isArray(raw) ? raw : []
      const mapped: ContextBlockWithVisibility[] = arr.map((b: any) => {
        const payload = b?.payload_ref ?? b?.payload ?? ''
        return {
          sender_wrdesk_user_id: b?.sender_wrdesk_user_id ?? '',
          block_id: b?.block_id ?? '',
          block_hash: b?.block_hash ?? '',
          handshake_id: b?.handshake_id ?? handshakeId,
          relationship_id: b?.relationship_id ?? '',
          type: b?.type ?? 'text',
          data_classification: b?.data_classification ?? 'public',
          visibility: (b?.visibility ?? 'public') as 'public' | 'private',
          source: b?.source ?? 'received',
          payload,
          parsedContent: extractTextFromPayload(payload),
          isStructured: isBlockStructured(payload),
          governance_json: b?.governance_json,
          created_at: b?.created_at,
        }
      })
      setBlocks(mapped)
    } catch { /* ignore */ }
  }, [handshakeId])

  const handleToggleVisibility = async (block: ContextBlockWithVisibility) => {
    const setVis = window.handshakeView?.setBlockVisibility
    if (typeof setVis !== 'function') return
    const newVis = block.visibility === 'public' ? 'private' : 'public'
    const result = await setVis({
      sender_wrdesk_user_id: block.sender_wrdesk_user_id,
      block_id: block.block_id,
      block_hash: block.block_hash,
      visibility: newVis,
    })
    if (result?.success) loadBlocksSafe()
  }

  const publicCount = blocks.filter(b => b.visibility === 'public').length
  const privateCount = blocks.filter(b => b.visibility === 'private').length
  const structuredCount = blocks.filter(b => b.isStructured).length
  const unstructuredCount = blocks.filter(b => !b.isStructured).length
  const sentCount = blocks.filter(b => b.source === 'sent').length
  const receivedCount = blocks.filter(b => b.source === 'received').length

  return (
    <div style={{
      flex: 1, width: '100%', minWidth: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={() => typeof onClose === 'function' && onClose()}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', fontSize: '14px', fontWeight: 500,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            ← Back to Overview
          </button>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', height: '24px' }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)' }}>
              Quick Review
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', marginTop: '2px' }}>
              {handshakeEmail}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{
        padding: '12px 24px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', flexDirection: 'column', gap: '12px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <FilterChip label="All" active={filter.visibility === 'all'} onClick={() => setFilter(f => ({ ...f, visibility: 'all' }))} />
            <FilterChip label="Public" active={filter.visibility === 'public'} onClick={() => setFilter(f => ({ ...f, visibility: 'public' }))} />
            <FilterChip label="Private" active={filter.visibility === 'private'} onClick={() => setFilter(f => ({ ...f, visibility: 'private' }))} disabled={!vaultUnlocked} />
          </div>
          <span style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <FilterChip label="All" active={filter.direction === 'all'} onClick={() => setFilter(f => ({ ...f, direction: 'all' }))} />
            <FilterChip label="Sent" active={filter.direction === 'sent'} onClick={() => setFilter(f => ({ ...f, direction: 'sent' }))} />
            <FilterChip label="Received" active={filter.direction === 'received'} onClick={() => setFilter(f => ({ ...f, direction: 'received' }))} />
          </div>
          <span style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <FilterChip label="All Types" active={filter.type === 'all'} onClick={() => setFilter(f => ({ ...f, type: 'all' }))} />
            <FilterChip label="Structured" active={filter.type === 'structured'} onClick={() => setFilter(f => ({ ...f, type: 'structured' }))} />
            <FilterChip label="Unstructured" active={filter.type === 'unstructured'} onClick={() => setFilter(f => ({ ...f, type: 'unstructured' }))} />
          </div>
        </div>
        <input
          type="text"
          placeholder="🔍 Search blocks..."
          value={filter.search}
          onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
          style={{
            width: '100%', padding: '10px 16px', fontSize: '14px',
            background: 'rgba(255,255,255,0.06)', color: 'var(--color-text, #e2e8f0)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
          }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
        <DataSection title="Context Blocks" icon="📦" count={filteredBlocks.length} enabled={true} defaultExpanded={true}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>
              Loading…
            </div>
          ) : filteredBlocks.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '12px' }}>
              No blocks match the current filters.
            </div>
          ) : (
            filteredBlocks.map((block) => (
              <BlockCard
                key={`${block.block_id}-${block.block_hash}`}
                block={block}
                vaultUnlocked={vaultUnlocked}
                onVisibilityChange={() => handleToggleVisibility(block)}
              />
            ))
          )}
        </DataSection>

        <DataSection title="BEAP Messages" icon="📨" count={0} enabled={false} defaultExpanded={false}>
          BEAP message history will appear here in a future update.
        </DataSection>
      </div>

      {/* Summary Bar */}
      <div style={{
        padding: '10px 20px',
        borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)',
        flexShrink: 0,
      }}>
        {vaultUnlocked ? (
          <>
            {blocks.length} Block{blocks.length !== 1 ? 's' : ''}
            {' · '}{publicCount} Public · {privateCount} Private
            {' · '}{structuredCount} Structured · {unstructuredCount} Unstructured
            {' · '}{sentCount} Sent · {receivedCount} Received
          </>
        ) : (
          <>
            {publicCount} Block{publicCount !== 1 ? 's' : ''} (public)
            {privateCount > 0 ? ` · 🔒 ${privateCount} private block${privateCount !== 1 ? 's' : ''} hidden` : ' · 🔒 Unlock to view private blocks'}
            {' · '}{structuredCount} Structured · {unstructuredCount} Unstructured
          </>
        )}
      </div>
    </div>
  )
}
