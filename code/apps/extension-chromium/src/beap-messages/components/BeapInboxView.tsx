/**
 * BeapInboxView
 *
 * Self-contained orchestrator for the entire BEAP™ Inbox experience.
 * Replaces the bare `<BeapMessageListView folder="inbox" />` placeholder
 * in all three sidepanel render modes.
 *
 * Layout (sub-view: "messages")
 * ──────────────────────────────
 *   ┌─────────────────────┬──────────────────────────────────────────┐
 *   │  BeapInboxSidebar   │  BeapMessageDetailPanel (split viewport) │
 *   │  (message list)     │  or empty state                          │
 *   └─────────────────────┴──────────────────────────────────────────┘
 *
 * Layout (sub-view: "bulk")
 * ──────────────────────────
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  BeapBulkInbox (full width, grid)                            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Navigation
 * ──────────
 * - Sub-view toggle: "Messages" | "Bulk" tabs in inbox header
 * - `onNavigateToHandshake(handshakeId)` — asks sidepanel to switch to Handshakes tab
 * - `onNavigateToDraft()` — asks sidepanel to switch to BEAP draft view
 * - `onNavigateToWRGuard()` — asks sidepanel to open WRGuard workspace
 *
 * Search bar integration
 * ──────────────────────
 * `onSetSearchContext(label)` is called whenever selection changes.
 * The parent (sidepanel) reads the label and updates the `<textarea>` placeholder.
 * `onAiQuery(query, messageId)` is called when the search bar is submitted while
 * a message is selected — the parent routes this to the AI and calls
 * `detailPanelRef.current.appendAiEntry(...)` with the response.
 *
 * Keyboard shortcuts
 * ──────────────────
 * Delegated to `useInboxKeyboardNav`.
 * ↑/↓   navigate list
 * Enter  select focused item
 * Esc    deselect / close detail
 * R      open reply composer (fires onOpenReply on the selected message)
 * T      toggle AI for selected pair (bulk view)
 * Ctrl+Enter is handled inside BeapMessageDetailPanel's reply composer
 *
 * Loading / empty / error states
 * ──────────────────────────────
 * Uses Zustand store message count for empty detection.
 * Shows skeleton on first mount for 800 ms (matches typical first paint).
 *
 * @version 1.0.0
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react'
import { BeapInboxSidebar } from './BeapInboxSidebar'
import { BeapMessageDetailPanel } from './BeapMessageDetailPanel'
import { BeapBulkInbox } from './BeapBulkInbox'
import type { BeapMessageDetailPanelHandle } from './BeapMessageDetailPanel'
import type { BeapBulkInboxHandle } from './BeapBulkInbox'
import { useBeapInboxStore } from '../useBeapInboxStore'
import { useInboxKeyboardNav } from '../hooks/useInboxKeyboardNav'
import { useMediaQuery, NARROW_VIEWPORT } from '../hooks/useMediaQuery'

// =============================================================================
// Public API
// =============================================================================

export interface BeapInboxViewProps {
  theme?: 'default' | 'dark' | 'professional'

  /** Called when the user navigates to a specific handshake from a message chip. */
  onNavigateToHandshake?: (handshakeId: string) => void

  /** Called when the user clicks "Go to Draft" to compose a new BEAP message. */
  onNavigateToDraft?: () => void

  /** Called when the user wants to open the WRGuard workspace. */
  onNavigateToWRGuard?: () => void

  /**
   * Called whenever message selection changes.
   * Parent should update the search bar placeholder with this label.
   */
  onSetSearchContext?: (label: string) => void

  /**
   * Called when the search bar is submitted while a message is selected.
   * `messageId` is the currently selected message.
   * `attachmentId` is set when a specific attachment is the query target.
   * Parent should route the query to AI and call `inboxViewRef.current.appendAiEntry(...)`.
   */
  onAiQuery?: (query: string, messageId: string, attachmentId?: string) => void

  /**
   * Called when user wants to switch to the Handshakes tab for cross-tab navigation.
   */
  onNavigateToHandshakesTab?: () => void

  /**
   * Config for the shared BeapReplyComposer (sender fingerprint, AI provider, etc.).
   * Passed to BeapMessageDetailPanel and BeapBulkInbox for consistent reply UX.
   */
  replyComposerConfig?: import('../hooks/useReplyComposer').UseReplyComposerConfig
}

