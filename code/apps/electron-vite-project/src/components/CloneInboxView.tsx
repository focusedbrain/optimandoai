/**
 * CloneInboxView — Sandbox-only "Clone Inbox" view.
 *
 * Shown when mode === 'sandbox'. Suppresses all full mail-client surfaces.
 * Kept: SandboxReadConsentWizard (mail processing setup),
 *       SandboxProcessingConsole (D3), clone message list, EmailMessageDetail.
 *
 * Orphaned state (D4): shows "Awaiting pairing" — never the connect-email CTA.
 *
 * ui-readability: every surface sets explicit bg + color.
 */

import { useEffect, useMemo, useState } from 'react'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import { useEmailInboxStore, type InboxMessage } from '../stores/useEmailInboxStore'
import { useIngestionStatus } from '../hooks/useIngestionStatus'
import { useSandboxReadConsent } from '../hooks/useSandboxReadConsent'
import { SandboxReadConsentWizard } from './SandboxReadConsentWizard'
import EmailMessageDetail from './EmailMessageDetail'
import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'

// ── Clone-origin filter ───────────────────────────────────────────────────────

/** True when depackaged_metadata carries inbox_response_path.sandbox_clone === true */
export function isCloneMessage(msg: InboxMessage): boolean {
  if (!msg.depackaged_metadata) return false
  try {
    const meta = JSON.parse(msg.depackaged_metadata) as {
      inbox_response_path?: { sandbox_clone?: boolean }
    }
    return meta.inbox_response_path?.sandbox_clone === true
  } catch {
    return false
  }
}

// ── Status code → plain English (D3) ─────────────────────────────────────────

function statusToPlainWords(code: string | undefined): string {
  switch (code) {
    case 'OK_SANDBOX_FETCHING':
    case 'OK_SINGLE_MACHINE':
    case 'DEGRADED_HELD_MESSAGES':
      return 'Processing normally'
    case 'ACTION_NEEDED_READ_CONSENT':
      return 'Read consent needed'
    case 'PAUSED_SANDBOX_UNREACHABLE':
    case 'PAUSED_HOST_DELEGATED':
      return 'Provider unreachable'
    default:
      return 'Checking…'
  }
}

function formatLastPoll(tsMs: number | undefined): string {
  if (!tsMs) return '—'
  const diff = Date.now() - tsMs
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3_600_000)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function formatRelDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const diffM = Math.floor(diffMs / 60_000)
    const diffH = Math.floor(diffMs / 3_600_000)
    const diffD = Math.floor(diffMs / 86_400_000)
    if (diffM < 1) return 'now'
    if (diffM < 60) return `${diffM}m`
    if (diffH < 24) return `${diffH}h`
    if (diffD < 7) return `${diffD}d`
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace(/\//g, '.')
  } catch {
    return '—'
  }
}

// ── D3 — Sandbox processing console ──────────────────────────────────────────

interface SandboxProcessingConsoleProps {
  status: IngestionStatusResult | null
}

export function SandboxProcessingConsole({ status }: SandboxProcessingConsoleProps) {
  if (!status) return null

  const totalDelivered = status.accounts.reduce((s, a) => s + (a.lastPollDelivered ?? 0), 0)
  const totalHeld = status.accounts.reduce((s, a) => s + (a.lastPollHeld ?? 0), 0)
  const lastPollAt = status.accounts.reduce<number | undefined>((best, a) => {
    if (!a.lastPollAt) return best
    return best == null || a.lastPollAt > best ? a.lastPollAt : best
  }, undefined)

  return (
    <div
      data-testid="sandbox-processing-console"
      style={{
        padding: '7px 16px',
        borderBottom: '1px solid var(--border, var(--border-prof, #e2e8f0))',
        display: 'flex',
        gap: 20,
        alignItems: 'center',
        fontSize: 11,
        flexWrap: 'wrap',
        background: 'var(--bg-elevated, var(--bg-elevated-prof, #f8fafc))',
        color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
      }}
    >
      <span
        data-testid="console-status-text"
        style={{
          fontWeight: 600,
          color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
        }}
      >
        {statusToPlainWords(status.code)}
      </span>
      <span data-testid="console-delivered">
        Delivered to host: <strong>{totalDelivered}</strong>
      </span>
      {totalHeld > 0 && (
        <span data-testid="console-held" style={{ color: '#b45309' }}>
          Held: <strong>{totalHeld}</strong>
        </span>
      )}
      <span data-testid="console-last-poll">Last check: {formatLastPoll(lastPollAt)}</span>
    </div>
  )
}

// ── D4 — Orphaned sandbox placeholder ────────────────────────────────────────

export function OrphanedSandboxPlaceholder() {
  return (
    <div
      data-testid="orphaned-sandbox-placeholder"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '48px 32px',
        textAlign: 'center',
        background: 'var(--bg-surface, var(--bg-surface-prof, #f8fafc))',
        color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>⏳</div>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.65,
          maxWidth: 380,
          margin: 0,
          color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
        }}
      >
        {'Awaiting pairing — complete the internal handshake with your host device to start processing mail.'}
      </p>
    </div>
  )
}

// ── Empty clone list ──────────────────────────────────────────────────────────

