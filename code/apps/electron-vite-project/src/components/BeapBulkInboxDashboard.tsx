/**
 * BeapBulkInboxDashboard — Bulk inbox grid view for Electron dashboard.
 *
 * Full-width layout matching extension's BeapBulkInbox.
 * Same header bar, HybridSearch with pointing finger when message focused.
 */

import { BeapBulkInbox } from '@ext/beap-messages/components/BeapBulkInbox'

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
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      <BeapBulkInbox
        theme={THEME}
        onSetSearchContext={onSetSearchContext}
        onViewHandshake={onNavigateToHandshake}
        onViewInInbox={onViewInInbox}
      />
    </div>
  )
}
