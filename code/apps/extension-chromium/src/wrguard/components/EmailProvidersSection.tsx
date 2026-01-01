/**
 * EmailProvidersSection
 * 
 * Configure email providers for BEAP message dispatch and receipt.
 * Moved from WR MailGuard legacy UI.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { useWRGuardStore } from '../useWRGuardStore'
import { PROVIDER_CONFIG, EmailProviderType } from '../types'

interface EmailProvidersSectionProps {
  theme: 'default' | 'dark' | 'professional'
}

export const EmailProvidersSection: React.FC<EmailProvidersSectionProps> = ({ theme }) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  const successColor = '#22c55e'
  const errorColor = '#ef4444'
  const warningColor = '#f59e0b'
  
  const {
    providers,
    addProvider,
    removeProvider,
    connectProvider,
    disconnectProvider,
    setDefaultProvider,
    updateProviderStatus
  } = useWRGuardStore()
  
  const [isAddingProvider, setIsAddingProvider] = useState(false)
  const [newProviderType, setNewProviderType] = useState<EmailProviderType>('gmail')
  const [newProviderEmail, setNewProviderEmail] = useState('')
  const [connectingId, setConnectingId] = useState<string | null>(null)
  
  // =========================================================================
  // Handlers
  // =========================================================================
  
  const handleAddProvider = () => {
    if (!newProviderEmail.trim()) return
    
    const config = PROVIDER_CONFIG[newProviderType]
    
    addProvider({
      type: newProviderType,
      name: `${config.label} - ${newProviderEmail}`,
      email: newProviderEmail.trim(),
      status: 'disconnected',
      isDefault: providers.length === 0
    })
    
    setNewProviderEmail('')
    setIsAddingProvider(false)
  }
  
  const handleConnect = async (id: string) => {
    setConnectingId(id)
    await connectProvider(id)
    setConnectingId(null)
  }
  
  const handleDisconnect = (id: string) => {
    disconnectProvider(id)
  }
  
  const handleRemove = (id: string) => {
    if (confirm('Remove this email provider?')) {
      removeProvider(id)
    }
  }
  
  const handleSetDefault = (id: string) => {
    setDefaultProvider(id)
  }
  
  // =========================================================================
  // Status badge helper
  // =========================================================================
  
  const getStatusBadge = (status: string, error?: string) => {
    const configs = {
      connected: { label: 'Connected', color: successColor, icon: '✓' },
      disconnected: { label: 'Disconnected', color: mutedColor, icon: '○' },
      connecting: { label: 'Connecting...', color: warningColor, icon: '⏳' },
      error: { label: error || 'Error', color: errorColor, icon: '✗' },
      expired: { label: 'Token Expired', color: warningColor, icon: '⚠' }
    }
    
    const config = configs[status as keyof typeof configs] || configs.disconnected
    
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '10px',
        fontWeight: 500,
        padding: '3px 8px',
        borderRadius: '10px',
        color: config.color,
        background: `${config.color}15`
      }}>
        {config.icon} {config.label}
      </span>
    )
  }
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px'
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: textColor }}>
            📧 Email Providers
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: mutedColor }}>
            Configure email providers for BEAP message dispatch and receipt
          </p>
        </div>
        
        <button
          onClick={() => setIsAddingProvider(true)}
          style={{
            padding: '8px 14px',
            fontSize: '12px',
            fontWeight: 500,
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            border: 'none',
            color: 'white',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          + Add Provider
        </button>
      </div>
      
      {/* Add Provider Form */}
      {isAddingProvider && (
        <div style={{
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '12px' }}>
            Add Email Provider
          </div>
          
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            {/* Provider Type */}
            <div style={{ flex: '0 0 150px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
                Provider Type
              </label>
              <select
                value={newProviderType}
                onChange={(e) => setNewProviderType(e.target.value as EmailProviderType)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  outline: 'none'
                }}
              >
                {Object.entries(PROVIDER_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.icon} {config.label}</option>
                ))}
              </select>
            </div>
            
            {/* Email Address */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
                Email Address
              </label>
              <input
                type="email"
                value={newProviderEmail}
                onChange={(e) => setNewProviderEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '12px',
                  background: isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  outline: 'none'
                }}
              />
            </div>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={() => setIsAddingProvider(false)}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                color: textColor,
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddProvider}
              disabled={!newProviderEmail.trim()}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                background: newProviderEmail.trim() ? successColor : mutedColor,
                border: 'none',
                color: 'white',
                borderRadius: '6px',
                cursor: newProviderEmail.trim() ? 'pointer' : 'not-allowed'
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
      
      {/* Provider List */}
      {providers.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          background: cardBg,
          border: `1px solid ${borderColor}`,
          borderRadius: '10px'
        }}>
          <span style={{ fontSize: '40px', display: 'block', marginBottom: '12px' }}>📧</span>
          <div style={{ fontSize: '14px', fontWeight: 500, color: textColor, marginBottom: '4px' }}>
            No Email Providers
          </div>
          <div style={{ fontSize: '12px', color: mutedColor }}>
            Add an email provider to send and receive BEAP messages
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {providers.map(provider => {
            const config = PROVIDER_CONFIG[provider.type]
            const isConnecting = connectingId === provider.id
            
            return (
              <div
                key={provider.id}
                style={{
                  background: cardBg,
                  border: `1px solid ${provider.isDefault ? '#8b5cf6' : borderColor}`,
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px'
                }}
              >
                {/* Icon */}
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: `${config.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px'
                }}>
                  {config.icon}
                </div>
                
                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
                      {provider.email}
                    </span>
                    {provider.isDefault && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(139,92,246,0.15)',
                        color: '#8b5cf6'
                      }}>
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                    {config.label}
                    {provider.lastConnected && (
                      <span> • Last connected: {new Date(provider.lastConnected).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                
                {/* Status */}
                {getStatusBadge(provider.status, provider.error)}
                
                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {provider.status === 'connected' ? (
                    <button
                      onClick={() => handleDisconnect(provider.id)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '11px',
                        background: 'transparent',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '5px',
                        cursor: 'pointer'
                      }}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(provider.id)}
                      disabled={isConnecting}
                      style={{
                        padding: '6px 10px',
                        fontSize: '11px',
                        background: successColor,
                        border: 'none',
                        color: 'white',
                        borderRadius: '5px',
                        cursor: isConnecting ? 'wait' : 'pointer',
                        opacity: isConnecting ? 0.7 : 1
                      }}
                    >
                      {isConnecting ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                  
                  {!provider.isDefault && provider.status === 'connected' && (
                    <button
                      onClick={() => handleSetDefault(provider.id)}
                      style={{
                        padding: '6px 10px',
                        fontSize: '11px',
                        background: 'transparent',
                        border: `1px solid ${borderColor}`,
                        color: textColor,
                        borderRadius: '5px',
                        cursor: 'pointer'
                      }}
                    >
                      Set Default
                    </button>
                  )}
                  
                  <button
                    onClick={() => handleRemove(provider.id)}
                    style={{
                      padding: '6px 10px',
                      fontSize: '11px',
                      background: 'transparent',
                      border: `1px solid ${errorColor}30`,
                      color: errorColor,
                      borderRadius: '5px',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

