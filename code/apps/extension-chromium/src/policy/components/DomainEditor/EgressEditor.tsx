/**
 * Egress Domain Editor
 * 
 * Visual editor for egress policy settings.
 */

import { useState } from 'react'
import type { EgressPolicy, DataCategory, EgressChannel } from '../../schema'

interface EgressEditorProps {
  policy: EgressPolicy
  onChange: (updated: EgressPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
}

const DATA_CATEGORIES: { value: DataCategory; label: string; description: string; risk: 'low' | 'medium' | 'high' }[] = [
  { value: 'public', label: 'Public', description: 'Publicly available info', risk: 'low' },
  { value: 'internal', label: 'Internal', description: 'Internal organization data', risk: 'low' },
  { value: 'confidential', label: 'Confidential', description: 'Business confidential', risk: 'medium' },
  { value: 'pii', label: 'PII', description: 'Personal identifiable info', risk: 'high' },
  { value: 'financial', label: 'Financial', description: 'Financial/payment data', risk: 'high' },
  { value: 'health', label: 'Health (HIPAA)', description: 'Medical information', risk: 'high' },
  { value: 'credentials', label: 'Credentials', description: 'Passwords, tokens, keys', risk: 'high' },
  { value: 'audit', label: 'Audit Records', description: 'Compliance records', risk: 'medium' },
]

const EGRESS_CHANNELS: { value: EgressChannel; label: string; icon: string }[] = [
  { value: 'email', label: 'Email', icon: '📧' },
  { value: 'api', label: 'API', icon: '🔌' },
  { value: 'webhook', label: 'Webhook', icon: '🪝' },
  { value: 'file_export', label: 'File Export', icon: '📁' },
  { value: 'clipboard', label: 'Clipboard', icon: '📋' },
  { value: 'print', label: 'Print', icon: '🖨️' },
  { value: 'screen_share', label: 'Screen Share', icon: '🖥️' },
  { value: 'messaging', label: 'Messaging', icon: '💬' },
]

export function EgressEditor({ policy, onChange, theme = 'default' }: EgressEditorProps) {
  const [newDestination, setNewDestination] = useState('')
  const [newBlockedDest, setNewBlockedDest] = useState('')

  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const inputBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'

  const toggleDataCategory = (cat: DataCategory) => {
    const current = policy.allowedDataCategories || []
    const updated = current.includes(cat)
      ? current.filter(c => c !== cat)
      : [...current, cat]
    onChange({ ...policy, allowedDataCategories: updated })
  }

  const toggleChannel = (channel: EgressChannel) => {
    const current = policy.allowedChannels || []
    const updated = current.includes(channel)
      ? current.filter(c => c !== channel)
      : [...current, channel]
    onChange({ ...policy, allowedChannels: updated })
  }

  const toggleBoolean = (key: keyof EgressPolicy) => {
    onChange({ ...policy, [key]: !policy[key] })
  }

  const addDestination = (type: 'allowed' | 'blocked') => {
    const value = type === 'allowed' ? newDestination.trim() : newBlockedDest.trim()
    if (!value) return
    
    const key = type === 'allowed' ? 'allowedDestinations' : 'blockedDestinations'
    const current = policy[key] || []
    if (!current.includes(value)) {
      onChange({ ...policy, [key]: [...current, value] })
    }
    
    if (type === 'allowed') {
      setNewDestination('')
    } else {
      setNewBlockedDest('')
    }
  }

  const removeDestination = (type: 'allowed' | 'blocked', value: string) => {
    const key = type === 'allowed' ? 'allowedDestinations' : 'blockedDestinations'
    const current = policy[key] || []
    onChange({ ...policy, [key]: current.filter(d => d !== value) })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Egress Channels */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Allowed Channels
        </h4>
        <p style={{ margin: '0 0 12px', color: mutedColor, fontSize: '13px' }}>
          Select which channels can be used for data egress
        </p>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '8px',
        }}>
          {EGRESS_CHANNELS.map(channel => {
            const isChecked = policy.allowedChannels?.includes(channel.value)
            return (
              <button
                key={channel.value}
                onClick={() => toggleChannel(channel.value)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '16px 12px',
                  background: isChecked ? '#8b5cf620' : inputBg,
                  border: `1px solid ${isChecked ? '#8b5cf6' : borderColor}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: '24px' }}>{channel.icon}</span>
                <span style={{ 
                  fontSize: '12px', 
                  fontWeight: isChecked ? 600 : 400,
                  color: isChecked ? '#8b5cf6' : textColor,
                }}>
                  {channel.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Data Categories */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Allowed Data Categories
        </h4>
        <p style={{ margin: '0 0 12px', color: mutedColor, fontSize: '13px' }}>
          Select which types of data can leave the system
        </p>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '8px',
        }}>
          {DATA_CATEGORIES.map(cat => {
            const isChecked = policy.allowedDataCategories?.includes(cat.value)
            return (
              <label
                key={cat.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px',
                  background: isChecked ? `${getRiskColor(cat.risk)}15` : inputBg,
                  border: `1px solid ${isChecked ? getRiskColor(cat.risk) : borderColor}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleDataCategory(cat.value)}
                  style={{ accentColor: getRiskColor(cat.risk) }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: textColor, fontSize: '13px' }}>
                    {cat.label}
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor }}>
                    {cat.description}
                  </div>
                </div>
                <span style={{
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 600,
                  borderRadius: '4px',
                  background: `${getRiskColor(cat.risk)}20`,
                  color: getRiskColor(cat.risk),
                  textTransform: 'uppercase',
                }}>
                  {cat.risk}
                </span>
              </label>
            )
          })}
        </div>
      </section>

      {/* Destinations */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Destination Controls
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Allowed Destinations */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Allowed Destinations
            </label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                value={newDestination}
                onChange={(e) => setNewDestination(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDestination('allowed')}
                placeholder="*.example.com"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '13px',
                }}
              />
              <button
                onClick={() => addDestination('allowed')}
                style={{
                  padding: '8px 12px',
                  background: '#22c55e',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {policy.allowedDestinations?.map(dest => (
                <span
                  key={dest}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '4px',
                    color: '#22c55e',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {dest}
                  <button
                    onClick={() => removeDestination('allowed', dest)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#22c55e',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '14px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!policy.allowedDestinations || policy.allowedDestinations.length === 0) && (
                <span style={{ color: mutedColor, fontSize: '12px', fontStyle: 'italic' }}>
                  None (all blocked by default)
                </span>
              )}
            </div>
          </div>

          {/* Blocked Destinations */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Blocked Destinations
            </label>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
              <input
                type="text"
                value={newBlockedDest}
                onChange={(e) => setNewBlockedDest(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDestination('blocked')}
                placeholder="*.malware.com"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '13px',
                }}
              />
              <button
                onClick={() => addDestination('blocked')}
                style={{
                  padding: '8px 12px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '6px',
                  color: 'white',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {policy.blockedDestinations?.map(dest => (
                <span
                  key={dest}
                  style={{
                    padding: '4px 8px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px',
                    color: '#ef4444',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {dest}
                  <button
                    onClick={() => removeDestination('blocked', dest)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '14px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {(!policy.blockedDestinations || policy.blockedDestinations.length === 0) && (
                <span style={{ color: mutedColor, fontSize: '12px', fontStyle: 'italic' }}>
                  None configured
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Security Settings */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Security & Compliance
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <ToggleRow
            label="Require Approval"
            description="Human approval before egress"
            checked={policy.requireApproval}
            onChange={() => toggleBoolean('requireApproval')}
            inverted
            theme={theme}
          />
          <ToggleRow
            label="Require Encryption"
            description="Encrypt data in transit"
            checked={policy.requireEncryption}
            onChange={() => toggleBoolean('requireEncryption')}
            inverted
            theme={theme}
          />
          <ToggleRow
            label="Audit All Egress"
            description="Log all data exports"
            checked={policy.auditAllEgress}
            onChange={() => toggleBoolean('auditAllEgress')}
            inverted
            theme={theme}
          />
          <ToggleRow
            label="Redact Sensitive Data"
            description="Auto-redact PII before egress"
            checked={policy.redactSensitiveData}
            onChange={() => toggleBoolean('redactSensitiveData')}
            inverted
            theme={theme}
          />
          <ToggleRow
            label="Allow Bulk Export"
            description="Allow large batch exports (HIGH RISK)"
            checked={policy.allowBulkExport}
            onChange={() => toggleBoolean('allowBulkExport')}
            risk="high"
            theme={theme}
          />
        </div>
      </section>

      {/* Rate Limits */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Rate Limits
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Max Egress Size
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                value={Math.round(policy.maxEgressSizeBytes / 1_000_000)}
                onChange={(e) => onChange({ 
                  ...policy, 
                  maxEgressSizeBytes: parseInt(e.target.value) * 1_000_000 || 0 
                })}
                min={1}
                max={100}
                style={{
                  width: '80px',
                  padding: '8px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '14px',
                }}
              />
              <span style={{ color: mutedColor, fontSize: '13px' }}>MB</span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Max Operations/Hour
            </label>
            <input
              type="number"
              value={policy.maxOperationsPerHour}
              onChange={(e) => onChange({ 
                ...policy, 
                maxOperationsPerHour: parseInt(e.target.value) || 0 
              })}
              min={1}
              max={10000}
              style={{
                width: '100px',
                padding: '8px',
                background: inputBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                color: textColor,
                fontSize: '14px',
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

// Helper components
function ToggleRow({ 
  label, 
  description, 
  checked, 
  onChange, 
  risk = 'low',
  inverted = false,
  theme = 'default',
}: { 
  label: string
  description: string
  checked: boolean
  onChange: () => void
  risk?: 'low' | 'medium' | 'high'
  inverted?: boolean
  theme?: 'default' | 'dark' | 'professional'
}) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'

  // For inverted toggles, OFF is risky. For normal toggles, ON is risky.
  const isRisky = inverted ? !checked : (checked && risk !== 'low')
  const displayRisk = isRisky ? risk : 'low'

  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      background: isRisky && risk !== 'low' ? `${getRiskColor(risk)}10` : 'transparent',
      border: `1px solid ${isRisky && risk !== 'low' ? getRiskColor(risk) : borderColor}`,
      borderRadius: '8px',
      cursor: 'pointer',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, color: textColor, fontSize: '13px' }}>{label}</div>
        <div style={{ fontSize: '12px', color: mutedColor }}>{description}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isRisky && risk !== 'low' && (
          <span style={{
            padding: '2px 6px',
            fontSize: '10px',
            fontWeight: 600,
            borderRadius: '4px',
            background: `${getRiskColor(displayRisk)}20`,
            color: getRiskColor(displayRisk),
            textTransform: 'uppercase',
          }}>
            {displayRisk}
          </span>
        )}
        <div
          onClick={(e) => { e.preventDefault(); onChange(); }}
          style={{
            width: '40px',
            height: '22px',
            borderRadius: '11px',
            background: checked ? '#8b5cf6' : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
            position: 'relative',
            transition: 'background 0.2s ease',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '20px' : '2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: 'white',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>
    </label>
  )
}

function getRiskColor(risk: 'low' | 'medium' | 'high'): string {
  switch (risk) {
    case 'low': return '#22c55e'
    case 'medium': return '#eab308'
    case 'high': return '#ef4444'
  }
}

