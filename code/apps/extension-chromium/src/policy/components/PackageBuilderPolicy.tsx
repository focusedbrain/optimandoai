/**
 * Package Builder Policy Component
 * 
 * Capsule Ask Policy (CAP) editor for WR MailGuard package builder.
 * Allows senders to define what permissions they're requesting.
 */

import { useState } from 'react'
import type { CanonicalPolicy, ArtefactType, EgressChannel, DataCategory } from '../schema'
import { createDefaultPolicy, calculateRiskTier } from '../schema'
import { RiskLabel } from './RiskLabel'

interface PackageBuilderPolicyProps {
  capsuleId?: string
  initialPolicy?: CanonicalPolicy
  onPolicyChange: (policy: CanonicalPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
  compact?: boolean
}

// Quick permission presets
const PERMISSION_PRESETS = [
  {
    id: 'read-only',
    name: 'Read Only',
    icon: '👁️',
    description: 'View text content only',
    ingress: ['text', 'markdown'] as ArtefactType[],
    egress: [] as EgressChannel[],
    dataCategories: ['public'] as DataCategory[],
  },
  {
    id: 'interactive',
    name: 'Interactive',
    icon: '💬',
    description: 'View content and respond via email',
    ingress: ['text', 'markdown', 'html_sanitized'] as ArtefactType[],
    egress: ['email'] as EgressChannel[],
    dataCategories: ['public', 'internal'] as DataCategory[],
  },
  {
    id: 'data-exchange',
    name: 'Data Exchange',
    icon: '🔄',
    description: 'Full data exchange capabilities',
    ingress: ['text', 'markdown', 'html_sanitized', 'structured_data'] as ArtefactType[],
    egress: ['email', 'api', 'file_export'] as EgressChannel[],
    dataCategories: ['public', 'internal', 'confidential'] as DataCategory[],
  },
]

export function PackageBuilderPolicy({
  capsuleId,
  initialPolicy,
  onPolicyChange,
  theme = 'default',
  compact = false,
}: PackageBuilderPolicyProps) {
  const [policy, setPolicy] = useState<CanonicalPolicy>(() => {
    if (initialPolicy) return initialPolicy
    const cap = createDefaultPolicy('capsule', 'Capsule Ask Policy')
    cap.ingress = {
      ...cap.ingress!,
      allowedArtefactTypes: ['text', 'markdown'],
    }
    cap.egress = {
      ...cap.egress!,
      allowedChannels: [],
      allowedDataCategories: ['public'],
    }
    return cap
  })

  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'

  const applyPreset = (presetId: string) => {
    const preset = PERMISSION_PRESETS.find(p => p.id === presetId)
    if (!preset) return

    const updated: CanonicalPolicy = {
      ...policy,
      updatedAt: Date.now(),
      ingress: {
        ...policy.ingress!,
        allowedArtefactTypes: preset.ingress,
      },
      egress: {
        ...policy.egress!,
        allowedChannels: preset.egress,
        allowedDataCategories: preset.dataCategories,
      },
    }

    updated.riskTier = calculateRiskTier(updated)
    setPolicy(updated)
    setSelectedPreset(presetId)
    onPolicyChange(updated)
  }

  const toggleArtefactType = (type: ArtefactType) => {
    const current = policy.ingress?.allowedArtefactTypes || []
    const updated = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type]
    
    const newPolicy = {
      ...policy,
      updatedAt: Date.now(),
      ingress: {
        ...policy.ingress!,
        allowedArtefactTypes: updated,
      },
    }
    newPolicy.riskTier = calculateRiskTier(newPolicy)
    setPolicy(newPolicy)
    setSelectedPreset(null)
    onPolicyChange(newPolicy)
  }

  const toggleChannel = (channel: EgressChannel) => {
    const current = policy.egress?.allowedChannels || []
    const updated = current.includes(channel)
      ? current.filter(c => c !== channel)
      : [...current, channel]
    
    const newPolicy = {
      ...policy,
      updatedAt: Date.now(),
      egress: {
        ...policy.egress!,
        allowedChannels: updated,
      },
    }
    newPolicy.riskTier = calculateRiskTier(newPolicy)
    setPolicy(newPolicy)
    setSelectedPreset(null)
    onPolicyChange(newPolicy)
  }

  const riskTier = calculateRiskTier(policy)

