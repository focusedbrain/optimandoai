/**
 * Collapsible panel — Edge Ingestor + connected email accounts share one section.
 */

import { useEffect, useState, type ReactNode } from 'react'
import {
  EmailProvidersSection,
  type EmailProvidersSectionProps,
} from '@ext/wrguard/components/EmailProvidersSection'
import { WRDESK_EXPAND_EMAIL_ACCOUNTS_SECTION } from '../lib/wrdeskUiEvents.js'
import { ACCOUNTS_AND_EDGE_COLLAPSIBLE_TITLE } from './edge-ingestor/edgeIngestorCopy.js'
import { EdgeIngestorPanelContent } from './edge-ingestor/EdgeIngestorPanelContent.js'

const MUTED = '#64748b'

export interface EmailAccountsAndEdgeIngestorPanelProps extends EmailProvidersSectionProps {
  /** Controlled expand state; defaults to collapsed. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** Extra footer below email accounts (e.g. inbox sync window). */
  footer?: ReactNode
  testId?: string
}

export function EmailAccountsAndEdgeIngestorPanel({
  expanded: expandedProp,
  onExpandedChange,
  footer,
  testId = 'email-accounts-edge-panel',
  emailAccounts,
  ...emailProps
}: EmailAccountsAndEdgeIngestorPanelProps) {
  const [expandedInternal, setExpandedInternal] = useState(false)
  const [edgeReplicaCount, setEdgeReplicaCount] = useState(0)

  const expanded = expandedProp ?? expandedInternal
  const setExpanded = onExpandedChange ?? setExpandedInternal

  useEffect(() => {
    const expand = () => setExpanded(true)
    window.addEventListener(WRDESK_EXPAND_EMAIL_ACCOUNTS_SECTION, expand)
    return () => window.removeEventListener(WRDESK_EXPAND_EMAIL_ACCOUNTS_SECTION, expand)
  }, [setExpanded])

  const emailCount = emailAccounts.length
  const summaryParts: string[] = []
  if (emailCount > 0) summaryParts.push(`${emailCount} email`)
  if (edgeReplicaCount > 0) summaryParts.push(`${edgeReplicaCount} edge`)

  return (
    <div
      className={`bulk-view-provider-section inbox-accounts-edge-panel ${expanded ? 'bulk-view-provider-section--expanded' : ''}`}
      data-testid={testId}
    >
      <button
        type="button"
        className="bulk-view-provider-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span style={{ fontSize: 14 }}>🔗</span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{ACCOUNTS_AND_EDGE_COLLAPSIBLE_TITLE}</span>
        {summaryParts.length > 0 ? (
          <span style={{ fontSize: 11, color: MUTED }}>({summaryParts.join(', ')})</span>
        ) : null}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </button>
      {expanded ? (
        <div className="bulk-view-provider-body inbox-provider-section" data-testid="email-accounts-settings-section">
          <div style={{ padding: '12px 16px 0' }}>
            <EdgeIngestorPanelContent onReplicaCountChange={setEdgeReplicaCount} />
          </div>
          <EmailProvidersSection {...emailProps} emailAccounts={emailAccounts} embedded />
          {footer}
        </div>
      ) : null}
    </div>
  )
}
