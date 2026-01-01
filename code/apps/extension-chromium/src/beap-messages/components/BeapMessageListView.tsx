/**
 * BeapMessageListView Component
 * 
 * Shared list view shell used by Inbox, Outbox, Archived, and Rejected views.
 * Provides top bar with title/search, message list, and preview panel.
 * Uses OutboxMessagePreview for outbox folder with delivery-specific actions.
 * 
 * @version 2.0.0
 */

import React, { useCallback } from 'react'
import type { BeapFolder, BeapMessageUI } from '../types'
import { FOLDER_CONFIGS } from '../types'
import { useBeapMessagesStore } from '../useBeapMessagesStore'
import { BeapMessageRow } from './BeapMessageRow'
import { BeapMessagePreview } from './BeapMessagePreview'
import { OutboxMessagePreview } from './OutboxMessagePreview'
import { InboxMessagePreview } from './InboxMessagePreview'
import { RejectedMessagePreview } from './RejectedMessagePreview'
import { useVerifyMessage } from '../../envelope-evaluation'
import { InboxImportBar } from '../../ingress'

interface BeapMessageListViewProps {
  folder: BeapFolder
  theme: 'default' | 'dark' | 'professional'
  onNavigateToDraft?: () => void
  onImport?: () => void
  onNavigateToWRGuard?: () => void
}

