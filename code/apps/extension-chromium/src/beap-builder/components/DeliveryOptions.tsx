/**
 * Delivery Options Component
 * 
 * Renders the external delivery configuration UI for Drafts.
 * This is the ONLY place where Email/Messenger/Download delivery is configured.
 * Reuses the former WR MailGuard UX.
 * 
 * INVARIANTS:
 * - External delivery is NOT available in WR Chat
 * - Only available in Drafts section of BEAP Packages
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import type { DeliveryConfig, DeliveryMethod } from '../types'

interface DeliveryOptionsProps {
  config: DeliveryConfig | null
  onConfigChange: (config: DeliveryConfig) => void
  connectedAccounts?: { id: string; email: string; provider: string }[]
  theme?: 'default' | 'dark' | 'professional'
}

const DELIVERY_METHODS: { id: DeliveryMethod; label: string; icon: string; description: string }[] = [
  {
    id: 'email',
    label: 'Send via Email',
    icon: '📧',
    description: 'Deliver package through connected email account'
  },
  {
    id: 'messenger',
    label: 'Insert into Messenger',
    icon: '💬',
    description: 'Insert package into external messaging app'
  },
  {
    id: 'download',
    label: 'Download',
    icon: '💾',
    description: 'Save package as file for USB, wallet, or offline delivery'
  }
]

export function DeliveryOptions({
  config,
  onConfigChange,
  connectedAccounts = [],
  theme = 'default'
}: DeliveryOptionsProps) {
  const [selectedMethod, setSelectedMethod] = useState<DeliveryMethod>(config?.method || 'email')
  
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'
  const selectedBg = isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.08)'
  const selectedBorder = isDark ? 'rgba(139, 92, 246, 0.5)' : 'rgba(139, 92, 246, 0.3)'
  
  const handleMethodSelect = (method: DeliveryMethod) => {
    setSelectedMethod(method)
    
    // Initialize config for the selected method
    if (method === 'email') {
      onConfigChange({
        method: 'email',
        email: {
          to: [],
          accountId: connectedAccounts[0]?.id || ''
        }
      })
    } else if (method === 'messenger') {
      onConfigChange({
        method: 'messenger',
        messenger: {
          platform: 'whatsapp',
          recipient: '',
          insertMethod: 'copy'
        }
      })
    } else if (method === 'download') {
      onConfigChange({
        method: 'download',
        download: {
          format: 'file'
        }
      })
    }
  }
  
  return (
    <div>
      {/* Delivery Method Selection */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
          Delivery Method
        </label>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {DELIVERY_METHODS.map(method => (
            <button
              key={method.id}
              onClick={() => handleMethodSelect(method.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 14px',
                background: selectedMethod === method.id ? selectedBg : cardBg,
                border: `1px solid ${selectedMethod === method.id ? selectedBorder : borderColor}`,
                borderRadius: '10px',
                cursor: 'pointer',
                textAlign: 'left'
              }}
            >
              <span style={{ fontSize: '20px' }}>{method.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
                  {method.label}
                </div>
                <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                  {method.description}
                </div>
              </div>
              {selectedMethod === method.id && (
                <span style={{ fontSize: '14px', color: '#8b5cf6' }}>✓</span>
              )}
            </button>
          ))}
        </div>
      </div>
      
      {/* Email Configuration */}
      {selectedMethod === 'email' && (
        <div style={{
          padding: '14px',
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px' }}>
              Send From Account
            </label>
            {connectedAccounts.length > 0 ? (
              <select
                value={config?.email?.accountId || ''}
                onChange={(e) => onConfigChange({
                  method: 'email',
                  email: { ...config?.email!, accountId: e.target.value }
                })}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: isDark ? 'rgba(0, 0, 0, 0.2)' : 'white',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  outline: 'none'
                }}
              >
                {connectedAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.email} ({acc.provider})
                  </option>
                ))}
              </select>
            ) : (
              <div style={{
                padding: '10px',
                background: isDark ? 'rgba(251, 146, 60, 0.1)' : 'rgba(251, 146, 60, 0.05)',
                border: '1px solid rgba(251, 146, 60, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#fb923c'
              }}>
                ⚠️ No email accounts connected. Go to WRGuard → Provider Setup to connect an account.
              </div>
            )}
          </div>
          
          <div style={{ fontSize: '11px', color: mutedColor, fontStyle: 'italic' }}>
            Recipient is specified in the package details above.
          </div>
        </div>
      )}
      
      {/* Messenger Configuration */}
      {selectedMethod === 'messenger' && (
        <div style={{
          padding: '14px',
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px' }}>
              Platform
            </label>
            <select
              value={config?.messenger?.platform || 'whatsapp'}
              onChange={(e) => onConfigChange({
                method: 'messenger',
                messenger: { ...config?.messenger!, platform: e.target.value as any }
              })}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: '12px',
                background: isDark ? 'rgba(0, 0, 0, 0.2)' : 'white',
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                color: textColor,
                outline: 'none'
              }}
            >
              <option value="whatsapp">WhatsApp Web</option>
              <option value="signal">Signal Desktop</option>
              <option value="telegram">Telegram Web</option>
              <option value="slack">Slack</option>
              <option value="teams">Microsoft Teams</option>
              <option value="other">Other</option>
            </select>
          </div>
          
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px' }}>
              Insert Method
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => onConfigChange({
                  method: 'messenger',
                  messenger: { ...config?.messenger!, insertMethod: 'copy' }
                })}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: '11px',
                  background: config?.messenger?.insertMethod === 'copy' ? selectedBg : 'transparent',
                  border: `1px solid ${config?.messenger?.insertMethod === 'copy' ? selectedBorder : borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  cursor: 'pointer'
                }}
              >
                📋 Copy to Clipboard
              </button>
              <button
                onClick={() => onConfigChange({
                  method: 'messenger',
                  messenger: { ...config?.messenger!, insertMethod: 'inject' }
                })}
                style={{
                  flex: 1,
                  padding: '8px',
                  fontSize: '11px',
                  background: config?.messenger?.insertMethod === 'inject' ? selectedBg : 'transparent',
                  border: `1px solid ${config?.messenger?.insertMethod === 'inject' ? selectedBorder : borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  cursor: 'pointer'
                }}
              >
                ⚡ Direct Inject
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Download Configuration */}
      {selectedMethod === 'download' && (
        <div style={{
          padding: '14px',
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px'
        }}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px' }}>
              Download Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { id: 'file', label: '📄 File', desc: 'Standard file download' },
                { id: 'usb', label: '🔌 USB Ready', desc: 'Formatted for USB transfer' },
                { id: 'wallet', label: '💼 Wallet', desc: 'For crypto wallet storage' },
                { id: 'offline', label: '📴 Offline', desc: 'Self-contained offline package' }
              ].map(format => (
                <button
                  key={format.id}
                  onClick={() => onConfigChange({
                    method: 'download',
                    download: { format: format.id as any }
                  })}
                  style={{
                    padding: '10px',
                    fontSize: '11px',
                    background: config?.download?.format === format.id ? selectedBg : 'transparent',
                    border: `1px solid ${config?.download?.format === format.id ? selectedBorder : borderColor}`,
                    borderRadius: '6px',
                    color: textColor,
                    cursor: 'pointer',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{format.label}</div>
                  <div style={{ fontSize: '10px', color: mutedColor, marginTop: '2px' }}>
                    {format.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}



