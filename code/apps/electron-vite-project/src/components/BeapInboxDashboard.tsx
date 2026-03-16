/**
 * BeapInboxDashboard — Inline inbox view for Electron dashboard.
 *
 * 3-column layout matching HandshakeView:
 *   Left 280px:  Message list (BeapInboxSidebar)
 *   Center 1fr:  Detail panel or "Select a message" or Draft composer
 *   Right 320px: Import zone when no message selected
 *
 * Same header bar, HybridSearch with pointing finger when message selected.
 * [+] compose button for new BEAP messages.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { BeapInboxSidebar } from '@ext/beap-messages/components/BeapInboxSidebar'
import { BeapMessageDetailPanel } from '@ext/beap-messages/components/BeapMessageDetailPanel'
import type { BeapMessageDetailPanelHandle } from '@ext/beap-messages/components/BeapMessageDetailPanel'
import { BeapDraftComposer } from '@ext/beap-messages/components/BeapDraftComposer'
import { useBeapInboxStore } from '@ext/beap-messages/useBeapInboxStore'
import BeapMessageUploadZone from './BeapMessageUploadZone'

const THEME = 'professional' as const

interface BeapInboxDashboardProps {
  onMessageSelect: (messageId: string | null) => void
  onSetSearchContext: (context: string) => void
  /** Switch to Handshakes tab with this handshake selected */
  onNavigateToHandshake?: (handshakeId: string) => void
  /** When navigating from Bulk Inbox, pre-select this message */
  selectedMessageId?: string | null
}

export default function BeapInboxDashboard({
  onMessageSelect,
  onSetSearchContext,
  onNavigateToHandshake,
  selectedMessageId: selectedMessageIdProp,
}: BeapInboxDashboardProps) {
  const [showCompose, setShowCompose] = useState(false)

  const storeSelectedId = useBeapInboxStore((s) => s.selectedMessageId)
  const selectMessage = useBeapInboxStore((s) => s.selectMessage)
  const detailPanelRef = useRef<BeapMessageDetailPanelHandle>(null)

  // When navigating from Bulk Inbox, sync prop to store
  useEffect(() => {
    if (selectedMessageIdProp) selectMessage(selectedMessageIdProp)
  }, [selectedMessageIdProp, selectMessage])

  // Sync store selection to App (for HybridSearch pointing finger)
  useEffect(() => {
    onMessageSelect(storeSelectedId)
  }, [storeSelectedId, onMessageSelect])

  // Clear compose when a message is selected
  useEffect(() => {
    if (storeSelectedId) setShowCompose(false)
  }, [storeSelectedId])

  const handleViewHandshake = useCallback(
    (handshakeId: string) => {
      onNavigateToHandshake?.(handshakeId)
    },
    [onNavigateToHandshake],
  )

  const handleNavigateToDraft = useCallback(() => {
    setShowCompose(true)
  }, [])

  const handleDraftNotification = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    console.log('[BeapInboxDashboard]', type, msg)
  }, [])

  const gridCols = storeSelectedId || showCompose ? '280px 1fr' : '280px 1fr 320px'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: gridCols,
      height: '100%', overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* ── Left Panel: Message list ── */}
      <div style={{
        borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 12px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>Inbox</span>
          <button
            onClick={handleNavigateToDraft}
            style={{
              padding: '4px 8px', fontSize: '10px', fontWeight: 600,
              background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
              border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
              borderRadius: '5px', color: 'var(--color-accent, #a78bfa)',
              cursor: 'pointer',
            }}
          >
            + Compose
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <BeapInboxSidebar
            theme={THEME}
            onNavigateToDraft={handleNavigateToDraft}
            onNavigateToHandshake={handleViewHandshake}
          />
        </div>
      </div>

      {/* ── Center: Detail or Compose or Placeholder ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
        position: 'relative', minWidth: 320, minHeight: 0,
      }}>
        {showCompose ? (
          <BeapDraftComposer
            theme={THEME}
            onNotification={handleDraftNotification}
          />
        ) : storeSelectedId ? (
          <BeapMessageDetailPanel
            ref={detailPanelRef}
            theme={THEME}
            onSetSearchContext={onSetSearchContext}
            onViewHandshake={handleViewHandshake}
          />
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted, #94a3b8)',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>✉️</div>
            <div style={{ fontSize: '13px' }}>Select a message to view details</div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Import zone (when no selection) ── */}
      {!storeSelectedId && !showCompose && (
        <div style={{
          borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 12px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            fontSize: '13px', fontWeight: 700,
          }}>
            Import
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            <BeapMessageUploadZone />
          </div>
        </div>
      )}
    </div>
  )
}