/** Ref handle so the parent (sidepanel) can push AI responses into the active panel. */
export interface BeapInboxViewHandle {
  /** Push an AI response into the currently active message's panel. */
  appendAiEntry: (entry: {
    type: 'text' | 'markdown' | 'chart'
    content: string
    query: string
    source?: string
  }) => void
  startGenerating: () => void
  stopGenerating: () => void
}

// =============================================================================
// Sub-view type
// =============================================================================

type InboxSubView = 'messages' | 'bulk'

// =============================================================================
// Skeleton loading placeholder
// =============================================================================

const SkeletonRow: React.FC<{ isProfessional: boolean }> = ({ isProfessional }) => {
  const base = isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)'
  const shimmer = isProfessional ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'
  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: shimmer }} />
        <div style={{ flex: 1, height: 12, borderRadius: 4, background: shimmer }} />
        <div style={{ width: 36, height: 10, borderRadius: 4, background: base }} />
      </div>
      <div style={{ height: 10, borderRadius: 4, background: base, width: '80%' }} />
    </div>
  )
}

const InboxSkeleton: React.FC<{ isProfessional: boolean }> = ({ isProfessional }) => (
  <div style={{ flex: 1 }}>
    {Array.from({ length: 5 }).map((_, i) => (
      <SkeletonRow key={i} isProfessional={isProfessional} />
    ))}
  </div>
)

// =============================================================================
// Empty state
// =============================================================================

