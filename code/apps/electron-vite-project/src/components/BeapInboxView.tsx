/**
 * BeapInboxView — directly uses all BEAP components from extension-chromium.
 * Same exact code, same exact UI. Dependencies are shimmed via @ext aliases.
 */

import { useState } from 'react'
import type { BeapFolder } from '@ext/beap-messages/types'
import { FOLDER_CONFIGS } from '@ext/beap-messages/types'
import { useBeapMessagesStore } from '@ext/beap-messages/useBeapMessagesStore'
import { BeapMessageRow } from '@ext/beap-messages/components/BeapMessageRow'
import { BeapMessagePreview } from '@ext/beap-messages/components/BeapMessagePreview'
import { OutboxMessagePreview } from '@ext/beap-messages/components/OutboxMessagePreview'
import { InboxMessagePreview } from '@ext/beap-messages/components/InboxMessagePreview'
import { RejectedMessagePreview } from '@ext/beap-messages/components/RejectedMessagePreview'
import { BeapDraftComposer } from '@ext/beap-messages/components/BeapDraftComposer'

const THEME = 'professional' as const

type SidebarKey = BeapFolder | 'draft'

const SIDEBAR_ITEMS: { key: SidebarKey; label: string; icon: string }[] = [
  { key: 'inbox', label: 'Inbox', icon: '📥' },
  { key: 'draft', label: 'Draft', icon: '✏️' },
  { key: 'outbox', label: 'Outbox', icon: '📤' },
  { key: 'archived', label: 'Archived', icon: '📁' },
  { key: 'rejected', label: 'Rejected', icon: '🚫' },
]

