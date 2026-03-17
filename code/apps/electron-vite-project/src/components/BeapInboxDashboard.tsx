/**
 * BeapInboxDashboard — Inline inbox view for Electron dashboard.
 *
 * 3-column layout matching HandshakeView:
 *   gridTemplateColumns: selectedMessageId ? '280px 1fr' : '280px 1fr 320px'
 *
 * Left 280px:  Message list (useBeapInboxStore.getInboxMessages)
 * Center 1fr:  Detail panel or "Select a message" placeholder
 * Right 320px: Import zone + [+] Compose (only when no selection)
 */

import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { BeapMessageDetailPanel } from '@ext/beap-messages/components/BeapMessageDetailPanel'
import { createBeapReplyAiProvider } from '@ext/beap-messages/services/beapReplyAiProvider'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import type { BeapMessageDetailPanelHandle } from '@ext/beap-messages/components/BeapMessageDetailPanel'
import { EmailConnectWizard } from '@ext/shared/components/EmailConnectWizard'
import { useBeapInboxStore } from '@ext/beap-messages/useBeapInboxStore'
import type { BeapMessage, UrgencyLevel, TrustLevel } from '@ext/beap-messages/beapInboxTypes'
import { usePendingP2PBeapIngestion } from '@ext/handshake/usePendingP2PBeapIngestion'
import BeapMessageImportZone from './BeapMessageImportZone'

const THEME = 'professional' as const

const URGENCY_DOT: Record<UrgencyLevel, { color: string } | null> = {
  urgent: { color: '#ef4444' },
  'action-required': { color: '#f59e0b' },
  normal: null,
  irrelevant: { color: '#6b7280' },
}

const TRUST_BADGE: Record<TrustLevel, { label: string; color: string; bg: string }> = {
  enterprise: { label: 'Enterprise', color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  pro: { label: 'Pro', color: '#2563eb', bg: 'rgba(59,130,246,0.15)' },
  standard: { label: 'Standard', color: '#16a34a', bg: 'rgba(34,197,94,0.15)' },
  depackaged: { label: 'Email', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: timestamp < Date.now() - 365 * 86_400_000 ? 'numeric' : undefined,
  })
}

function getContentPreview(msg: BeapMessage): string {
  const text = msg.canonicalContent || msg.messageBody || ''
  return text.length > 80 ? text.slice(0, 80).trimEnd() + '…' : text
}

