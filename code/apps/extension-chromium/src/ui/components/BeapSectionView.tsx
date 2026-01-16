/**
 * BEAP Section View Component
 * 
 * Renders the appropriate UI for each BEAP Packages section.
 * This component is reused across all view modes (docked, app, admin).
 * 
 * @version 1.0.0
 */

import React, { useState, useRef } from 'react'
import { usePackageStore, PackageList, acceptPendingPackage, rejectPendingPackage } from '../../packages'
import { useBeapBuilder, DeliveryOptions, deliverPackage, type DeliveryConfig } from '../../beap-builder'
import { PackageBuilderPolicy } from '../../policy/components/PackageBuilderPolicy'
import type { CanonicalPolicy } from '../../policy/schema'
import { BeapMessageListView } from '../../beap-messages'

export type BeapSection = 'inbox' | 'drafts' | 'outbox' | 'archive' | 'rejected'

interface BeapSectionViewProps {
  section: BeapSection
  theme: 'default' | 'dark' | 'professional'
  emailAccounts: { id?: string; email: string; provider?: string; status?: string }[]
  onNotification: (message: string, type: 'success' | 'error' | 'info') => void
}

export function BeapSectionView({ 
  section, 
  theme, 
  emailAccounts,
  onNotification 
}: BeapSectionViewProps) {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.04)'
  
  // Drafts compose state
  const [composeTo, setComposeTo] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; size: number; file: File }[]>([])
  const [capsulePolicy, setCapsulePolicy] = useState<CanonicalPolicy | null>(null)
  const [deliveryConfig, setDeliveryConfig] = useState<DeliveryConfig | null>(null)
  const [bodyHeight, setBodyHeight] = useState(150)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const resizeStartY = useRef(0)
  const resizeStartH = useRef(150)
  const [isResizing, setIsResizing] = useState(false)
  
  const beapBuilder = useBeapBuilder()
  const packageStore = usePackageStore.getState()
  
  // Handle mouse move for resize
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const delta = e.clientY - resizeStartY.current
      const newHeight = Math.max(80, Math.min(400, resizeStartH.current + delta))
      setBodyHeight(newHeight)
    }
    const handleMouseUp = () => setIsResizing(false)
    
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])
  
  // Get packages for current section
  const packages = packageStore.getPackagesForSection(section)
  const draftPackages = packageStore.getPackagesForSection('drafts')
  
  // Clear compose form
  const clearCompose = () => {
    setComposeTo('')
    setComposeSubject('')
    setComposeBody('')
    setAttachments([])
    setCapsulePolicy(null)
    setDeliveryConfig(null)
  }
  
  // Save as draft
  const handleSaveDraft = () => {
    if (!composeTo && !composeSubject && !composeBody) return
    
    packageStore.createDraft({
      capsule_ref: null,
      envelope_ref: null,
      handshake_id: null,
      sender_fingerprint: composeTo,
      sender_name: null,
      subject: composeSubject,
      preview: composeBody.slice(0, 200),
      executed_at: null,
      rejected_at: null,
      rejected_reason: null,
      policy_id: null,
      attachments_count: attachments.length
    })
    onNotification('Draft saved', 'success')
    clearCompose()
  }
  
  // Send package
  const handleSend = async () => {
    if (!composeTo.trim()) {
      onNotification('Please enter a recipient', 'error')
      return
    }
    if (!composeSubject.trim()) {
      onNotification('Please enter a subject', 'error')
      return
    }
    
    const config = deliveryConfig || {
      method: 'email' as const,
      email: {
        to: [composeTo],
        accountId: emailAccounts[0]?.id || emailAccounts[0]?.email || ''
      }
    }
    
    const buildResult = await beapBuilder.buildSilent({
      content: composeBody,
      contentType: 'text',
      target: composeTo,
      subject: composeSubject
    })
    
    if (buildResult.success) {
      const deliveryResult = await deliverPackage(
        buildResult,
        config,
        composeSubject,
        composeBody
      )
      
      if (deliveryResult.success) {
        const methodLabel = config.method === 'email' ? 'Email sent'
          : config.method === 'messenger' ? 'Copied to clipboard'
          : 'Download started'
        onNotification(`✓ ${methodLabel} successfully`, 'success')
        clearCompose()
      } else {
        onNotification(deliveryResult.error || 'Delivery failed', 'error')
      }
    } else {
      onNotification(buildResult.error || 'Build failed', 'error')
    }
  }
  
  // INBOX VIEW - using new BeapMessageListView
  if (section === 'inbox') {
    return (
      <BeapMessageListView
        folder="inbox"
        theme={theme}
        onImport={() => onNotification('Import feature coming soon', 'info')}
      />
    )
  }
  
  // OUTBOX VIEW - using new BeapMessageListView
  if (section === 'outbox') {
    return (
      <BeapMessageListView
        folder="outbox"
        theme={theme}
      />
    )
  }
  
  // ARCHIVE VIEW - using new BeapMessageListView
  if (section === 'archive') {
    return (
      <BeapMessageListView
        folder="archived"
        theme={theme}
      />
    )
  }
  
  // REJECTED VIEW - using new BeapMessageListView
  if (section === 'rejected') {
    return (
      <BeapMessageListView
        folder="rejected"
        theme={theme}
      />
    )
  }
  
  // DRAFTS VIEW (default / fallback)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflowY: 'auto' }}>
      <style>{`
        .beap-input::placeholder, .beap-textarea::placeholder {
          color: ${mutedColor};
          opacity: 1;
        }
      `}</style>
      
      {/* Saved Drafts List */}
      {draftPackages.length > 0 && (
        <div style={{ 
          padding: '12px 16px', 
          borderBottom: `1px solid ${borderColor}`,
          background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.08)'
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            📝 Saved Drafts ({draftPackages.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {draftPackages.slice(0, 3).map(pkg => (
              <div 
                key={pkg.package_id} 
                onClick={() => {
                  setComposeTo(pkg.sender_fingerprint || '')
                  setComposeSubject(pkg.subject || '')
                  setComposeBody(pkg.preview || '')
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: isProfessional ? 'white' : 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.1)'}`,
                  cursor: 'pointer'
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {pkg.subject || '(No subject)'}
                  </div>
                  <div style={{ fontSize: '10px', color: mutedColor, marginTop: '2px' }}>
                    {new Date(pkg.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <span style={{ fontSize: '12px', color: isProfessional ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
              </div>
            ))}
            {draftPackages.length > 3 && (
              <div style={{ fontSize: '11px', color: isProfessional ? '#3b82f6' : '#60a5fa', textAlign: 'center', padding: '4px 0', cursor: 'pointer' }}>
                View all {draftPackages.length} drafts
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Compose Helper */}
      {!composeTo && !composeSubject && !composeBody && attachments.length === 0 && (
        <div style={{ 
          padding: '16px 18px', 
          fontSize: '13px', 
          opacity: 0.7, 
          fontStyle: 'italic', 
          borderBottom: `1px solid ${borderColor}`, 
          background: isProfessional ? 'rgba(168,85,247,0.08)' : 'rgba(168,85,247,0.15)', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px' 
        }}>
          <span style={{ fontSize: '18px' }}>✉️</span>
          Compose BEAP™ packages with verified delivery and built-in automation.
        </div>
      )}
      
      {/* Compose Form */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
        {/* Header Fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '14px', borderBottom: `1px solid ${borderColor}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', opacity: 0.7, minWidth: '60px' }}>To:</label>
            <input 
              type="email" 
              className="beap-input"
              value={composeTo} 
              onChange={(e) => setComposeTo(e.target.value)} 
              placeholder="recipient@example.com" 
              style={{ 
                flex: 1, 
                background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)', 
                border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.15)'}`, 
                color: textColor, 
                borderRadius: '6px', 
                padding: '10px 14px', 
                fontSize: '14px', 
                outline: 'none' 
              }} 
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ fontSize: '13px', fontWeight: '600', opacity: 0.7, minWidth: '60px' }}>Subject:</label>
            <input 
              type="text" 
              className="beap-input"
              value={composeSubject} 
              onChange={(e) => setComposeSubject(e.target.value)} 
              placeholder="Email subject" 
              style={{ 
                flex: 1, 
                background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)', 
                border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.15)'}`, 
                color: textColor, 
                borderRadius: '6px', 
                padding: '10px 14px', 
                fontSize: '14px', 
                outline: 'none' 
              }} 
            />
          </div>
        </div>
        
        {/* Body */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <textarea 
            className="beap-textarea"
            value={composeBody} 
            onChange={(e) => setComposeBody(e.target.value)} 
            placeholder="Compose your message here...

Write your message with the confidence that it will be protected by WRGuard encryption and verification." 
            style={{ 
              background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.06)', 
              border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.12)'}`, 
              color: textColor, 
              borderRadius: '8px', 
              padding: '14px 16px', 
              fontSize: '14px', 
              lineHeight: '1.6',
              height: `${bodyHeight}px`, 
              resize: 'none', 
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 
              outline: 'none'
            }} 
          />
          <div 
            onMouseDown={(e) => {
              e.preventDefault()
              resizeStartY.current = e.clientY
              resizeStartH.current = bodyHeight
              setIsResizing(true)
            }}
            style={{ 
              height: '12px', 
              background: isProfessional ? 'linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%)' : 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.1) 100%)', 
              cursor: 'ns-resize', 
              borderRadius: '6px', 
              margin: '8px 0', 
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.15)'}`
            }}
            title="Drag to resize editor height"
          >
            <div style={{ width: '40px', height: '4px', background: isProfessional ? '#94a3b8' : 'rgba(255,255,255,0.4)', borderRadius: '2px' }} />
          </div>
        </div>
        
        {/* Attachments */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', opacity: 0.7, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📎</span> Attachments
              <span style={{ fontSize: '10px', opacity: 0.6, fontWeight: '400' }}>(WR Stamped PDFs only)</span>
            </span>
            <input 
              ref={fileInputRef} 
              type="file" 
              accept=".pdf" 
              multiple 
              style={{ display: 'none' }} 
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                const pdfFiles = files.filter(f => f.type === 'application/pdf')
                if (pdfFiles.length !== files.length) {
                  onNotification('Only PDF files are allowed', 'error')
                }
                if (pdfFiles.length > 0) {
                  setAttachments(prev => [...prev, ...pdfFiles.map(f => ({ name: f.name, size: f.size, file: f }))])
                }
                if (e.target) e.target.value = ''
              }} 
            />
            <button 
              onClick={() => fileInputRef.current?.click()} 
              style={{ 
                background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.12)', 
                border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.2)'}`, 
                color: textColor, 
                borderRadius: '6px', 
                padding: '8px 14px', 
                fontSize: '12px', 
                fontWeight: '500', 
                cursor: 'pointer' 
              }}
            >
              + Add PDF
            </button>
          </div>
          {attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
              {attachments.map((att, idx) => (
                <div key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: isProfessional ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px', fontSize: '12px' }}>
                  <span>📄</span>
                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                  <span style={{ opacity: 0.5, fontSize: '11px' }}>({(att.size / 1024).toFixed(0)} KB)</span>
                  <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'transparent', border: 'none', color: mutedColor, borderRadius: '4px', width: '18px', height: '18px', cursor: 'pointer', fontSize: '14px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Policy Builder */}
      <div style={{ padding: '16px 18px', borderTop: `1px solid ${borderColor}` }}>
        <PackageBuilderPolicy
          initialPolicy={capsulePolicy || undefined}
          onPolicyChange={setCapsulePolicy}
          theme={theme}
          compact={false}
        />
      </div>
      
      {/* Delivery Options */}
      <div style={{ padding: '16px 18px', borderTop: `1px solid ${isProfessional ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'}` }}>
        <DeliveryOptions
          config={deliveryConfig}
          onConfigChange={setDeliveryConfig}
          connectedAccounts={emailAccounts.map(acc => ({ id: acc.id || acc.email, email: acc.email, provider: acc.provider || 'Gmail' }))}
          theme={theme}
        />
      </div>
      
      {/* Action Buttons */}
      <div style={{ 
        padding: '14px 18px', 
        borderTop: `1px solid ${isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.15)'}`, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: isProfessional ? '#f1f5f9' : 'rgba(0,0,0,0.15)' 
      }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={clearCompose} style={{ background: 'transparent', border: 'none', color: mutedColor, padding: '8px 0', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }}>Discard</button>
          <button 
            onClick={handleSaveDraft}
            disabled={!composeTo && !composeSubject && !composeBody}
            style={{ 
              background: 'transparent', 
              border: `1px solid ${isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.2)'}`, 
              color: isProfessional ? '#475569' : 'rgba(255,255,255,0.7)', 
              padding: '6px 12px', 
              borderRadius: '6px',
              fontSize: '12px', 
              fontWeight: 500,
              cursor: (!composeTo && !composeSubject && !composeBody) ? 'not-allowed' : 'pointer',
              opacity: (!composeTo && !composeSubject && !composeBody) ? 0.5 : 1
            }}
          >
            💾 Save Draft
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => beapBuilder.openBuilder({
              source: 'drafts',
              target: composeTo,
              subject: composeSubject,
              body: composeBody,
              attachments: attachments.map(a => ({
                id: crypto.randomUUID(),
                name: a.name,
                type: a.file.type,
                size: a.size,
                dataRef: URL.createObjectURL(a.file),
                isMedia: a.file.type.startsWith('image/') || a.file.type.startsWith('video/') || a.file.type.startsWith('audio/')
              }))
            })}
            title="Customize package permissions and automation rules"
            style={{ 
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
              border: 'none', 
              borderRadius: '8px', 
              color: 'white', 
              padding: '10px 16px', 
              fontSize: '13px', 
              fontWeight: '600', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            📦 BEAP™ Builder
          </button>
          <button 
            onClick={handleSend}
            disabled={!composeTo.trim() || !composeSubject.trim()} 
            style={{ 
              background: (!composeTo.trim() || !composeSubject.trim()) 
                ? (isProfessional ? '#e2e8f0' : '#374151') 
                : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', 
              border: 'none', 
              color: (!composeTo.trim() || !composeSubject.trim()) 
                ? (isProfessional ? '#94a3b8' : '#6b7280') 
                : 'white', 
              borderRadius: '8px', 
              padding: '10px 20px', 
              fontSize: '14px', 
              fontWeight: '600', 
              cursor: (!composeTo.trim() || !composeSubject.trim()) ? 'not-allowed' : 'pointer', 
              boxShadow: (!composeTo.trim() || !composeSubject.trim()) ? 'none' : '0 2px 8px rgba(34,197,94,0.4)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px' 
            }}
          >
            Send <span style={{ fontSize: '14px' }}>→</span>
          </button>
        </div>
      </div>
    </div>
  )
}