export default function BeapInboxView() {
  const [activeKey, setActiveKey] = useState<SidebarKey>('inbox')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)

  const messages = useBeapMessagesStore(state => state.messages)
  const selectedMessageId = useBeapMessagesStore(state => state.selectedMessageId)
  const searchQuery = useBeapMessagesStore(state => state.searchQuery)
  const setSearchQuery = useBeapMessagesStore(state => state.setSearchQuery)
  const selectMessage = useBeapMessagesStore(state => state.selectMessage)
  const getSelectedMessage = useBeapMessagesStore(state => state.getSelectedMessage)
  const moveToFolder = useBeapMessagesStore(state => state.moveToFolder)
  const confirmMessengerSent = useBeapMessagesStore(state => state.confirmMessengerSent)
  const confirmDownloadDelivered = useBeapMessagesStore(state => state.confirmDownloadDelivered)
  const getMessageById = useBeapMessagesStore(state => state.getMessageById)

  const notify = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3000)
  }

  const handleSetActiveKey = (k: SidebarKey) => { setActiveKey(k); selectMessage(null) }
  const currentFolder: BeapFolder | null = activeKey === 'draft' ? null : activeKey as BeapFolder

  const folderMessages = currentFolder
    ? messages
        .filter((m: any) => m.folder === currentFolder && (
          !searchQuery.trim() ||
          m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.bodyText.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.fingerprint.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (m.senderName?.toLowerCase().includes(searchQuery.toLowerCase()))
        ))
        .sort((a: any, b: any) => b.timestamp - a.timestamp)
    : []

  const selectedMsg = selectedMessageId && currentFolder
    ? messages.find((m: any) => m.id === selectedMessageId && m.folder === currentFolder) ?? null
    : null

  const counts = (['inbox', 'outbox', 'archived', 'rejected'] as BeapFolder[]).reduce((acc, f) => {
    acc[f] = messages.filter((m: any) => m.folder === f).length; return acc
  }, {} as Record<BeapFolder, number>)

  const handleVerify = async (id: string) => {
    console.log('[BEAP-Electron] Verify:', id)
    notify('Verifying...', 'info')
  }

  const handleRetry = async (id: string) => {
    console.log('[BEAP-Electron] Retry:', id)
    notify('Retrying...', 'info')
  }

  const handleCopyPayload = async (id: string): Promise<boolean> => {
    const m = getMessageById(id)
    if (m?.messengerPayload) {
      try { await navigator.clipboard.writeText(m.messengerPayload); return true } catch { return false }
    }
    return false
  }

  const handleMarkSent = (id: string) => { confirmMessengerSent(id); notify('Marked as sent', 'success') }
  const handleMarkDelivered = (id: string) => { confirmDownloadDelivered(id); notify('Marked as delivered', 'success') }
  const handleArchive = (id: string) => { moveToFolder(id, 'archived'); notify('Message archived', 'success') }

  const handleDownloadAgain = (id: string) => {
    const m = getMessageById(id)
    if (!m?.downloadRef) return
    const a = document.createElement('a'); a.href = m.downloadRef; a.download = `beap-package-${id}.beap`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const handleOpen = (id: string) => console.log('[BEAP-Electron] Open:', id)

  const textColor = '#0f172a'
  const mutedColor = '#64748b'
  const borderColor = 'rgba(15,23,42,0.1)'
  const bgColor = '#f8fafc'
  const headerBg = 'white'

  const handleCtaClick = () => {
    if (!currentFolder) return
    const action = FOLDER_CONFIGS[currentFolder].ctaAction
    if (action === 'create-draft') handleSetActiveKey('draft')
    else if (action === 'back-to-inbox') handleSetActiveKey('inbox')
  }

  const renderEmptyState = () => {
    if (!currentFolder) return null
    const cfg = FOLDER_CONFIGS[currentFolder]
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center' }}>
          <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>{cfg.emptyIcon}</span>
          <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>{cfg.emptyTitle}</div>
          <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px', marginBottom: cfg.ctaLabel ? '16px' : '0' }}>{cfg.emptyDescription}</div>
          {cfg.ctaLabel && <button onClick={handleCtaClick} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 500, borderRadius: '8px', cursor: 'pointer', border: 'none', background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', color: 'white' }}>{cfg.ctaLabel}</button>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: bgColor, position: 'relative' }}>
      {toast && (
        <div style={{ position: 'absolute', top: '12px', right: '16px', zIndex: 100, padding: '9px 15px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', background: toast.type === 'success' ? '#d1fae5' : toast.type === 'error' ? '#fee2e2' : '#dbeafe', color: toast.type === 'success' ? '#065f46' : toast.type === 'error' ? '#991b1b' : '#1e40af' }}>
          {toast.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside style={{ width: '170px', flexShrink: 0, borderRight: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', padding: '14px 10px', gap: '2px', background: 'white' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: mutedColor, padding: '0 8px', marginBottom: '10px' }}>BEAP™ Inbox</div>
        {SIDEBAR_ITEMS.map(item => {
          const active = activeKey === item.key
          const count = item.key !== 'draft' ? counts[item.key as BeapFolder] : null
          return (
            <button key={item.key} onClick={() => handleSetActiveKey(item.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: active ? 600 : 400, background: active ? 'rgba(139,92,246,0.08)' : 'transparent', color: active ? '#7c3aed' : '#333333', width: '100%', transition: 'background 0.12s, color 0.12s', textAlign: 'left' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', lineHeight: 1 }}>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {count !== null && count > 0 && (
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: active ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.1)', color: '#a855f7', minWidth: '18px', textAlign: 'center' }}>{count}</span>
              )}
            </button>
          )
        })}
      </aside>

      {/* Draft Composer — uses the EXACT same component from extension */}
      {activeKey === 'draft' && (
        <BeapDraftComposer
          theme={THEME}
          onNotification={(msg, type) => notify(msg, type)}
        />
      )}

      {/* Message List + Preview for folder views */}
      {activeKey !== 'draft' && currentFolder && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Message List */}
          <div style={{ width: '45%', minWidth: '280px', maxWidth: '400px', borderRight: `1px solid ${borderColor}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${borderColor}`, background: headerBg, display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>{FOLDER_CONFIGS[currentFolder].icon}</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>{FOLDER_CONFIGS[currentFolder].title}</span>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '10px', background: 'rgba(139,92,246,0.1)', color: '#a855f7', fontWeight: 500 }}>{folderMessages.length}</span>
              </div>
              <div style={{ flex: 1, maxWidth: '300px' }}>
                <input type="text" placeholder="Search messages..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '6px 12px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${borderColor}`, background: 'white', color: textColor, outline: 'none' }} />
              </div>
              <select style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '6px', border: `1px solid ${borderColor}`, background: 'white', color: textColor, outline: 'none', cursor: 'pointer' }}>
                <option value="all">All</option>
                <option value="recent">Recent</option>
                <option value="attachments">With attachments</option>
              </select>
            </div>
            {folderMessages.length === 0 ? renderEmptyState() : (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {folderMessages.map((msg: any) => (
                  <BeapMessageRow key={msg.id} message={msg} isSelected={msg.id === selectedMessageId} theme={THEME} onClick={(id: string) => selectMessage(id)} />
                ))}
              </div>
            )}
          </div>

          {/* Preview Panel — uses the EXACT same components from extension */}
          {currentFolder === 'outbox' ? (
            <OutboxMessagePreview message={selectedMsg} theme={THEME} onRetry={handleRetry} onCopyPayload={handleCopyPayload} onMarkSent={handleMarkSent} onDownloadAgain={handleDownloadAgain} onMarkDelivered={handleMarkDelivered} onOpen={handleOpen} onArchive={handleArchive} />
          ) : currentFolder === 'inbox' ? (
            <InboxMessagePreview message={selectedMsg} theme={THEME} onVerify={handleVerify} onOpen={handleOpen} />
          ) : currentFolder === 'rejected' ? (
            <RejectedMessagePreview message={selectedMsg} theme={THEME} />
          ) : (
            <BeapMessagePreview message={selectedMsg} folder={currentFolder} theme={THEME} onOpen={handleOpen} onAccept={(id: string) => console.log('[BEAP] Accept:', id)} onReject={(id: string) => console.log('[BEAP] Reject:', id)} onRetry={handleRetry} onArchive={handleArchive} onViewReason={(id: string) => console.log('[BEAP] View reason:', id)} />
          )}
        </div>
      )}

      {currentFolder === 'inbox' && (
        <button onClick={() => handleSetActiveKey('draft')} title="New Draft" style={{ position: 'absolute', bottom: '24px', right: '24px', width: '50px', height: '50px', borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: '24px', background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)', color: '#fff', boxShadow: '0 4px 14px rgba(139,92,246,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      )}
    </div>
  )
}
