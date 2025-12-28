/**
 * Policy Lightbox Component
 * 
 * Main lightbox for policy management with tabs:
 * - Local Policy: Edit Local Node Policy (LNP)
 * - Handshakes: View/manage sender policies (HSP)
 * - Network Admin: View/push Network Baseline Policy (NBP)
 */

import { useState, useEffect, Component, ReactNode } from 'react'
import { 
  type CanonicalPolicy, 
  createDefaultPolicy, 
} from '../schema'
import { 
  createPolicyFromTemplate,
  type TemplateName,
} from '../templates'
import { computeEffectivePolicy } from '../engine'
import { LocalPolicyEditor } from './LocalPolicyEditor'
import { PolicyDiffView } from './PolicyDiffView'
import { EffectivePreview } from './EffectivePreview'

// Error Boundary to prevent crashes from closing the lightbox
class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PolicyLightbox ErrorBoundary]', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

interface PolicyLightboxProps {
  isOpen: boolean
  onClose: () => void
  theme?: 'default' | 'dark' | 'professional'
}

type Tab = 'local' | 'handshakes' | 'network'

// Storage key for persisting policies
const POLICY_STORAGE_KEY = 'wrlocal_policies'

export function PolicyLightbox({ isOpen, onClose, theme = 'default' }: PolicyLightboxProps) {
  const [activeTab, setActiveTab] = useState<Tab>('local')
  const [localPolicy, setLocalPolicy] = useState<CanonicalPolicy | null>(null)
  const [networkPolicy, setNetworkPolicy] = useState<CanonicalPolicy | null>(null)
  const [handshakePolicies, setHandshakePolicies] = useState<CanonicalPolicy[]>([])
  const [selectedHandshake, setSelectedHandshake] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [diffPolicies, setDiffPolicies] = useState<{ a: CanonicalPolicy; b: CanonicalPolicy } | null>(null)
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load policies on mount
  useEffect(() => {
    if (!isOpen) return
    
    const loadPolicies = async () => {
      setIsLoading(true)
      try {
        // Load from chrome.storage.local
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          const result = await chrome.storage.local.get([POLICY_STORAGE_KEY])
          const stored = result[POLICY_STORAGE_KEY]
          
          if (stored?.localPolicy) {
            setLocalPolicy(stored.localPolicy)
          } else {
            // Create default local policy
            const defaultLnp = createPolicyFromTemplate('standard', 'local', 'Local Node Policy')
            setLocalPolicy(defaultLnp)
          }
          
          if (stored?.networkPolicy) {
            setNetworkPolicy(stored.networkPolicy)
          }
          
          if (stored?.handshakePolicies) {
            setHandshakePolicies(stored.handshakePolicies)
          }
        } else {
          // Fallback: create default policy
          const defaultLnp = createPolicyFromTemplate('standard', 'local', 'Local Node Policy')
          setLocalPolicy(defaultLnp)
        }
      } catch (error) {
        console.error('[PolicyLightbox] Failed to load policies:', error)
        showNotification('Failed to load policies', 'error')
        // Create default anyway
        const defaultLnp = createPolicyFromTemplate('standard', 'local', 'Local Node Policy')
        setLocalPolicy(defaultLnp)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadPolicies()
  }, [isOpen])

  // Save policies to storage
  const savePolicies = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({
          [POLICY_STORAGE_KEY]: {
            localPolicy,
            networkPolicy,
            handshakePolicies,
          }
        })
        showNotification('Policies saved successfully', 'success')
      }
    } catch (error) {
      console.error('[PolicyLightbox] Failed to save policies:', error)
      showNotification('Failed to save policies', 'error')
    }
  }

  const showNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type })
    setTimeout(() => setNotification(null), 3000)
  }

  const handlePolicyChange = (updated: CanonicalPolicy) => {
    setLocalPolicy({ ...updated, updatedAt: Date.now() })
  }

  const handleApplyTemplate = (template: TemplateName) => {
    const newPolicy = createPolicyFromTemplate(template, 'local', 'Local Node Policy')
    setLocalPolicy(newPolicy)
    showNotification(`Applied ${template} template`, 'info')
  }

  const handleShowDiff = (a: CanonicalPolicy, b: CanonicalPolicy) => {
    setDiffPolicies({ a, b })
    setShowDiff(true)
  }

  if (!isOpen) return null

  // Theme-based colors
  const isDark = theme === 'default' || theme === 'dark'
  const bgColor = isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const accentColor = '#8b5cf6'
  const tabBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'
  const activeTabBg = isDark ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.1)'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '1200px',
          maxHeight: '90vh',
          background: bgColor,
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: `1px solid ${borderColor}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${borderColor}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>📋</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: textColor }}>
              Policy Configuration
            </h2>
            <span style={{ 
              fontSize: '12px', 
              color: mutedColor,
              background: tabBg,
              padding: '4px 8px',
              borderRadius: '4px',
            }}>
              v1.0.0
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={savePolicies}
              style={{
                padding: '8px 16px',
                background: accentColor,
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              💾 Save Changes
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: mutedColor,
                fontSize: '24px',
                cursor: 'pointer',
                padding: '4px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '16px 24px 0',
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          {[
            { id: 'local' as Tab, label: 'Local Policy', icon: '🏠' },
            { id: 'handshakes' as Tab, label: 'Handshakes', icon: '🤝' },
            { id: 'network' as Tab, label: 'Network Admin', icon: '🌐' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '12px 20px',
                background: activeTab === tab.id ? activeTabBg : 'transparent',
                border: 'none',
                borderBottom: activeTab === tab.id ? `2px solid ${accentColor}` : '2px solid transparent',
                color: activeTab === tab.id ? accentColor : mutedColor,
                fontSize: '14px',
                fontWeight: activeTab === tab.id ? 600 : 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: '8px 8px 0 0',
                marginBottom: '-1px',
                transition: 'all 0.2s ease',
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px',
          }}
        >
          {/* Notification */}
          {notification && (
            <div
              style={{
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '8px',
                background: notification.type === 'success' 
                  ? 'rgba(34, 197, 94, 0.1)' 
                  : notification.type === 'error'
                  ? 'rgba(239, 68, 68, 0.1)'
                  : 'rgba(139, 92, 246, 0.1)',
                border: `1px solid ${
                  notification.type === 'success' 
                    ? 'rgba(34, 197, 94, 0.3)' 
                    : notification.type === 'error'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(139, 92, 246, 0.3)'
                }`,
                color: notification.type === 'success' 
                  ? '#22c55e' 
                  : notification.type === 'error'
                  ? '#ef4444'
                  : accentColor,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {notification.type === 'success' ? '✓' : notification.type === 'error' ? '✕' : 'ℹ'}
              {notification.message}
            </div>
          )}

          {isLoading ? (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              height: '200px',
              color: mutedColor,
            }}>
              Loading policies...
            </div>
          ) : (
            <ErrorBoundary
              fallback={
                <div style={{ 
                  padding: '40px', 
                  textAlign: 'center', 
                  color: '#ef4444',
                }}>
                  <p style={{ fontSize: '16px', fontWeight: 600 }}>
                    An error occurred loading this tab
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    style={{
                      marginTop: '16px',
                      padding: '8px 16px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '8px',
                      color: '#ef4444',
                      cursor: 'pointer',
                    }}
                  >
                    Reload Page
                  </button>
                </div>
              }
            >
              {/* Local Policy Tab */}
              {activeTab === 'local' && (
                localPolicy ? (
                  <LocalPolicyEditor
                    policy={localPolicy}
                    onChange={handlePolicyChange}
                    onApplyTemplate={handleApplyTemplate}
                    theme={theme}
                  />
                ) : (
                  <div style={{ color: textColor }}>
                    <div style={{
                      padding: '60px 40px',
                      textAlign: 'center',
                      background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                      borderRadius: '16px',
                      border: `2px dashed ${borderColor}`,
                    }}>
                      <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛡️</div>
                      <h3 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 700 }}>
                        No Local Policy Configured
                      </h3>
                      <p style={{ margin: '0 0 24px', color: mutedColor, fontSize: '14px', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
                        Create a local node policy to control what data can enter and leave your system.
                      </p>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleApplyTemplate('restrictive')}
                          style={{
                            padding: '12px 20px',
                            background: 'rgba(34, 197, 94, 0.1)',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            borderRadius: '10px',
                            color: '#22c55e',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          🔒 Start Restrictive
                        </button>
                        <button
                          onClick={() => handleApplyTemplate('standard')}
                          style={{
                            padding: '12px 20px',
                            background: accentColor,
                            border: 'none',
                            borderRadius: '10px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          ⚖️ Start Standard
                        </button>
                        <button
                          onClick={() => handleApplyTemplate('permissive')}
                          style={{
                            padding: '12px 20px',
                            background: 'rgba(234, 179, 8, 0.1)',
                            border: '1px solid rgba(234, 179, 8, 0.3)',
                            borderRadius: '10px',
                            color: '#eab308',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          🔓 Start Permissive
                        </button>
                      </div>
                      <p style={{ margin: '20px 0 0', color: mutedColor, fontSize: '12px' }}>
                        Choose a template to get started. You can customize it afterwards.
                      </p>
                    </div>
                  </div>
                )
              )}

              {/* Handshakes Tab */}
              {activeTab === 'handshakes' && (
                <div style={{ color: textColor }}>
                  {/* Header */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                      🤝 Handshake Partners
                    </h3>
                    <p style={{ margin: '8px 0 0', color: mutedColor, fontSize: '14px' }}>
                      Handshakes establish trusted relationships with specific senders
                    </p>
                  </div>

                  {/* Configure Existing Handshakes */}
                  <div style={{
                    padding: '20px',
                    background: tabBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: '12px',
                    marginBottom: '20px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                      <span style={{ fontSize: '24px' }}>📋</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '15px' }}>Configure Existing Handshakes</div>
                        <div style={{ fontSize: '12px', color: mutedColor }}>Select a partner to configure their policy profile</div>
                      </div>
                    </div>
                    <select
                      value={selectedHandshake || ''}
                      onChange={(e) => setSelectedHandshake(e.target.value || null)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        background: isDark ? 'rgba(255,255,255,0.05)' : 'white',
                        border: `1px solid ${borderColor}`,
                        borderRadius: '8px',
                        color: textColor,
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      <option value="">— Select a handshake partner —</option>
                      {handshakePolicies.map(hsp => (
                        <option key={hsp.id} value={hsp.id}>
                          {hsp.name} {hsp.tags?.find(t => t.startsWith('mode:'))?.replace('mode:', '') === 'automation_partner' ? '🤖 API Partner' : '🤝'}
                        </option>
                      ))}
                    </select>
                    {handshakePolicies.length === 0 && (
                      <div style={{ 
                        marginTop: '16px', 
                        padding: '16px',
                        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                        borderRadius: '8px',
                        textAlign: 'center',
                      }}>
                        <p style={{ margin: 0, fontSize: '13px', color: mutedColor }}>
                          No established handshakes yet
                        </p>
                        <p style={{ margin: '8px 0 0', fontSize: '12px', color: mutedColor }}>
                          💡 Send a BEAP™ Handshake Request from the Command Chat → Handshake Request
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Pending Requests Section */}
                  <div style={{
                    padding: '14px 16px',
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                    borderRadius: '10px',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                  }}>
                    <span style={{ fontSize: '18px' }}>⏳</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: '#f59e0b' }}>Pending Requests</div>
                      <div style={{ fontSize: '12px', color: mutedColor }}>
                        0 sent • 0 received
                      </div>
                    </div>
                    <button
                      style={{
                        padding: '6px 12px',
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '6px',
                        color: '#f59e0b',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      View All
                    </button>
                  </div>

                  {/* Partner Detail Panel - Only shown when a partner is selected */}
                  {selectedHandshake && (() => {
                        const hsp = handshakePolicies.find(p => p.id === selectedHandshake)
                        if (!hsp) return null
                        const hspMode = hsp.tags?.find(t => t.startsWith('mode:'))?.replace('mode:', '') || 'inherit'
                        return (
                          <div style={{
                            padding: '20px',
                            background: tabBg,
                            borderRadius: '12px',
                            border: `1px solid ${borderColor}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                              <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                                🤝 {hsp.name}
                              </h4>
                              <button
                                onClick={() => setSelectedHandshake(null)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: mutedColor,
                                  fontSize: '18px',
                                  cursor: 'pointer',
                                }}
                              >
                                ×
                              </button>
                            </div>

                            {/* Relationship Class Selector */}
                            <div style={{ marginBottom: '20px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Relationship Class
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                                {[
                                  { id: 'verified', icon: '✅', label: 'Verified Sender', desc: 'Basic automation, consent required', color: '#f59e0b' },
                                  { id: 'handshake', icon: '🤝', label: 'Handshake Partner', desc: 'Full automation, critical needs consent', color: '#22c55e' },
                                  { id: 'automation', icon: '🤖', label: 'Automation Partner', desc: 'No consent, guardrails enforced', color: '#3b82f6' },
                                ].map(cls => {
                                  const isApiPartner = hspMode === 'automation_partner'
                                  const currentClass = isApiPartner ? 'automation' : 
                                    hsp.tags?.includes('handshake_partner') ? 'handshake' : 'verified'
                                  const isSelected = cls.id === currentClass
                                  
                                  return (
                                    <button
                                      key={cls.id}
                                      onClick={() => {
                                        const newTags = (hsp.tags ?? []).filter(t => 
                                          !t.startsWith('mode:') && t !== 'handshake_partner' && t !== 'verified_sender'
                                        )
                                        if (cls.id === 'automation') {
                                          newTags.push('mode:automation_partner')
                                        } else if (cls.id === 'handshake') {
                                          newTags.push('handshake_partner')
                                        }
                                        const updated = { ...hsp, tags: newTags, updatedAt: Date.now() }
                                        setHandshakePolicies(handshakePolicies.map(p => p.id === hsp.id ? updated : p))
                                      }}
                                      style={{
                                        padding: '14px 10px',
                                        background: isSelected ? `${cls.color}15` : 'transparent',
                                        border: `2px solid ${isSelected ? cls.color : borderColor}`,
                                        borderRadius: '10px',
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        color: isSelected ? cls.color : textColor,
                                      }}
                                    >
                                      <div style={{ fontSize: '22px', marginBottom: '6px' }}>{cls.icon}</div>
                                      <div style={{ fontSize: '12px', fontWeight: 600 }}>{cls.label}</div>
                                      <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>{cls.desc}</div>
                                    </button>
                                  )
                                })}
                              </div>
                              
                              {/* Clarification for automation partners */}
                              {hspMode === 'automation_partner' && (
                                <div style={{
                                  marginTop: '12px',
                                  padding: '10px 12px',
                                  background: 'rgba(59, 130, 246, 0.1)',
                                  border: '1px solid rgba(59, 130, 246, 0.2)',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                  color: mutedColor,
                                }}>
                                  <strong style={{ color: textColor }}>No-consent mode:</strong> Consent is replaced by pre-established 
                                  handshake authority + enforced guardrails below.
                                </div>
                              )}
                            </div>

                            {/* Policy Template - only for non-automation partners */}
                            {hspMode !== 'automation_partner' && (
                            <div style={{ marginBottom: '20px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: accentColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Policy Template
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                                {[
                                  { id: 'inherit', icon: '🔗', label: 'Inherit', desc: 'Use global' },
                                  { id: 'standard', icon: '⚖️', label: 'Standard', desc: 'Balanced' },
                                  { id: 'restrictive', icon: '🔒', label: 'Minimal', desc: 'Limited' },
                                  { id: 'permissive', icon: '🔓', label: 'Extended', desc: 'Full auto' },
                                  { id: 'strict', icon: '🛡️', label: 'Strict', desc: 'Lockdown' },
                                ].map(mode => (
                                  <button
                                    key={mode.id}
                                    onClick={() => {
                                      const newTags = (hsp.tags ?? []).filter(t => !t.startsWith('mode:'))
                                      if (mode.id !== 'inherit') {
                                        newTags.push(`mode:${mode.id}`)
                                      }
                                      const updated = { ...hsp, tags: newTags, updatedAt: Date.now() }
                                      setHandshakePolicies(handshakePolicies.map(p => p.id === hsp.id ? updated : p))
                                    }}
                                    style={{
                                      padding: '10px 6px',
                                      background: hspMode === mode.id ? `${accentColor}20` : 'transparent',
                                      border: `2px solid ${hspMode === mode.id ? accentColor : borderColor}`,
                                      borderRadius: '8px',
                                      cursor: 'pointer',
                                      textAlign: 'center',
                                      color: hspMode === mode.id ? accentColor : textColor,
                                    }}
                                  >
                                    <div style={{ fontSize: '18px', marginBottom: '4px' }}>{mode.icon}</div>
                                    <div style={{ fontSize: '11px', fontWeight: 600 }}>{mode.label}</div>
                                  </button>
                                ))}
                              </div>
                              {hspMode !== 'inherit' && (
                                <p style={{ fontSize: '11px', color: mutedColor, marginTop: '8px', marginBottom: 0 }}>
                                  This handshake uses custom settings, overriding the global default.
                                </p>
                              )}
                            </div>
                            )}

                            {/* API Partner Guardrails - Only shown for automation_partner mode */}
                            {hspMode === 'automation_partner' && (
                              <div style={{ marginBottom: '20px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                  🔧 API Partner Limits
                                </div>
                                <div style={{
                                  padding: '16px',
                                  background: 'rgba(59, 130, 246, 0.05)',
                                  border: '1px solid rgba(59, 130, 246, 0.2)',
                                  borderRadius: '10px',
                                }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                                    <div>
                                      <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>Requests / Minute</div>
                                      <input 
                                        type="number" 
                                        defaultValue={60}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          background: theme === 'professional' ? 'white' : 'rgba(255,255,255,0.1)',
                                          border: `1px solid ${borderColor}`,
                                          borderRadius: '6px',
                                          color: textColor,
                                          fontSize: '14px',
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>Requests / Hour</div>
                                      <input 
                                        type="number" 
                                        defaultValue={1000}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          background: theme === 'professional' ? 'white' : 'rgba(255,255,255,0.1)',
                                          border: `1px solid ${borderColor}`,
                                          borderRadius: '6px',
                                          color: textColor,
                                          fontSize: '14px',
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>Max Concurrent Workflows</div>
                                      <input 
                                        type="number" 
                                        defaultValue={10}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          background: theme === 'professional' ? 'white' : 'rgba(255,255,255,0.1)',
                                          border: `1px solid ${borderColor}`,
                                          borderRadius: '6px',
                                          color: textColor,
                                          fontSize: '14px',
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>Max Egress / Hour (MB)</div>
                                      <input 
                                        type="number" 
                                        defaultValue={100}
                                        style={{
                                          width: '100%',
                                          padding: '8px 10px',
                                          background: theme === 'professional' ? 'white' : 'rgba(255,255,255,0.1)',
                                          border: `1px solid ${borderColor}`,
                                          borderRadius: '6px',
                                          color: textColor,
                                          fontSize: '14px',
                                        }}
                                      />
                                    </div>
                                  </div>
                                  
                                  {/* Actions that still require consent */}
                                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${borderColor}` }}>
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '10px' }}>
                                      ⚠️ Always Require Consent For:
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                      {[
                                        { id: 'financial', label: '💳 Financial Transactions', default: true },
                                        { id: 'export', label: '📤 Data Export', default: false },
                                        { id: 'identity', label: '🔑 Identity Changes', default: true },
                                        { id: 'policy', label: '📋 Policy Changes', default: true },
                                      ].map(action => (
                                        <label key={action.id} style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '6px',
                                          padding: '6px 10px',
                                          background: action.default ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                                          border: `1px solid ${action.default ? 'rgba(245, 158, 11, 0.3)' : borderColor}`,
                                          borderRadius: '6px',
                                          fontSize: '11px',
                                          cursor: 'pointer',
                                        }}>
                                          <input 
                                            type="checkbox" 
                                            defaultChecked={action.default}
                                            style={{ margin: 0 }}
                                          />
                                          {action.label}
                                        </label>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Quick Permissions */}
                            <div style={{ marginBottom: '20px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Permissions
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {[
                                  { key: 'automation', icon: '⚡', label: 'Allow Automation', desc: 'Run workflows from this sender' },
                                  { key: 'api', icon: '🌐', label: 'API Calls', desc: 'Allow external integrations' },
                                  { key: 'priority', icon: '⭐', label: 'Priority Processing', desc: 'Process packages faster' },
                                ].map(perm => (
                                  <div key={perm.key} style={{
                                    padding: '12px',
                                    background: theme === 'professional' ? 'rgba(15,23,42,0.02)' : 'rgba(255,255,255,0.03)',
                                    border: `1px solid ${borderColor}`,
                                    borderRadius: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span style={{ fontSize: '16px' }}>{perm.icon}</span>
                                      <div>
                                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{perm.label}</div>
                                        <div style={{ fontSize: '11px', color: mutedColor }}>{perm.desc}</div>
                                      </div>
                                    </div>
                                    <div style={{
                                      width: '36px',
                                      height: '20px',
                                      borderRadius: '10px',
                                      background: '#22c55e',
                                      position: 'relative',
                                    }}>
                                      <div style={{
                                        position: 'absolute',
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '50%',
                                        background: 'white',
                                        top: '2px',
                                        right: '2px',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                      }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Session Restrictions */}
                            <div>
                              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '10px', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Session Restrictions
                              </div>
                              <div style={{
                                padding: '14px',
                                background: hspMode === 'automation_partner' ? 'rgba(59, 130, 246, 0.05)' : 'rgba(245, 158, 11, 0.05)',
                                border: `1px solid ${hspMode === 'automation_partner' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
                                borderRadius: '8px',
                              }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: '12px' }}>
                                  <div>
                                    <div style={{ color: mutedColor, marginBottom: '4px' }}>Max Duration</div>
                                    <div style={{ fontWeight: 600 }}>
                                      {hspMode === 'automation_partner' ? '1 hour' : hspMode === 'strict' ? '1 min' : hspMode === 'restrictive' ? '2 min' : hspMode === 'permissive' ? '10 min' : '5 min'}
                                    </div>
                                  </div>
                                  <div>
                                    <div style={{ color: mutedColor, marginBottom: '4px' }}>Egress</div>
                                    <div style={{ fontWeight: 600 }}>
                                      {hspMode === 'strict' || hspMode === 'restrictive' ? 'None' : 'Allowlist'}
                                    </div>
                                  </div>
                                  {hspMode === 'automation_partner' && (
                                    <>
                                      <div>
                                        <div style={{ color: mutedColor, marginBottom: '4px' }}>Concurrent</div>
                                        <div style={{ fontWeight: 600 }}>10 workflows</div>
                                      </div>
                                      <div>
                                        <div style={{ color: mutedColor, marginBottom: '4px' }}>Consent</div>
                                        <div style={{ fontWeight: 600, color: '#3b82f6' }}>Skipped (API)</div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Admin Lock Notice */}
                            <div style={{
                              marginTop: '16px',
                              padding: '10px 12px',
                              background: 'rgba(139, 92, 246, 0.05)',
                              border: '1px solid rgba(139, 92, 246, 0.2)',
                              borderRadius: '8px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}>
                              <span>🔐</span>
                              <span style={{ fontSize: '11px', color: mutedColor }}>
                                Admins can lock specific settings for this handshake.
                              </span>
                            </div>
                          </div>
                        )
                      })()}

                  {/* Effective Policy Preview */}
                  {localPolicy && handshakePolicies.length > 0 && (
                    <div style={{ marginTop: '32px' }}>
                      <EffectivePreview
                        localPolicy={localPolicy}
                        networkPolicy={networkPolicy || undefined}
                        handshakePolicies={handshakePolicies}
                        selectedHandshakeId={selectedHandshake || undefined}
                        theme={theme}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Network Admin Tab */}
              {activeTab === 'network' && (
                <div style={{ color: textColor }}>
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                      Network Baseline Policy
                    </h3>
                    <p style={{ margin: '8px 0 0', color: mutedColor, fontSize: '14px' }}>
                      Organization-wide policy baseline (read-only unless you have admin permissions)
                    </p>
                  </div>

                  {networkPolicy ? (
                    <div style={{
                      padding: '20px',
                      background: tabBg,
                      borderRadius: '12px',
                      border: `1px solid ${borderColor}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                        <div>
                          <h4 style={{ margin: '0 0 8px', fontWeight: 600 }}>{networkPolicy.name}</h4>
                          <p style={{ margin: 0, color: mutedColor, fontSize: '13px' }}>
                            {networkPolicy.description || 'No description'}
                          </p>
                        </div>
                        <span
                          style={{
                            padding: '6px 12px',
                            background: networkPolicy.riskTier === 'low' 
                              ? 'rgba(34, 197, 94, 0.1)' 
                              : networkPolicy.riskTier === 'medium'
                              ? 'rgba(234, 179, 8, 0.1)'
                              : 'rgba(239, 68, 68, 0.1)',
                            color: networkPolicy.riskTier === 'low' 
                              ? '#22c55e' 
                              : networkPolicy.riskTier === 'medium'
                              ? '#eab308'
                              : '#ef4444',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                          }}
                        >
                          {networkPolicy.riskTier.toUpperCase()} RISK
                        </span>
                      </div>

                      {localPolicy && (
                        <button
                          onClick={() => handleShowDiff(networkPolicy, localPolicy)}
                          style={{
                            marginTop: '16px',
                            padding: '8px 16px',
                            background: 'transparent',
                            border: `1px solid ${accentColor}`,
                            borderRadius: '8px',
                            color: accentColor,
                            fontSize: '13px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Compare with Local Policy
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      padding: '40px',
                      textAlign: 'center',
                      background: tabBg,
                      borderRadius: '12px',
                      border: `1px dashed ${borderColor}`,
                    }}>
                      <p style={{ fontSize: '32px', marginBottom: '12px' }}>🌐</p>
                      <p style={{ color: mutedColor, margin: '0 0 16px' }}>
                        No network baseline policy configured.
                      </p>
                      <button
                        onClick={() => {
                          const nbp = createPolicyFromTemplate('restrictive', 'network', 'Network Baseline Policy')
                          setNetworkPolicy(nbp)
                          showNotification('Created network baseline policy', 'info')
                        }}
                        style={{
                          padding: '8px 16px',
                          background: accentColor,
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Create Network Policy
                      </button>
                    </div>
                  )}
                </div>
              )}
            </ErrorBoundary>
          )}
        </div>

        {/* Diff Modal */}
        {showDiff && diffPolicies && (
          <div
            onClick={() => setShowDiff(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: '800px',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
            >
              <PolicyDiffView
                policyA={diffPolicies.a}
                policyB={diffPolicies.b}
                onClose={() => setShowDiff(false)}
                theme={theme}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