const InboxEmptyState: React.FC<{
  isProfessional: boolean
  onImport?: () => void
  onNavigateToDraft?: () => void
}> = ({ isProfessional, onImport, onNavigateToDraft }) => {
  const textColor  = isProfessional ? '#1f2937' : 'white'
  const mutedColor = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.55)'
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        textAlign: 'center',
        gap: '10px',
      }}
    >
      <span style={{ fontSize: '44px', opacity: 0.35 }}>📥</span>
      <div style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
        No BEAP messages yet
      </div>
      <div style={{ fontSize: '12px', color: mutedColor, maxWidth: '240px', lineHeight: 1.5 }}>
        Import a <code style={{ fontFamily: 'monospace' }}>.beap</code> file or wait for
        incoming messages. All packages are verified before display.
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
        {onImport && (
          <button
            onClick={onImport}
            style={{
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '7px',
              border: '1px solid rgba(168,85,247,0.4)',
              background: 'rgba(168,85,247,0.12)',
              color: '#a855f7',
              cursor: 'pointer',
            }}
          >
            📂 Import .beap
          </button>
        )}
        {onNavigateToDraft && (
          <button
            onClick={onNavigateToDraft}
            style={{
              padding: '7px 14px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'transparent',
              color: mutedColor,
              cursor: 'pointer',
            }}
          >
            ✏️ Compose
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Sub-view tab bar
// =============================================================================

const SubViewTabs: React.FC<{
  activeView: InboxSubView
  onSelect: (v: InboxSubView) => void
  messageCount: number
  isProfessional: boolean
  textColor: string
  mutedColor: string
  borderColor: string
}> = ({ activeView, onSelect, messageCount, isProfessional, textColor, mutedColor, borderColor }) => {
  const tabs: { id: InboxSubView; label: string; icon: string }[] = [
    { id: 'messages', label: 'Messages', icon: '📨' },
    { id: 'bulk',     label: 'Bulk',     icon: '⚡' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '8px 10px 0',
        borderBottom: `1px solid ${borderColor}`,
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeView
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{
              padding: '6px 13px',
              fontSize: '11px',
              fontWeight: isActive ? 700 : 500,
              borderRadius: '6px 6px 0 0',
              border: `1px solid ${isActive ? borderColor : 'transparent'}`,
              borderBottom: isActive ? `1px solid ${isProfessional ? 'white' : 'rgba(18,18,18,1)'}` : 'none',
              background: isActive
                ? (isProfessional ? 'white' : 'rgba(255,255,255,0.04)')
                : 'transparent',
              color: isActive ? (isProfessional ? '#7c3aed' : '#a855f7') : mutedColor,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: isActive ? '-1px' : '0',
              position: 'relative',
              zIndex: isActive ? 1 : 0,
              transition: 'all 0.12s ease',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.id === 'messages' && messageCount > 0 && (
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  padding: '1px 5px',
                  borderRadius: '8px',
                  background: isActive ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.1)',
                  color: isActive ? '#a855f7' : mutedColor,
                }}
              >
                {messageCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// =============================================================================
// Error banner
// =============================================================================

const ErrorBanner: React.FC<{ message: string; onDismiss: () => void; isProfessional: boolean }> = ({
  message, onDismiss, isProfessional,
}) => (
  <div
    style={{
      padding: '8px 14px',
      background: 'rgba(239,68,68,0.1)',
      borderBottom: '1px solid rgba(239,68,68,0.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      flexShrink: 0,
    }}
  >
    <span style={{ fontSize: '11px', color: '#ef4444', flex: 1 }}>⚠️ {message}</span>
    <button
      onClick={onDismiss}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '13px', padding: '0 2px', lineHeight: 1 }}
    >
      ×
    </button>
  </div>
)

// =============================================================================
// Main component
// =============================================================================

export const BeapInboxView = React.forwardRef<BeapInboxViewHandle, BeapInboxViewProps>(
  (
    {
      theme = 'default',
      onNavigateToHandshake,
      onNavigateToDraft,
      onNavigateToWRGuard,
      onSetSearchContext,
      onAiQuery,
      onNavigateToHandshakesTab,
      replyComposerConfig,
    },
    ref,
  ) => {
    const isProfessional = theme === 'professional'
    const textColor   = isProfessional ? '#1f2937' : 'white'
    const mutedColor  = isProfessional ? '#6b7280' : 'rgba(255,255,255,0.55)'
    const borderColor = isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'

    // Store
    const getInboxMessages  = useBeapInboxStore((s) => s.getInboxMessages)
    const selectedMessageId = useBeapInboxStore((s) => s.selectedMessageId)

    // Local state
    const [subView, setSubView]       = useState<InboxSubView>('messages')
    const [isLoading, setIsLoading]   = useState(true)
    const [error, setError]           = useState<string | null>(null)

    // Refs to child handles
    const detailPanelRef = useRef<BeapMessageDetailPanelHandle>(null)
    const bulkInboxRef   = useRef<BeapBulkInboxHandle>(null)

    // Simulate initial load (real data arrives from store; just brief skeleton)
    useEffect(() => {
      const timer = setTimeout(() => setIsLoading(false), 600)
      return () => clearTimeout(timer)
    }, [])

    const inboxMessages = getInboxMessages()
    const messageCount  = inboxMessages.length
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const isNarrow = useMediaQuery(NARROW_VIEWPORT)

    // Auto-collapse sidebar when viewport < 768px
    useEffect(() => {
      if (isNarrow) setSidebarCollapsed(true)
    }, [isNarrow])

    // ── Expose handle to sidepanel ───────────────────────────────
    React.useImperativeHandle(ref, () => ({
      appendAiEntry: (entry) => {
        if (subView === 'messages') {
          detailPanelRef.current?.appendAiEntry(entry)
        } else if (subView === 'bulk' && selectedMessageId) {
          bulkInboxRef.current?.handleExternalAiQuery(
            entry.query,
            selectedMessageId,
            entry.content,
            entry.type,
            entry.source,
          )
        }
      },
      startGenerating: () => {
        if (subView === 'messages') {
          detailPanelRef.current?.startGenerating()
        } else if (subView === 'bulk' && selectedMessageId) {
          bulkInboxRef.current?.startGenerating(selectedMessageId)
        }
      },
      stopGenerating: () => {
        if (subView === 'messages') {
          detailPanelRef.current?.stopGenerating()
        } else if (subView === 'bulk' && selectedMessageId) {
          bulkInboxRef.current?.stopGenerating(selectedMessageId)
        }
      },
    }))

    // ── Search context delegation ─────────────────────────────────
    const handleSetSearchContext = useCallback(
      (label: string) => {
        onSetSearchContext?.(label)
      },
      [onSetSearchContext],
    )

    // ── Navigation: handshake → Handshakes tab ───────────────────
    const handleViewHandshake = useCallback(
      (handshakeId: string) => {
        onNavigateToHandshake?.(handshakeId)
        onNavigateToHandshakesTab?.()
      },
      [onNavigateToHandshake, onNavigateToHandshakesTab],
    )

    // ── Keyboard navigation ───────────────────────────────────────
    useInboxKeyboardNav({
      enabled: subView === 'messages',
      messages: inboxMessages,
    })

    // ── Render ────────────────────────────────────────────────────
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Error banner */}
        {error && (
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
            isProfessional={isProfessional}
          />
        )}

        {/* Sub-view tabs */}
        <SubViewTabs
          activeView={subView}
          onSelect={setSubView}
          messageCount={messageCount}
          isProfessional={isProfessional}
          textColor={textColor}
          mutedColor={mutedColor}
          borderColor={borderColor}
        />

        {/* Content area */}
        {isLoading ? (
          <InboxSkeleton isProfessional={isProfessional} />
        ) : messageCount === 0 && subView === 'messages' ? (
          <InboxEmptyState
            isProfessional={isProfessional}
            onNavigateToDraft={onNavigateToDraft}
          />
        ) : subView === 'messages' ? (
          /* ── Single-message split view (sidebar collapsible for responsive layout) ── */
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'row',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            {/* Left: sidebar list (collapsible) */}
            <div
              style={{
                width: sidebarCollapsed ? '40px' : '220px',
                minWidth: sidebarCollapsed ? '40px' : '220px',
                flexShrink: 0,
                borderRight: `1px solid ${borderColor}`,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transition: 'width 0.2s ease, min-width 0.2s ease',
              }}
            >
              {sidebarCollapsed ? (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  title="Expand sidebar"
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: 'none',
                    background: 'transparent',
                    color: mutedColor,
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  ▶
                </button>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 6px', borderBottom: `1px solid ${borderColor}` }}>
                    <button
                      onClick={() => setSidebarCollapsed(true)}
                      title="Collapse sidebar"
                      style={{
                        padding: '4px 6px',
                        border: 'none',
                        background: 'transparent',
                        color: mutedColor,
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      ◀
                    </button>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <BeapInboxSidebar
                      theme={theme}
                      onNavigateToDraft={onNavigateToDraft}
                      onNavigateToHandshake={handleViewHandshake}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Right: detail panel */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
              {selectedMessageId ? (
                <BeapMessageDetailPanel
                  ref={detailPanelRef}
                  theme={theme}
                  onSetSearchContext={handleSetSearchContext}
                  onAiQuery={onAiQuery}
                  onViewHandshake={handleViewHandshake}
                  replyComposerConfig={replyComposerConfig}
                />
              ) : (
                <NoMessageSelected
                  isProfessional={isProfessional}
                  textColor={textColor}
                  mutedColor={mutedColor}
                />
              )}
            </div>
          </div>
        ) : (
          /* ── Bulk grid view ── */
          <BeapBulkInbox
            ref={bulkInboxRef}
            theme={theme}
            onSetSearchContext={handleSetSearchContext}
            onAiQuery={onAiQuery}
            onViewHandshake={handleViewHandshake}
            replyComposerConfig={replyComposerConfig}
            onViewInInbox={(messageId) => {
              // Switch to messages view and select the message
              setSubView('messages')
              useBeapInboxStore.getState().selectMessage(messageId)
            }}
          />
        )}
      </div>
    )
  },
)

BeapInboxView.displayName = 'BeapInboxView'

// =============================================================================
// No-message-selected placeholder
// =============================================================================

const NoMessageSelected: React.FC<{
  isProfessional: boolean
  textColor: string
  mutedColor: string
}> = ({ isProfessional, textColor, mutedColor }) => (
  <div
    style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      padding: '32px',
      textAlign: 'center',
    }}
  >
    <span style={{ fontSize: '40px', opacity: 0.2 }}>✉️</span>
    <div style={{ fontSize: '14px', fontWeight: 500, color: textColor }}>No message selected</div>
    <div style={{ fontSize: '12px', color: mutedColor, maxWidth: '220px', lineHeight: 1.5 }}>
      Select a message from the list to view its content and AI analysis.
    </div>
    <div
      style={{
        marginTop: '8px',
        padding: '8px 14px',
        borderRadius: '8px',
        background: isProfessional ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
        fontSize: '11px',
        color: mutedColor,
        lineHeight: 1.6,
      }}
    >
      <div><kbd>↑ ↓</kbd> Navigate</div>
      <div><kbd>Enter</kbd> Select</div>
      <div><kbd>R</kbd> Reply</div>
      <div><kbd>Esc</kbd> Deselect</div>
    </div>
  </div>
)

export default BeapInboxView