export const BeapMessageListView: React.FC<BeapMessageListViewProps> = ({
  folder,
  theme,
  onNavigateToDraft,
  onImport,
  onNavigateToWRGuard
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.02)'
  const headerBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  
  const folderConfig = FOLDER_CONFIGS[folder]
  
  // Store state
  const messages = useBeapMessagesStore(state => state.getMessagesForFolder(folder))
  const selectedMessageId = useBeapMessagesStore(state => state.selectedMessageId)
  const searchQuery = useBeapMessagesStore(state => state.searchQuery)
  const setSearchQuery = useBeapMessagesStore(state => state.setSearchQuery)
  const selectMessage = useBeapMessagesStore(state => state.selectMessage)
  const selectedMessage = useBeapMessagesStore(state => state.getSelectedMessage())
  const moveToFolder = useBeapMessagesStore(state => state.moveToFolder)
  const confirmMessengerSent = useBeapMessagesStore(state => state.confirmMessengerSent)
  const confirmDownloadDelivered = useBeapMessagesStore(state => state.confirmDownloadDelivered)
  const getMessageById = useBeapMessagesStore(state => state.getMessageById)
  
  // Verification hook
  const { verifyMessage } = useVerifyMessage()
  
  // =========================================================================
  // Outbox Action Handlers
  // =========================================================================
  
  const handleRetry = useCallback(async (id: string) => {
    console.log('[BEAP] Retry email:', id)
    // In production, this would trigger the send pipeline
    // For now, just log it
  }, [])
  
  const handleCopyPayload = useCallback(async (id: string): Promise<boolean> => {
    const message = getMessageById(id)
    if (!message?.messengerPayload) return false
    
    try {
      await navigator.clipboard.writeText(message.messengerPayload)
      console.log('[BEAP] Payload copied to clipboard')
      return true
    } catch (err) {
      console.error('[BEAP] Failed to copy payload:', err)
      return false
    }
  }, [getMessageById])
  
  const handleMarkSent = useCallback((id: string) => {
    console.log('[BEAP] Marking messenger as sent:', id)
    confirmMessengerSent(id)
  }, [confirmMessengerSent])
  
  const handleDownloadAgain = useCallback((id: string) => {
    const message = getMessageById(id)
    if (!message?.downloadRef) return
    
    console.log('[BEAP] Downloading again:', id)
    // Trigger download
    const a = document.createElement('a')
    a.href = message.downloadRef
    a.download = `beap-package-${id}.beap`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [getMessageById])
  
  const handleMarkDelivered = useCallback((id: string) => {
    console.log('[BEAP] Marking download as delivered:', id)
    confirmDownloadDelivered(id)
  }, [confirmDownloadDelivered])
  
  const handleArchive = useCallback((id: string) => {
    console.log('[BEAP] Archiving message:', id)
    moveToFolder(id, 'archived')
  }, [moveToFolder])
  
  const handleOpen = useCallback((id: string) => {
    console.log('[BEAP] Opening message:', id)
    // In production, this would open a full message view
  }, [])
  
  // =========================================================================
  // Inbox Verification Handlers
  // =========================================================================
  
  const handleVerify = useCallback(async (id: string) => {
    console.log('[BEAP] Verifying message:', id)
    const result = await verifyMessage(id)
    console.log('[BEAP] Verification result:', result)
  }, [verifyMessage])
  
  // Handle CTA click
  const handleCtaClick = () => {
    switch (folderConfig.ctaAction) {
      case 'import':
        onImport?.()
        break
      case 'create-draft':
        onNavigateToDraft?.()
        break
      case 'back-to-inbox':
        // This would typically navigate to inbox
        break
    }
  }
  
  // Empty state component
  const renderEmptyState = () => (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '40px 20px'
    }}>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>
          {folderConfig.emptyIcon}
        </span>
        <div style={{ 
          fontSize: '16px', 
          fontWeight: 600, 
          color: textColor, 
          marginBottom: '8px' 
        }}>
          {folderConfig.emptyTitle}
        </div>
        <div style={{ 
          fontSize: '13px', 
          color: mutedColor, 
          maxWidth: '280px',
          marginBottom: folderConfig.ctaLabel ? '16px' : '0'
        }}>
          {folderConfig.emptyDescription}
        </div>
        {folderConfig.ctaLabel && (
          <button
            onClick={handleCtaClick}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              cursor: 'pointer',
              border: 'none',
              background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
              color: 'white'
            }}
          >
            {folderConfig.ctaLabel}
          </button>
        )}
      </div>
    </div>
  )
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      flex: 1,
      background: bgColor,
      overflow: 'hidden'
    }}>
      {/* Top Bar */}
      <div style={{ 
        padding: '12px 14px',
        borderBottom: `1px solid ${borderColor}`,
        background: headerBg,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0
      }}>
        {/* Folder Icon + Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{folderConfig.icon}</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
            {folderConfig.title}
          </span>
          <span style={{ 
            fontSize: '11px', 
            padding: '2px 8px',
            borderRadius: '10px',
            background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
            color: '#a855f7',
            fontWeight: 500
          }}>
            {messages.length}
          </span>
        </div>
        
        {/* Search Input */}
        <div style={{ flex: 1, maxWidth: '300px' }}>
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 12px',
              fontSize: '12px',
              borderRadius: '6px',
              border: `1px solid ${borderColor}`,
              background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
              color: textColor,
              outline: 'none'
            }}
          />
        </div>
        
        {/* Filter dropdown placeholder */}
        <select
          style={{
            padding: '6px 12px',
            fontSize: '11px',
            borderRadius: '6px',
            border: `1px solid ${borderColor}`,
            background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
            color: textColor,
            outline: 'none',
            cursor: 'pointer'
          }}
        >
          <option value="all">All</option>
          <option value="recent">Recent</option>
          <option value="attachments">With attachments</option>
        </select>
      </div>
      
      {/* Import Bar for Inbox */}
      {folder === 'inbox' && (
        <InboxImportBar
          theme={theme}
          onNavigateToWRGuard={onNavigateToWRGuard}
        />
      )}
      
      {/* Main Content: Split View */}
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        overflow: 'hidden' 
      }}>
        {/* Left: Message List */}
        <div style={{ 
          width: '45%',
          minWidth: '280px',
          maxWidth: '400px',
          borderRight: `1px solid ${borderColor}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {messages.length === 0 ? (
            renderEmptyState()
          ) : (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {messages.map(msg => (
                <BeapMessageRow
                  key={msg.id}
                  message={msg}
                  isSelected={msg.id === selectedMessageId}
                  theme={theme}
                  onClick={(id) => selectMessage(id)}
                />
              ))}
            </div>
          )}
        </div>
        
        {/* Right: Preview Panel - Folder-specific */}
        {folder === 'outbox' ? (
          <OutboxMessagePreview
            message={selectedMessage?.folder === folder ? selectedMessage : null}
            theme={theme}
            onRetry={handleRetry}
            onCopyPayload={handleCopyPayload}
            onMarkSent={handleMarkSent}
            onDownloadAgain={handleDownloadAgain}
            onMarkDelivered={handleMarkDelivered}
            onOpen={handleOpen}
            onArchive={handleArchive}
          />
        ) : folder === 'inbox' ? (
          <InboxMessagePreview
            message={selectedMessage?.folder === folder ? selectedMessage : null}
            theme={theme}
            onVerify={handleVerify}
            onOpen={handleOpen}
          />
        ) : folder === 'rejected' ? (
          <RejectedMessagePreview
            message={selectedMessage?.folder === folder ? selectedMessage : null}
            theme={theme}
          />
        ) : (
          <BeapMessagePreview
            message={selectedMessage?.folder === folder ? selectedMessage : null}
            folder={folder}
            theme={theme}
            onOpen={handleOpen}
            onAccept={(id) => console.log('[BEAP] Accept:', id)}
            onReject={(id) => console.log('[BEAP] Reject:', id)}
            onRetry={handleRetry}
            onArchive={handleArchive}
            onViewReason={(id) => console.log('[BEAP] View reason:', id)}
          />
        )}
      </div>
    </div>
  )
}

export default BeapMessageListView

