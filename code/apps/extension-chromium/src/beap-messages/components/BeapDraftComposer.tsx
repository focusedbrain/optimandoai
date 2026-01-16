/**
 * BeapDraftComposer Component
 * 
 * Full BEAP™ draft composition UI with compose fields,
 * attachments, and delivery options. Mirrors the docked sidepanel functionality.
 * 
 * @version 1.0.0
 */

import React, { useState, useRef } from 'react'
import { useBeapMessagesStore } from '../useBeapMessagesStore'
import type { BeapMessageUI, BeapAttachment } from '../types'

interface BeapDraftComposerProps {
  theme: 'default' | 'dark' | 'professional'
  onNotification?: (message: string, type: 'success' | 'error' | 'info') => void
}

export const BeapDraftComposer: React.FC<BeapDraftComposerProps> = ({
  theme,
  onNotification = (msg, type) => console.log(`[${type}] ${msg}`)
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.04)'
  const inputBg = isProfessional ? 'white' : 'rgba(255,255,255,0.08)'
  
  // Compose state
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [attachments, setAttachments] = useState<BeapAttachment[]>([])
  const [isSending, setIsSending] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Delivery method options
  const [deliveryMethod, setDeliveryMethod] = useState<'email' | 'download' | 'messenger'>('email')
  
  const addOutboxMessage = useBeapMessagesStore(state => state.addOutboxMessage)
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    const newAttachments = Array.from(files).map(file => ({
      name: file.name,
      size: file.size
    }))
    setAttachments(prev => [...prev, ...newAttachments])
  }
  
  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }
  
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  const handleSend = async () => {
    if (deliveryMethod !== 'download' && !composeTo.trim()) {
      onNotification('Please enter a recipient', 'error')
      return
    }
    if (!composeBody.trim()) {
      onNotification('Please enter a message', 'error')
      return
    }
    
    setIsSending(true)
    try {
      // Create a BEAP message and add to outbox
      const message: BeapMessageUI = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        folder: 'outbox',
        fingerprint: `FP-${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
        deliveryMethod,
        title: composeSubject || '(No Subject)',
        timestamp: Date.now(),
        bodyText: composeBody,
        attachments: attachments,
        status: deliveryMethod === 'download' ? 'downloaded' : 'pending',
        direction: 'outbound',
        senderName: composeTo || 'Download',
        deliveryStatus: deliveryMethod === 'download' ? 'downloaded' : 'pending'
      }
      
      addOutboxMessage(message)
      
      const actionText = deliveryMethod === 'download' ? 'Package created!' : 'Message queued for delivery!'
      onNotification(`BEAP™ ${actionText}`, 'success')
      
      // Clear form
      setComposeTo('')
      setComposeSubject('')
      setComposeBody('')
      setAttachments([])
    } catch (err) {
      onNotification(err instanceof Error ? err.message : 'Failed to send message', 'error')
    } finally {
      setIsSending(false)
    }
  }
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      flex: 1, 
      background: bgColor, 
      overflowY: 'auto' 
    }}>
      <style>{`
        .beap-input::placeholder, .beap-textarea::placeholder {
          color: ${mutedColor};
          opacity: 1;
        }
      `}</style>
      
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: `1px solid ${borderColor}`,
        background: isProfessional ? 'white' : 'rgba(255,255,255,0.05)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <span style={{ fontSize: '18px' }}>✏️</span>
        <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>Compose BEAP™ Message</span>
      </div>
      
      {/* Form */}
      <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
        {/* Delivery Method */}
        <div>
          <label style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            color: mutedColor, 
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '6px',
            display: 'block'
          }}>
            Delivery Method
          </label>
          <select
            value={deliveryMethod}
            onChange={(e) => setDeliveryMethod(e.target.value as 'email' | 'download' | 'messenger')}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: textColor,
              fontSize: '13px'
            }}
          >
            <option value="email" style={{ background: isProfessional ? 'white' : '#1f2937' }}>📧 Email</option>
            <option value="download" style={{ background: isProfessional ? 'white' : '#1f2937' }}>💾 Download (USB/Wallet)</option>
            <option value="messenger" style={{ background: isProfessional ? 'white' : '#1f2937' }}>💬 Messenger</option>
          </select>
        </div>
        
        {/* To Field */}
        {deliveryMethod !== 'download' && (
          <div>
            <label style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              color: mutedColor, 
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '6px',
              display: 'block'
            }}>
              To
            </label>
            <input
              type="email"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="recipient@example.com"
              className="beap-input"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: inputBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '8px',
                color: textColor,
                fontSize: '13px',
                boxSizing: 'border-box'
              }}
            />
          </div>
        )}
        
        {/* Subject Field */}
        <div>
          <label style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            color: mutedColor, 
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '6px',
            display: 'block'
          }}>
            Subject
          </label>
          <input
            type="text"
            value={composeSubject}
            onChange={(e) => setComposeSubject(e.target.value)}
            placeholder="Message subject..."
            className="beap-input"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: textColor,
              fontSize: '13px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        
        {/* Body Field */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '120px' }}>
          <label style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            color: mutedColor, 
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '6px',
            display: 'block'
          }}>
            Message
          </label>
          <textarea
            value={composeBody}
            onChange={(e) => setComposeBody(e.target.value)}
            placeholder="Write your BEAP™ message here..."
            className="beap-textarea"
            style={{
              flex: 1,
              minHeight: '120px',
              padding: '10px 12px',
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: textColor,
              fontSize: '13px',
              lineHeight: 1.5,
              resize: 'vertical',
              boxSizing: 'border-box'
            }}
          />
        </div>
        
        {/* Attachments */}
        <div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: '8px'
          }}>
            <label style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              color: mutedColor, 
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Attachments ({attachments.length})
            </label>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '4px 10px',
                background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
                border: 'none',
                borderRadius: '4px',
                color: isProfessional ? '#7c3aed' : '#c4b5fd',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              📎 Add File
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          {attachments.length > 0 && (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '4px',
              padding: '8px',
              background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px'
            }}>
              {attachments.map((att, i) => (
                <div 
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    background: inputBg,
                    borderRadius: '4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px' }}>📄</span>
                    <span style={{ fontSize: '12px', color: textColor }}>{att.name}</span>
                    <span style={{ fontSize: '10px', color: mutedColor }}>({formatFileSize(att.size)})</span>
                  </div>
                  <button
                    onClick={() => removeAttachment(i)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: mutedColor,
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '0 4px'
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Info */}
        <div style={{
          padding: '10px 12px',
          background: isProfessional ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
          borderRadius: '8px',
          fontSize: '11px',
          color: mutedColor
        }}>
          💡 Your message will be packaged as a secure BEAP™ capsule with envelope verification.
        </div>
      </div>
      
      {/* Footer Actions */}
      <div style={{ 
        padding: '12px 16px', 
        borderTop: `1px solid ${borderColor}`,
        display: 'flex',
        gap: '10px',
        justifyContent: 'flex-end'
      }}>
        <button
          onClick={handleSend}
          disabled={isSending || !composeBody.trim() || (deliveryMethod !== 'download' && !composeTo.trim())}
          style={{
            padding: '10px 20px',
            background: isSending ? 'rgba(139,92,246,0.5)' : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '13px',
            fontWeight: 600,
            cursor: isSending ? 'not-allowed' : 'pointer',
            opacity: (!composeBody.trim() || (deliveryMethod !== 'download' && !composeTo.trim())) ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          {isSending ? '⏳ Processing...' : deliveryMethod === 'download' ? '💾 Create Package' : '📤 Send Message'}
        </button>
      </div>
    </div>
  )
}

export default BeapDraftComposer
