/**
 * Local Policy Editor Component
 * 
 * User-friendly editor for Local Receiver Policy.
 * 
 * BEAP INVARIANTS (not shown as options):
 * - All verified BEAP packages are receivable
 * - Capsules are secure by default
 * - HTML/code are rebuilt receiver-side, never sent
 * 
 * WHAT USERS CONTROL:
 * - Trusted senders & handshakes
 * - Allowed automations (what workflows can do)
 * - Whitelisted external services (APIs, domains, webhooks)
 * - Critical actions require consent by design
 * 
 * @version 4.0.0 - Correct BEAP model
 */

import { useState } from 'react'
import type { CanonicalPolicy, TemplateName } from '../schema'
import { calculateRiskTier } from '../schema'
import { RiskLabel } from './RiskLabel'

interface LocalPolicyEditorProps {
  policy: CanonicalPolicy
  onChange: (updated: CanonicalPolicy) => void
  onApplyTemplate: (template: TemplateName) => void
  theme?: 'default' | 'dark' | 'professional'
}

type Section = 'senders' | 'automations' | 'session' | 'services' | 'critical'

export function LocalPolicyEditor({ policy, onChange, onApplyTemplate, theme = 'default' }: LocalPolicyEditorProps) {
  const [activeSection, setActiveSection] = useState<Section>('senders')
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [newApi, setNewApi] = useState('')
  const [newWebhook, setNewWebhook] = useState('')

  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'
  const accentColor = '#8b5cf6'
  const successColor = '#22c55e'

  const currentRiskTier = calculateRiskTier(policy)

  // Mode is stored in policy tags for explicit tracking
  type PolicyMode = 'strict' | 'restrictive' | 'standard' | 'permissive' | 'custom'
  
  const detectCurrentMode = (): PolicyMode => {
    // First check explicit mode tag
    const modeTag = policy.tags?.find(t => t.startsWith('mode:'))
    if (modeTag) {
      const mode = modeTag.replace('mode:', '') as PolicyMode
      if (['strict', 'restrictive', 'standard', 'permissive'].includes(mode)) {
        return mode
      }
    }
    
    // Fallback to detection based on settings
    const isHandshakeOnly = policy.channels?.beapPackages?.requiredAttestation === 'known_sender'
    if (isHandshakeOnly) return 'strict'
    
    // Default to standard if no explicit mode
    return 'standard'
  }
  
  const currentMode = detectCurrentMode()
  
  // Helper to set mode tag
  const setModeTag = (mode: PolicyMode) => {
    const otherTags = (policy.tags ?? []).filter(t => !t.startsWith('mode:'))
    return [...otherTags, `mode:${mode}`]
  }
  
  const modeConfig: Record<PolicyMode, { icon: string; name: string; color: string; bg: string; desc: string }> = {
    strict: { icon: '🛡️', name: 'Strict', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', desc: 'Handshake partners only, no automation chaining' },
    restrictive: { icon: '🔒', name: 'Minimal', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)', desc: 'Read and analyze, no external calls' },
    standard: { icon: '⚖️', name: 'Standard', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.15)', desc: 'Local automation with allowlisted services' },
    permissive: { icon: '⚡', name: 'Extended', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', desc: 'Multi-step workflows and scheduling' },
    custom: { icon: '⚙️', name: 'Custom', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', desc: 'Custom configuration' },
  }

  // Whitelist helpers
  const whitelists = {
    domains: policy.egress?.allowedDestinations ?? [],
    apis: policy.execution?.allowedConnectors ?? [],
    webhooks: policy.channels?.httpsWebhooks?.allowedHandshakeGroups ?? [],
  }

  const addToWhitelist = (type: 'domains' | 'apis' | 'webhooks', value: string) => {
    if (!value.trim()) return
    
    if (type === 'domains') {
      const current = policy.egress?.allowedDestinations ?? []
      if (!current.includes(value)) {
        onChange({
          ...policy,
          egress: { ...policy.egress!, allowedDestinations: [...current, value] },
        })
      }
      setNewDomain('')
    } else if (type === 'apis') {
      const current = policy.execution?.allowedConnectors ?? []
      if (!current.includes(value)) {
        onChange({
          ...policy,
          execution: { ...policy.execution!, allowedConnectors: [...current, value] },
        })
      }
      setNewApi('')
    } else if (type === 'webhooks') {
      const current = policy.channels?.httpsWebhooks?.allowedHandshakeGroups ?? []
      if (!current.includes(value)) {
        onChange({
          ...policy,
          channels: {
            ...policy.channels!,
            httpsWebhooks: {
              ...policy.channels!.httpsWebhooks!,
              allowedHandshakeGroups: [...current, value],
            },
          },
        })
      }
      setNewWebhook('')
    }
  }

  const removeFromWhitelist = (type: 'domains' | 'apis' | 'webhooks', value: string) => {
    if (type === 'domains') {
      const current = policy.egress?.allowedDestinations ?? []
      onChange({
        ...policy,
        egress: { ...policy.egress!, allowedDestinations: current.filter(d => d !== value) },
      })
    } else if (type === 'apis') {
      const current = policy.execution?.allowedConnectors ?? []
      onChange({
        ...policy,
        execution: { ...policy.execution!, allowedConnectors: current.filter(c => c !== value) },
      })
    } else if (type === 'webhooks') {
      const current = policy.channels?.httpsWebhooks?.allowedHandshakeGroups ?? []
      onChange({
        ...policy,
        channels: {
          ...policy.channels!,
          httpsWebhooks: {
            ...policy.channels!.httpsWebhooks!,
            allowedHandshakeGroups: current.filter(w => w !== value),
          },
        },
      })
    }
  }

  // Automation capability helpers
  const updateAutomation = (key: string, enabled: boolean) => {
    if (!policy.derivations) return
    const current = policy.derivations[key as keyof typeof policy.derivations]
    if (typeof current === 'object' && current !== null && 'enabled' in current) {
      onChange({
        ...policy,
        derivations: {
          ...policy.derivations,
          [key]: { ...current, enabled },
        },
      })
    }
  }

  const sections: { id: Section; label: string; icon: string; description: string }[] = [
    { id: 'senders', label: 'Trusted Senders', icon: '🤝', description: 'Who can send you packages' },
    { id: 'automations', label: 'Automations', icon: '⚡', description: 'What workflows can do' },
    { id: 'session', label: 'Session Control', icon: '🔒', description: 'Restrictions during automation' },
    { id: 'services', label: 'External Services', icon: '🌐', description: 'Whitelisted APIs & domains' },
    { id: 'critical', label: 'Critical Actions', icon: '⚠️', description: 'Payments & data export' },
  ]

  const toggleCardStyle = (isEnabled: boolean) => ({
    padding: '14px 16px',
    background: isEnabled ? 'rgba(34, 197, 94, 0.08)' : cardBg,
    border: `1px solid ${isEnabled ? 'rgba(34, 197, 94, 0.3)' : borderColor}`,
    borderRadius: '10px',
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  })

  const ToggleSwitch = ({ enabled, color = successColor }: { enabled: boolean; color?: string }) => (
    <div style={{
      width: '44px',
      height: '24px',
      background: enabled ? color : 'rgba(100,100,100,0.3)',
      borderRadius: '12px',
      position: 'relative',
      transition: 'all 0.2s ease',
      flexShrink: 0,
    }}>
      <div style={{
        width: '20px',
        height: '20px',
        background: 'white',
        borderRadius: '50%',
        position: 'absolute',
        top: '2px',
        left: enabled ? '22px' : '2px',
        transition: 'all 0.2s ease',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </div>
  )

  const WhitelistChip = ({ value, onRemove }: { value: string; onRemove: () => void }) => (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 10px',
      background: 'rgba(139, 92, 246, 0.15)',
      border: '1px solid rgba(139, 92, 246, 0.3)',
      borderRadius: '6px',
      fontSize: '12px',
      color: '#a78bfa',
    }}>
      <span>{value}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'none',
          border: 'none',
          color: '#a78bfa',
          cursor: 'pointer',
          padding: 0,
          fontSize: '14px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )

  return (
    <div style={{ color: textColor }}>
      {/* BEAP Security Banner - Explains receiving vs executing */}
      <div style={{
        padding: '14px 18px',
        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(139, 92, 246, 0.05))',
        border: `1px solid ${borderColor}`,
        borderRadius: '12px',
        marginBottom: '16px',
      }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>📦</span>
              <span style={{ fontSize: '13px', color: textColor }}>
                <strong>Receiving</strong> packages is always safe
              </span>
              <span style={{ fontSize: '11px', padding: '2px 6px', background: 'rgba(34,197,94,0.15)', color: '#22c55e', borderRadius: '4px' }}>
                ✓ Verified
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>⚡</span>
              <span style={{ fontSize: '13px', color: mutedColor }}>
                <strong style={{ color: textColor }}>Automation</strong> is controlled by your policy mode
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Current Mode Indicator - Persistent across all views */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        background: modeConfig[currentMode].bg,
        border: `1px solid ${modeConfig[currentMode].color}40`,
        borderRadius: '12px',
        marginBottom: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            background: `${modeConfig[currentMode].color}20`,
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
          }}>
            {modeConfig[currentMode].icon}
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: modeConfig[currentMode].color, marginBottom: '2px' }}>
              {modeConfig[currentMode].name} Mode
            </div>
            <div style={{ fontSize: '12px', color: mutedColor }}>
              {modeConfig[currentMode].desc}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {currentMode === 'strict' && (
            <span style={{
              padding: '4px 10px',
              background: 'rgba(245, 158, 11, 0.2)',
              borderRadius: '20px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#f59e0b',
            }}>
              Handshake Only
            </span>
          )}
          <RiskLabel tier={currentRiskTier} />
        </div>
      </div>

      {/* Policy Header */}
      <div style={{
        display: 'flex',
        alignItems: 'start',
        justifyContent: 'space-between',
        marginBottom: '24px',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <input
              type="text"
              value={policy.name}
              onChange={(e) => onChange({ ...policy, name: e.target.value })}
              style={{
                background: 'transparent',
                border: 'none',
                color: textColor,
                fontSize: '20px',
                fontWeight: 700,
                padding: 0,
                width: '100%',
                maxWidth: '400px',
              }}
              placeholder="My Policy"
            />
          </div>
          <input
            type="text"
            value={policy.description || ''}
            onChange={(e) => onChange({ ...policy, description: e.target.value })}
            placeholder="Add a short description..."
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `1px solid ${borderColor}`,
              color: mutedColor,
              fontSize: '13px',
              padding: '4px 0',
              width: '100%',
              maxWidth: '500px',
            }}
          />
        </div>

        {/* Quick Setup */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowTemplateMenu(!showTemplateMenu)}
            style={{
              padding: '10px 16px',
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '8px',
              color: '#a78bfa',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ✨ Quick Setup
          </button>
          {showTemplateMenu && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              background: isDark ? '#1e293b' : 'white',
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
              padding: '6px',
              minWidth: '240px',
              zIndex: 10,
              boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            }}>
              <div style={{ padding: '8px 12px', fontSize: '11px', color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Automation Presets
              </div>
              {[
                { id: 'standard' as const, icon: '⚖️', name: 'Standard', desc: 'Local automation + allowlisted services', isStrict: false, recommended: true },
                { id: 'restrictive' as const, icon: '🔒', name: 'Minimal', desc: 'Read & analyze only, no integrations', isStrict: false, recommended: false },
                { id: 'permissive' as const, icon: '⚡', name: 'Extended', desc: 'Multi-step workflows + scheduling', isStrict: false, recommended: false },
                { id: 'strict' as const, icon: '🛡️', name: 'Strict', desc: 'Handshake only, no chaining', isStrict: true, recommended: false },
              ].map(t => {
                const isCurrentMode = currentMode === t.id
                return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === 'strict') {
                      // Apply restrictive template + enable handshake-only + set mode tag
                      onApplyTemplate('restrictive')
                      // Set handshake-only mode and mode tag after a tick
                      setTimeout(() => {
                        if (policy.channels?.beapPackages) {
                          onChange({
                            ...policy,
                            tags: setModeTag('strict'),
                            channels: {
                              ...policy.channels,
                              beapPackages: {
                                ...policy.channels.beapPackages,
                                requiredAttestation: 'known_sender',
                              },
                            },
                          })
                        }
                      }, 100)
                    } else {
                      // Apply template and set mode tag
                      onApplyTemplate(t.id as TemplateName)
                      setTimeout(() => {
                        onChange({
                          ...policy,
                          tags: setModeTag(t.id as PolicyMode),
                        })
                      }, 100)
                    }
                    setShowTemplateMenu(false)
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: isCurrentMode ? modeConfig[t.id as PolicyMode]?.bg || 'rgba(139,92,246,0.1)' : 'transparent',
                    border: isCurrentMode ? `2px solid ${modeConfig[t.id as PolicyMode]?.color || accentColor}` : '2px solid transparent',
                    borderRadius: '8px',
                    color: textColor,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrentMode) e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrentMode) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ fontSize: '20px' }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {t.name}
                      {t.recommended && !isCurrentMode && (
                        <span style={{
                          fontSize: '9px',
                          padding: '2px 6px',
                          background: 'rgba(34, 197, 94, 0.2)',
                          color: '#22c55e',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}>
                          RECOMMENDED
                        </span>
                      )}
                      {t.isStrict && !isCurrentMode && (
                        <span style={{
                          fontSize: '9px',
                          padding: '2px 6px',
                          background: 'rgba(245, 158, 11, 0.2)',
                          color: '#f59e0b',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}>
                          HIGH SECURITY
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: mutedColor }}>{t.desc}</div>
                  </div>
                  {isCurrentMode && (
                    <span style={{
                      fontSize: '9px',
                      padding: '4px 8px',
                      background: modeConfig[t.id as PolicyMode]?.color || accentColor,
                      color: 'white',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}>
                      ACTIVE
                    </span>
                  )}
                </button>
              )})}
            </div>
          )}
        </div>
      </div>

      {/* Section Tabs */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '8px',
        marginBottom: '20px',
      }}>
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            style={{
              padding: '16px 14px',
              background: activeSection === s.id ? `${accentColor}15` : cardBg,
              border: `2px solid ${activeSection === s.id ? accentColor : 'transparent'}`,
              borderRadius: '12px',
              cursor: 'pointer',
              textAlign: 'center',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '6px' }}>{s.icon}</div>
            <div style={{ 
              fontWeight: 600, 
              fontSize: '13px',
              color: activeSection === s.id ? accentColor : textColor,
              marginBottom: '2px',
            }}>
              {s.label}
            </div>
            <div style={{ fontSize: '11px', color: mutedColor }}>
              {s.description}
            </div>
          </button>
        ))}
      </div>

      {/* Section Content */}
      <div style={{
        background: cardBg,
        border: `1px solid ${borderColor}`,
        borderRadius: '16px',
        padding: '24px',
        maxHeight: '450px',
        overflowY: 'auto',
      }}>
        
        {/* TRUSTED SENDERS */}
        {activeSection === 'senders' && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🤝</span> Trusted Senders & Handshakes
            </h3>
            <p style={{ margin: '0 0 20px', color: mutedColor, fontSize: '13px' }}>
              Packages from verified senders are always accepted. You control their automation permissions here.
            </p>

            {/* Handshake-Only Mode Toggle */}
            <div
              style={{
                padding: '16px',
                background: policy.channels?.beapPackages?.requiredAttestation === 'known_sender' 
                  ? 'rgba(245, 158, 11, 0.1)' 
                  : 'rgba(34, 197, 94, 0.08)',
                border: `1px solid ${policy.channels?.beapPackages?.requiredAttestation === 'known_sender' 
                  ? 'rgba(245, 158, 11, 0.3)' 
                  : 'rgba(34, 197, 94, 0.2)'}`,
                borderRadius: '10px',
                marginBottom: '20px',
                cursor: 'pointer',
              }}
              onClick={() => {
                const currentAttestation = policy.channels?.beapPackages?.requiredAttestation
                const newAttestation = currentAttestation === 'known_sender' ? 'self_signed' : 'known_sender'
                onChange({
                  ...policy,
                  channels: {
                    ...policy.channels!,
                    beapPackages: {
                      ...policy.channels!.beapPackages!,
                      requiredAttestation: newAttestation,
                    },
                  },
                })
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '20px' }}>
                    {policy.channels?.beapPackages?.requiredAttestation === 'known_sender' ? '🛡️' : '✅'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                      {policy.channels?.beapPackages?.requiredAttestation === 'known_sender' 
                        ? 'Handshake Partners Only' 
                        : 'All Verified Senders'}
                    </div>
                    <div style={{ fontSize: '12px', color: mutedColor }}>
                      {policy.channels?.beapPackages?.requiredAttestation === 'known_sender'
                        ? 'Only accept packages from established handshakes. For regulated or high-security environments.'
                        : 'Accept packages from any sender with valid cryptographic verification.'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {policy.channels?.beapPackages?.requiredAttestation === 'known_sender' && (
                    <span style={{
                      padding: '4px 10px',
                      background: 'rgba(245, 158, 11, 0.2)',
                      borderRadius: '20px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#f59e0b',
                    }}>
                      Strict Mode
                    </span>
                  )}
                  <ToggleSwitch 
                    enabled={policy.channels?.beapPackages?.requiredAttestation === 'known_sender'} 
                    color="#f59e0b"
                  />
                </div>
              </div>
            </div>

            {/* Sender Trust Classes - explains the trust model */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                Trust Classes
              </div>
              <div style={{
                padding: '16px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '10px',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    { 
                      level: 'Automation Partners', 
                      desc: 'No consent required. Guardrails still enforced.', 
                      icon: '🤖', 
                      color: '#3b82f6',
                      tag: 'API Mode'
                    },
                    { 
                      level: 'Handshake Partners', 
                      desc: 'Full automation, critical actions need consent.', 
                      icon: '🤝', 
                      color: '#22c55e',
                      tag: 'Standard'
                    },
                    { 
                      level: 'Verified Senders', 
                      desc: 'Basic automation, most actions need consent.', 
                      icon: '✅', 
                      color: '#f59e0b',
                      tag: 'Limited'
                    },
                  ].map(item => (
                    <div
                      key={item.level}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 0',
                        borderBottom: item.level !== 'Verified Senders' ? `1px solid ${borderColor}` : 'none',
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>{item.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, fontSize: '13px' }}>{item.level}</div>
                        <div style={{ fontSize: '11px', color: mutedColor }}>{item.desc}</div>
                      </div>
                      <div style={{
                        padding: '3px 8px',
                        background: `${item.color}15`,
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: item.color,
                      }}>
                        {item.tag}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Important clarification */}
            <div style={{
              padding: '14px 16px',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <span style={{ fontSize: '14px' }}>💡</span>
                <div style={{ fontSize: '12px', color: mutedColor, lineHeight: 1.5 }}>
                  <strong style={{ color: textColor }}>Receiving ≠ Executing:</strong> Accepting a verified package does not grant automation authority. 
                  Configure per-handshake permissions in the Handshakes tab.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AUTOMATIONS */}
        {activeSection === 'automations' && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>⚡</span> Allowed Automations
            </h3>
            <p style={{ margin: '0 0 20px', color: mutedColor, fontSize: '13px' }}>
              Control what actions workflows from BEAP packages can perform.
            </p>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: successColor, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Data Processing
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'deriveLlmSummary', icon: '🤖', name: 'AI Analysis', desc: 'Generate summaries and insights' },
                  { key: 'deriveEmbeddings', icon: '🔍', name: 'Smart Search', desc: 'Index content for search' },
                  { key: 'derivePdfText', icon: '📄', name: 'Document Processing', desc: 'Extract and process document content' },
                ].map(item => {
                  const config = policy.derivations?.[item.key as keyof typeof policy.derivations]
                  const isEnabled = typeof config === 'object' && config !== null && 'enabled' in config ? config.enabled : false
                  
                  return (
                    <div
                      key={item.key}
                      style={toggleCardStyle(isEnabled)}
                      onClick={() => updateAutomation(item.key, !isEnabled)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '18px' }}>{item.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '14px' }}>{item.name}</div>
                          <div style={{ fontSize: '12px', color: mutedColor }}>{item.desc}</div>
                        </div>
                      </div>
                      <ToggleSwitch enabled={isEnabled} />
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Workflow Execution
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'deriveAutomationExec', icon: '⚡', name: 'Run Workflows', desc: 'Execute multi-step automations' },
                  { key: 'deriveExternalApiCall', icon: '🔗', name: 'API Integrations', desc: 'Connect to whitelisted services' },
                ].map(item => {
                  const config = policy.derivations?.[item.key as keyof typeof policy.derivations]
                  const isEnabled = typeof config === 'object' && config !== null && 'enabled' in config ? config.enabled : false
                  
                  return (
                    <div
                      key={item.key}
                      style={toggleCardStyle(isEnabled)}
                      onClick={() => updateAutomation(item.key, !isEnabled)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '18px' }}>{item.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '14px' }}>{item.name}</div>
                          <div style={{ fontSize: '12px', color: mutedColor }}>{item.desc}</div>
                        </div>
                      </div>
                      <ToggleSwitch enabled={isEnabled} />
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{
              padding: '14px 16px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span>💡</span>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#f59e0b' }}>External Services</span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: mutedColor }}>
                API calls are only allowed to whitelisted services. Configure them in the "External Services" tab.
              </p>
            </div>
          </div>
        )}

        {/* SESSION CONTROL */}
        {activeSection === 'session' && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🔒</span> Session Control
            </h3>
            <p style={{ margin: '0 0 20px', color: mutedColor, fontSize: '13px' }}>
              Control what can happen while automation is running. Stricter modes provide more isolation.
            </p>

            {/* Mode-based defaults notice */}
            <div style={{
              padding: '14px 16px',
              background: modeConfig[currentMode].bg,
              border: `1px solid ${modeConfig[currentMode].color}40`,
              borderRadius: '10px',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '16px' }}>{modeConfig[currentMode].icon}</span>
                <span style={{ fontWeight: 600, fontSize: '13px', color: modeConfig[currentMode].color }}>
                  {modeConfig[currentMode].name} Mode Defaults
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: mutedColor }}>
                These settings are pre-configured for your current mode. You can customize them below.
              </p>
            </div>

            {/* Ingress During Automation */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📥 Ingress During Automation
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'allowCapsuleUnpacking', icon: '📦', name: 'Allow Capsule Unpacking', desc: 'Unpack new packages while automation runs' },
                  { key: 'allowAgentImport', icon: '🤖', name: 'Allow Agent Import', desc: 'Import new agents/modules during session' },
                ].map(item => {
                  const sessionConfig = policy.sessionRestrictions ?? {}
                  const isEnabled = sessionConfig[item.key as keyof typeof sessionConfig] ?? (currentMode === 'permissive')
                  
                  return (
                    <div 
                      key={item.key} 
                      style={toggleCardStyle(!!isEnabled)}
                      onClick={() => {
                        onChange({
                          ...policy,
                          sessionRestrictions: {
                            ...policy.sessionRestrictions,
                            [item.key]: !isEnabled,
                          },
                        })
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '18px' }}>{item.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '14px' }}>{item.name}</div>
                          <div style={{ fontSize: '12px', color: mutedColor }}>{item.desc}</div>
                        </div>
                      </div>
                      <ToggleSwitch enabled={!!isEnabled} />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Egress During Automation */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📤 Egress During Automation
              </div>
              <div style={{
                padding: '16px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '10px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '12px' }}>
                  Data can leave during automation:
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'none', label: '🚫 None', desc: 'Block all egress' },
                    { id: 'allowlist_only', label: '📋 Allowlist', desc: 'Whitelisted only' },
                    { id: 'unrestricted', label: '✅ Normal', desc: 'Policy-bounded' },
                  ].map(opt => {
                    const defaultValue = currentMode === 'strict' || currentMode === 'restrictive' ? 'none' : 'allowlist_only'
                    const currentValue = policy.sessionRestrictions?.egressDuringAutomation ?? defaultValue
                    const isSelected = opt.id === currentValue
                    
                    return (
                      <button
                        key={opt.id}
                        onClick={() => {
                          onChange({
                            ...policy,
                            sessionRestrictions: {
                              ...policy.sessionRestrictions,
                              egressDuringAutomation: opt.id as 'none' | 'allowlist_only' | 'unrestricted',
                            },
                          })
                        }}
                        style={{
                          flex: 1,
                          padding: '12px',
                          background: isSelected ? `${accentColor}15` : cardBg,
                          border: `2px solid ${isSelected ? accentColor : borderColor}`,
                          borderRadius: '8px',
                          color: isSelected ? accentColor : textColor,
                          fontSize: '12px',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '16px', marginBottom: '4px' }}>{opt.label.split(' ')[0]}</div>
                        <div style={{ fontWeight: 600 }}>{opt.label.split(' ').slice(1).join(' ')}</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Package Building Restrictions */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📝 Package Building During Automation
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { key: 'allowPackageBuilding', icon: '📦', name: 'Allow Package Building', desc: 'Create new packages while automation runs', defaultStandard: true },
                  { key: 'allowMediaUpload', icon: '🖼️', name: 'Allow Media Upload', desc: 'Upload images/attachments during session', defaultStandard: false },
                  { key: 'allowConcurrentSessions', icon: '🔄', name: 'Allow Concurrent Sessions', desc: 'Run multiple automations simultaneously', defaultStandard: false },
                ].map(item => {
                  const sessionConfig = policy.sessionRestrictions ?? {}
                  const defaultValue = currentMode === 'permissive' || (currentMode === 'standard' && item.defaultStandard)
                  const isEnabled = sessionConfig[item.key as keyof typeof sessionConfig] ?? defaultValue
                  
                  return (
                    <div 
                      key={item.key} 
                      style={toggleCardStyle(!!isEnabled)}
                      onClick={() => {
                        onChange({
                          ...policy,
                          sessionRestrictions: {
                            ...policy.sessionRestrictions,
                            [item.key]: !isEnabled,
                          },
                        })
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '18px' }}>{item.icon}</span>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: '14px' }}>{item.name}</div>
                          <div style={{ fontSize: '12px', color: mutedColor }}>{item.desc}</div>
                        </div>
                      </div>
                      <ToggleSwitch enabled={!!isEnabled} />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Session Limits */}
            <div style={{
              padding: '16px',
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⏱️</span> Session Limits
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '6px', textTransform: 'uppercase' }}>
                    Max Duration
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: textColor }}>
                    {currentMode === 'strict' ? '1 min' : currentMode === 'restrictive' ? '2 min' : currentMode === 'standard' ? '5 min' : '10 min'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '6px', textTransform: 'uppercase' }}>
                    Concurrent Sessions
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: textColor }}>
                    {currentMode === 'permissive' ? '3' : '1'}
                  </div>
                </div>
              </div>
            </div>

            {/* Admin Lock Notice (Future) */}
            <div style={{
              marginTop: '20px',
              padding: '12px 16px',
              background: 'rgba(139, 92, 246, 0.08)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔐</span>
                <span style={{ fontSize: '12px', color: mutedColor }}>
                  <strong style={{ color: textColor }}>Admin Lock</strong> — These settings can be locked by administrators in managed environments.
                </span>
              </div>
            </div>
          </div>
        )}

        {/* EXTERNAL SERVICES */}
        {activeSection === 'services' && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🌐</span> Whitelisted External Services
            </h3>
            <p style={{ margin: '0 0 20px', color: mutedColor, fontSize: '13px' }}>
              Workflows can only connect to services you've explicitly approved.
            </p>

            {/* Domains */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🌍</span> Allowed Domains
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addToWhitelist('domains', newDomain)}
                  placeholder="example.com"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '8px',
                    color: textColor,
                    fontSize: '13px',
                  }}
                />
                <button
                  onClick={() => addToWhitelist('domains', newDomain)}
                  style={{
                    padding: '10px 16px',
                    background: accentColor,
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {whitelists.domains.length === 0 ? (
                  <span style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic' }}>No domains whitelisted</span>
                ) : (
                  whitelists.domains.map(d => (
                    <WhitelistChip key={d} value={d} onRemove={() => removeFromWhitelist('domains', d)} />
                  ))
                )}
              </div>
            </div>

            {/* APIs */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔌</span> Allowed APIs
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={newApi}
                  onChange={(e) => setNewApi(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addToWhitelist('apis', newApi)}
                  placeholder="api.service.com/v1"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '8px',
                    color: textColor,
                    fontSize: '13px',
                  }}
                />
                <button
                  onClick={() => addToWhitelist('apis', newApi)}
                  style={{
                    padding: '10px 16px',
                    background: accentColor,
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {whitelists.apis.length === 0 ? (
                  <span style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic' }}>No APIs whitelisted</span>
                ) : (
                  whitelists.apis.map(a => (
                    <WhitelistChip key={a} value={a} onRemove={() => removeFromWhitelist('apis', a)} />
                  ))
                )}
              </div>
            </div>

            {/* Webhooks */}
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔗</span> Allowed Webhooks
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input
                  type="text"
                  value={newWebhook}
                  onChange={(e) => setNewWebhook(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addToWhitelist('webhooks', newWebhook)}
                  placeholder="hooks.service.com"
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '8px',
                    color: textColor,
                    fontSize: '13px',
                  }}
                />
                <button
                  onClick={() => addToWhitelist('webhooks', newWebhook)}
                  style={{
                    padding: '10px 16px',
                    background: accentColor,
                    border: 'none',
                    borderRadius: '8px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Add
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {whitelists.webhooks.length === 0 ? (
                  <span style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic' }}>No webhooks whitelisted</span>
                ) : (
                  whitelists.webhooks.map(w => (
                    <WhitelistChip key={w} value={w} onRemove={() => removeFromWhitelist('webhooks', w)} />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* CRITICAL ACTIONS */}
        {activeSection === 'critical' && (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>⚠️</span> Critical Actions
            </h3>
            <p style={{ margin: '0 0 20px', color: mutedColor, fontSize: '13px' }}>
              These actions always require your explicit consent, regardless of sender trust level.
            </p>

            <div style={{
              padding: '16px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              borderRadius: '12px',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '20px' }}>🔒</span>
                <span style={{ fontWeight: 600, fontSize: '14px', color: '#f59e0b' }}>Always Requires Consent</span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: mutedColor }}>
                These actions cannot be automated without your approval. This is a security invariant and cannot be disabled.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { icon: '💳', name: 'Payment Requests', desc: 'Any financial transaction or payment authorization', status: 'Consent Required' },
                { icon: '📤', name: 'Data Export', desc: 'Sending data outside your system to external destinations', status: 'Consent Required' },
                { icon: '🔓', name: 'Original File Access', desc: 'Unsealing and accessing original encrypted artifacts', status: 'Consent Required' },
                { icon: '🔑', name: 'Credential Access', desc: 'Accessing stored credentials or authentication tokens', status: 'Consent Required' },
              ].map(item => (
                <div
                  key={item.name}
                  style={{
                    padding: '16px',
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '24px' }}>{item.icon}</span>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '14px' }}>{item.name}</div>
                      <div style={{ fontSize: '12px', color: mutedColor }}>{item.desc}</div>
                    </div>
                  </div>
                  <div style={{
                    padding: '6px 12px',
                    background: 'rgba(245, 158, 11, 0.15)',
                    borderRadius: '20px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#f59e0b',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.status}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: '20px',
              padding: '14px 16px',
              background: 'rgba(34, 197, 94, 0.08)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
              borderRadius: '10px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span>✅</span>
                <span style={{ fontWeight: 600, fontSize: '13px', color: successColor }}>Consent Flow</span>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: mutedColor }}>
                When a package requests a critical action, you'll see a clear consent dialog showing exactly what's being requested, 
                who's requesting it, and what data will be affected. You can approve once, for a time period, or deny.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Policy Info Footer */}
      <div style={{
        marginTop: '20px',
        padding: '10px 16px',
        background: cardBg,
        borderRadius: '8px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '11px',
        color: mutedColor,
      }}>
        <span>Last updated: {new Date(policy.updatedAt).toLocaleString()}</span>
        <span>v{policy.version}</span>
      </div>
    </div>
  )
}