function CloneInboxEmptyState() {
  return (
    <div
      data-testid="clone-inbox-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>📭</div>
      <p style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 280, margin: 0 }}>
        No cloned messages yet. When your host sends a clone, it will appear here.
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CloneInboxViewProps {
  selectedMessageId: string | null
  onSelectMessage: (id: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (id: string | null) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  onOpenHandshakesView?: () => void
}

export default function CloneInboxView({
  selectedMessageId,
  onSelectMessage,
  selectedAttachmentId,
  onSelectAttachment,
  onOpenHandshakesView,
}: CloneInboxViewProps) {
  const { mode, isSandbox, ledgerProvesInternalSandboxToHost, ready } = useOrchestratorMode()
  const orphanedSandbox = isSandbox && !ledgerProvesInternalSandboxToHost && ready

  const { allMessages, fetchMessages } = useEmailInboxStore()

  // Trigger initial load when this view mounts (substitutes for EmailInboxView's own fetch trigger)
  useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  const cloneMessages = useMemo<InboxMessage[]>(
    () => allMessages.filter((m) => !m.deleted && !m.archived && isCloneMessage(m)),
    [allMessages],
  )

  const { status } = useIngestionStatus({
    mode,
    ledgerProvesLocalHostPeerSandbox: false,
  })

  const { showWizard, openWizard, closeWizard } = useSandboxReadConsent(status)

  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const selectedMessage = useMemo<InboxMessage | null>(
    () => cloneMessages.find((m) => m.id === selectedMessageId) ?? null,
    [cloneMessages, selectedMessageId],
  )

  if (!isSandbox) return null

  return (
    <div
      data-testid="clone-inbox-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-surface, var(--bg-surface-prof, #f8fafc))',
        color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
      }}
    >
      {/* D3 — Processing console: visible in paired state */}
      {!orphanedSandbox && <SandboxProcessingConsole status={status} />}

      {/* D2 — SandboxReadConsentWizard: mail processing setup */}
      {showWizard && <SandboxReadConsentWizard onClose={closeWizard} />}

      {orphanedSandbox ? (
        // D4 — Orphaned state: never show connect-email CTA
        <OrphanedSandboxPlaceholder />
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* ── Left: clone message list (280px) ── */}
          <div
            style={{
              width: 280,
              flexShrink: 0,
              borderRight: '1px solid var(--border, var(--border-prof, #e2e8f0))',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header + subtext (D2 spec) */}
            <div
              style={{
                padding: '12px 14px 10px',
                borderBottom: '1px solid var(--border, var(--border-prof, #e2e8f0))',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
                }}
              >
                Clone Inbox
              </div>
              <div
                data-testid="clone-inbox-subtext"
                style={{
                  fontSize: 11,
                  lineHeight: 1.5,
                  marginTop: 3,
                  color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
                }}
              >
                {'Cloned messages from your host for safe viewing and testing. Your mail lives on the host device.'}
              </div>

              {/* Mail processing setup section (UX-2b rows 5/6 — read-consent wizard trigger) */}
              {status?.code === 'ACTION_NEEDED_READ_CONSENT' && (
                <div
                  data-testid="clone-inbox-mail-processing-setup"
                  style={{ marginTop: 10 }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.5px',
                      textTransform: 'uppercase',
                      color: 'var(--text-secondary, var(--text-secondary-prof, #94a3b8))',
                      marginBottom: 4,
                    }}
                  >
                    Mail processing setup
                  </div>
                  <button
                    type="button"
                    data-testid="clone-inbox-consent-cta"
                    onClick={openWizard}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: '1px solid rgba(245,158,11,0.5)',
                      background: 'rgba(245,158,11,0.08)',
                      color: '#92400e',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    Connect a read-only email account →
                  </button>
                </div>
              )}
            </div>

            {/* Message list */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              {cloneMessages.length === 0 ? (
                <CloneInboxEmptyState />
              ) : (
                cloneMessages.map((msg) => {
                  const isSelected = msg.id === selectedMessageId
                  const isHovered = msg.id === hoveredId
                  const isUnread = msg.read_status === 0
                  return (
                    <div
                      key={msg.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`clone-message-row-${msg.id}`}
                      onClick={() => onSelectMessage(msg.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelectMessage(msg.id)
                        }
                      }}
                      onMouseEnter={() => setHoveredId(msg.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      style={{
                        padding: '9px 14px',
                        borderBottom: '1px solid var(--border, var(--border-prof, #e2e8f0))',
                        cursor: 'pointer',
                        background: isSelected
                          ? 'var(--bg-elevated, var(--bg-elevated-prof, #eff6ff))'
                          : isHovered
                            ? 'var(--bg-elevated, var(--bg-elevated-prof, #f1f5f9))'
                            : 'transparent',
                        color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: isUnread ? 700 : 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
                          }}
                        >
                          {msg.from_name ?? msg.from_address ?? '(unknown)'}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: 'var(--text-secondary, var(--text-secondary-prof, #94a3b8))',
                            flexShrink: 0,
                          }}
                        >
                          {formatRelDate(msg.received_at)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary, var(--text-secondary-prof, #64748b))',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {msg.subject ?? '(no subject)'}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* ── Right: message detail or placeholder ── */}
          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-surface, var(--bg-surface-prof, #f8fafc))',
            }}
          >
            {selectedMessage != null ? (
              <EmailMessageDetail
                message={selectedMessage}
                selectedAttachmentId={selectedAttachmentId}
                onSelectAttachment={onSelectAttachment}
                onOpenHandshakesView={onOpenHandshakesView}
              />
            ) : (
              <div
                data-testid="clone-detail-placeholder"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-secondary, var(--text-secondary-prof, #94a3b8))',
                  fontSize: 13,
                }}
              >
                Select a message to view
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
