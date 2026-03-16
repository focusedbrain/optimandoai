/**
 * BeapBulkInboxDashboard — Bulk inbox grid view for Electron dashboard.
 *
 * Full-width layout matching extension's BeapBulkInbox.
 * Compose buttons [+] BEAP and [✉+] Email at bottom-right.
 */

import { useState } from 'react'
import { BeapBulkInbox } from '@ext/beap-messages/components/BeapBulkInbox'
import { BeapDraftComposer } from '@ext/beap-messages/components/BeapDraftComposer'
import ComposeButtons from './ComposeButtons'
import EmailComposeOverlay from './EmailComposeOverlay'

const THEME = 'professional' as const

interface BeapBulkInboxDashboardProps {
  onMessageSelect?: (messageId: string | null) => void
  onSetSearchContext?: (context: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  onViewInInbox?: (messageId: string) => void
}

export default function BeapBulkInboxDashboard({
  onSetSearchContext,
  onNavigateToHandshake,
  onViewInInbox,
}: BeapBulkInboxDashboardProps) {
  const [showComposeOverlay, setShowComposeOverlay] = useState<'beap' | 'email' | null>(null)

  return (
    <div style={{
      position: 'relative',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>Bulk Inbox</span>
      </div>

      {showComposeOverlay === 'beap' ? (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '13px', fontWeight: 700 }}>Compose</span>
            <button
              onClick={() => setShowComposeOverlay(null)}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 600,
                background: 'transparent',
                border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                borderRadius: 6,
                color: 'var(--color-text-muted, #94a3b8)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <BeapDraftComposer
              theme={THEME}
              onNotification={(msg, type) => {
                if (type === 'success' && msg.toLowerCase().includes('sent')) {
                  setShowComposeOverlay(null)
                }
              }}
            />
          </div>
        </div>
      ) : showComposeOverlay === 'email' ? (
        <EmailComposeOverlay
          theme={THEME}
          onClose={() => setShowComposeOverlay(null)}
          onSent={() => setShowComposeOverlay(null)}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <BeapBulkInbox
            theme={THEME}
            onSetSearchContext={onSetSearchContext}
            onViewHandshake={onNavigateToHandshake}
            onViewInInbox={onViewInInbox}
          />
        </div>
      )}

      {/* Compose buttons — bottom-right */}
      <ComposeButtons
        onBeapClick={() => setShowComposeOverlay('beap')}
        onEmailClick={() => setShowComposeOverlay('email')}
      />
    </div>
  )
}