  if (compact) {
    return (
      <div style={{
        padding: '12px',
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: '8px',
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
            📋 Permissions Request
          </span>
          <RiskLabel tier={riskTier} size="sm" />
        </div>
        
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {PERMISSION_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              style={{
                padding: '8px 12px',
                background: selectedPreset === preset.id ? '#8b5cf620' : 'transparent',
                border: `1px solid ${selectedPreset === preset.id ? '#8b5cf6' : borderColor}`,
                borderRadius: '6px',
                color: selectedPreset === preset.id ? '#8b5cf6' : textColor,
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {preset.icon} {preset.name}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${borderColor}`,
      borderRadius: '12px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h4 style={{ margin: '0 0 4px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
            📦 Capsule Ask Policy
          </h4>
          <p style={{ margin: 0, color: mutedColor, fontSize: '12px' }}>
            Define what permissions this capsule requests
          </p>
        </div>
        <RiskLabel tier={riskTier} />
      </div>

      {/* Quick Presets */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '10px' }}>
          Quick Presets
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {PERMISSION_PRESETS.map(preset => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              style={{
                flex: 1,
                minWidth: '120px',
                padding: '12px',
                background: selectedPreset === preset.id 
                  ? isDark ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.1)'
                  : 'transparent',
                border: `1px solid ${selectedPreset === preset.id ? '#8b5cf6' : borderColor}`,
                borderRadius: '8px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ 
                fontSize: '20px', 
                marginBottom: '6px',
              }}>
                {preset.icon}
              </div>
              <div style={{ 
                fontWeight: 600, 
                color: selectedPreset === preset.id ? '#8b5cf6' : textColor,
                fontSize: '13px',
                marginBottom: '2px',
              }}>
                {preset.name}
              </div>
              <div style={{ fontSize: '11px', color: mutedColor }}>
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Current Permissions Summary */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}>
          <span style={{ fontSize: '12px', color: mutedColor }}>
            Current Permissions
          </span>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b5cf6',
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {showAdvanced ? '▼ Hide' : '▶ Customize'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{
            padding: '8px 12px',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: '6px',
            flex: 1,
            minWidth: '150px',
          }}>
            <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
              📥 Can Read
            </div>
            <div style={{ fontSize: '12px', color: textColor }}>
              {policy.ingress?.allowedArtefactTypes?.length || 0} content types
            </div>
          </div>
          <div style={{
            padding: '8px 12px',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: '6px',
            flex: 1,
            minWidth: '150px',
          }}>
            <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
              📤 Can Send Via
            </div>
            <div style={{ fontSize: '12px', color: textColor }}>
              {policy.egress?.allowedChannels?.length || 0} channels
            </div>
          </div>
          <div style={{
            padding: '8px 12px',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            borderRadius: '6px',
            flex: 1,
            minWidth: '150px',
          }}>
            <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
              🏷️ Data Types
            </div>
            <div style={{ fontSize: '12px', color: textColor }}>
              {policy.egress?.allowedDataCategories?.length || 0} categories
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Customization */}
      {showAdvanced && (
        <div style={{ padding: '16px 20px' }}>
          {/* Ingress Types */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
              Content Types
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(['text', 'markdown', 'html_sanitized', 'pdf_text', 'structured_data'] as ArtefactType[]).map(type => {
                const isChecked = policy.ingress?.allowedArtefactTypes?.includes(type)
                return (
                  <button
                    key={type}
                    onClick={() => toggleArtefactType(type)}
                    style={{
                      padding: '6px 10px',
                      background: isChecked ? '#8b5cf620' : 'transparent',
                      border: `1px solid ${isChecked ? '#8b5cf6' : borderColor}`,
                      borderRadius: '4px',
                      color: isChecked ? '#8b5cf6' : mutedColor,
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {type}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Egress Channels */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
              Response Channels
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(['email', 'api', 'webhook', 'file_export'] as EgressChannel[]).map(channel => {
                const isChecked = policy.egress?.allowedChannels?.includes(channel)
                return (
                  <button
                    key={channel}
                    onClick={() => toggleChannel(channel)}
                    style={{
                      padding: '6px 10px',
                      background: isChecked ? '#8b5cf620' : 'transparent',
                      border: `1px solid ${isChecked ? '#8b5cf6' : borderColor}`,
                      borderRadius: '4px',
                      color: isChecked ? '#8b5cf6' : mutedColor,
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    {channel}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