interface BeapInboxDashboardProps {
  selectedMessageId: string | null
  onMessageSelect: (messageId: string | null) => void
  /** Called when user selects/deselects an attachment. Parent can update search bar scope. */
  onAttachmentSelect?: (messageId: string, attachmentId: string | null) => void
  onSetSearchContext?: (context: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
}

export default function BeapInboxDashboard({
  selectedMessageId: selectedMessageIdProp,
  onMessageSelect,
  onAttachmentSelect,
  onSetSearchContext,
  onNavigateToHandshake,
}: BeapInboxDashboardProps) {
  usePendingP2PBeapIngestion()

  const getInboxMessages = useBeapInboxStore((s) => s.getInboxMessages)
  const storeSelectedId = useBeapInboxStore((s) => s.selectedMessageId)
  const selectMessage = useBeapInboxStore((s) => s.selectMessage)
  const detailPanelRef = useRef<BeapMessageDetailPanelHandle>(null)
  const composeClickRef = useRef<number>(0)

  const messages = getInboxMessages()

  // Debounce compose button clicks to prevent multiple popups from double-clicks
  const handleComposeClick = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - composeClickRef.current < 600) return
    composeClickRef.current = now
    fn()
  }, [])

  // Connected Email Accounts (for center panel empty state)
  const [emailAccounts, setEmailAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: 'gmail' | 'microsoft365' | 'imap'; status: 'active' | 'error' | 'disabled'; lastError?: string }>>([])
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(true)
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  const [showEmailConnectModal, setShowEmailConnectModal] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  const notify = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadEmailAccounts = useCallback(async () => {
    if (typeof (window as any).emailAccounts?.listAccounts !== 'function') {
      setIsLoadingEmailAccounts(false)
      return
    }
    try {
      const res = await (window as any).emailAccounts!.listAccounts()
      if (res?.ok && res?.data) {
        setEmailAccounts(res.data)
        setSelectedEmailAccountId((prev) => (prev && res.data.some((a: { id: string }) => a.id === prev)) ? prev : (res.data[0]?.id ?? null))
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }, [])

  useEffect(() => {
    loadEmailAccounts()
  }, [loadEmailAccounts])

  useEffect(() => {
    const unsub = (window as any).emailAccounts?.onAccountConnected?.(() => loadEmailAccounts())
    return () => unsub?.()
  }, [loadEmailAccounts])

  const handleConnectEmail = useCallback(() => {
    setShowEmailConnectModal(true)
  }, [])

  const handleDisconnectEmail = useCallback(async (id: string) => {
    try {
      if (typeof (window as any).emailAccounts?.deleteAccount === 'function') {
        await (window as any).emailAccounts!.deleteAccount(id)
        loadEmailAccounts()
        notify('Email account disconnected', 'info')
      }
    } catch {
      notify('Failed to disconnect account', 'error')
    }
  }, [loadEmailAccounts, notify])
  const effectiveSelectedId = storeSelectedId ?? selectedMessageIdProp

  // Sync prop to store (e.g. when navigating from Bulk Inbox)
  useEffect(() => {
    if (selectedMessageIdProp) selectMessage(selectedMessageIdProp)
  }, [selectedMessageIdProp, selectMessage])

  // Sync store selection to App (for HybridSearch)
  useEffect(() => {
    onMessageSelect(storeSelectedId)
  }, [storeSelectedId, onMessageSelect])

  const handleSelect = useCallback(
    (id: string) => {
      const next = storeSelectedId === id ? null : id
      selectMessage(next)
      onMessageSelect(next)
    },
    [storeSelectedId, selectMessage, onMessageSelect],
  )

  const handleViewHandshake = useCallback(
    (handshakeId: string) => onNavigateToHandshake?.(handshakeId),
    [onNavigateToHandshake],
  )

  const replyComposerConfig = useMemo(() => {
    const generate = async (prompt: string): Promise<string> => {
      const fn = (window as any).handshakeView?.generateDraft
      if (typeof fn !== 'function') throw new Error('Draft generation not available')
      const result = await fn(prompt)
      if (!result?.success) throw new Error(result?.error ?? 'Draft generation failed')
      return result?.answer ?? ''
    }
    return {
      senderFingerprint: '',
      senderFingerprintShort: '',
      aiProvider: createBeapReplyAiProvider(generate),
      policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
    }
  }, [])

  const gridCols = effectiveSelectedId ? '280px 1fr' : '280px 1fr 320px'

  return (
    <div style={{
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: gridCols,
      height: '100%',
      overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* ── Left Column (280px) ── */}
      <div style={{
        borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 12px',
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>Inbox</span>
          <span style={{
            fontSize: '11px',
            padding: '2px 7px',
            borderRadius: '10px',
            background: 'rgba(139,92,246,0.2)',
            color: '#a78bfa',
            fontWeight: 500,
          }}>
            {messages.length}
          </span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {messages.length === 0 ? (
            <div style={{
              padding: '28px 16px',
              textAlign: 'center',
              color: 'var(--color-text-muted, #94a3b8)',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.4 }}>✉️</div>
              <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
                No BEAP messages yet.
                <br />
                Import a <strong>.beap</strong> file or wait for incoming messages.
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isSelected = effectiveSelectedId === msg.messageId
              const urgencyConfig = URGENCY_DOT[msg.urgency]
              const trustConfig = TRUST_BADGE[msg.trustLevel]
              const preview = getContentPreview(msg)
              const senderLabel = msg.senderDisplayName || msg.senderEmail || '(unknown)'
              const hasHandshake = msg.handshakeId !== null
              return (
                <div
                  key={msg.messageId}
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    minWidth: 0,
                    background: isSelected
                      ? 'var(--color-accent-bg, rgba(139,92,246,0.12))'
                      : 'transparent',
                    borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                  }}
                >
                  <button
                    onClick={() => handleSelect(msg.messageId)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      padding: '10px 12px',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'inherit',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '6px',
                      minWidth: 0,
                    }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: msg.isRead ? 500 : 600,
                        color: 'var(--color-text, #e2e8f0)',
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {!msg.isRead && (
                          <span style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: '#3b82f6',
                            marginRight: 6,
                            verticalAlign: 'middle',
                          }} />
                        )}
                        {hasHandshake ? '🤝' : '✉️'} {senderLabel}
                      </span>
                      <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {urgencyConfig && (
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: urgencyConfig.color,
                            }}
                          />
                        )}
                        <span style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
                          {formatRelativeTime(msg.timestamp)}
                        </span>
                      </span>
                    </div>
                    {preview && (
                      <div style={{
                        fontSize: '11px',
                        color: 'var(--color-text-muted, #94a3b8)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {preview}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '2px 5px',
                        borderRadius: 4,
                        color: trustConfig.color,
                        background: trustConfig.bg,
                      }}>
                        {trustConfig.label}
                      </span>
                    </div>
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── Center (1fr) ── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative',
        minWidth: 320,
        minHeight: 0,
      }}>
        {effectiveSelectedId ? (
          <BeapMessageDetailPanel
            ref={detailPanelRef}
            theme={THEME}
            onSetSearchContext={onSetSearchContext}
            onViewHandshake={handleViewHandshake}
            onAttachmentSelect={onAttachmentSelect}
            replyComposerConfig={replyComposerConfig}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }}>
            <EmailProvidersSection
              theme="professional"
              emailAccounts={emailAccounts}
              isLoadingEmailAccounts={isLoadingEmailAccounts}
              selectedEmailAccountId={selectedEmailAccountId}
              onConnectEmail={handleConnectEmail}
              onDisconnectEmail={handleDisconnectEmail}
              onSelectEmailAccount={setSelectedEmailAccountId}
            />
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted, #94a3b8)',
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>✉️</div>
              <div style={{ fontSize: '13px' }}>Select a message to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Column (320px, only when no selection) ── */}
      {!effectiveSelectedId && (
        <div style={{
          borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '14px 12px',
            borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            fontSize: '13px',
            fontWeight: 700,
          }}>
            Import & Compose
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            <BeapMessageImportZone />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 12,
            right: 16,
            zIndex: 1001,
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            background: toast.type === 'success' ? '#d1fae5' : toast.type === 'error' ? '#fee2e2' : '#e0e7ff',
            color: toast.type === 'success' ? '#065f46' : toast.type === 'error' ? '#991b1b' : '#3730a3',
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Email Connect Wizard */}
      <EmailConnectWizard
        isOpen={showEmailConnectModal}
        onClose={() => setShowEmailConnectModal(false)}
        onConnected={() => {
          loadEmailAccounts()
          setShowEmailConnectModal(false)
        }}
        theme="professional"
      />

      {/* Compose buttons — bottom-right: [✉+] inner (left), [+ BEAP] outer (right) */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => handleComposeClick(() => window.analysisDashboard?.openEmailCompose?.())}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '10px 14px', borderRadius: '24px',
            background: '#2563eb', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
          }}
          title="New Email"
        >
          ✉️+
        </button>
        <button
          onClick={() => handleComposeClick(() => window.analysisDashboard?.openBeapDraft?.())}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 18px', borderRadius: '24px',
            background: '#7c3aed', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)'
          }}
          title="New BEAP™ Message"
        >
          + BEAP
        </button>
      </div>
    </div>
  )
}
