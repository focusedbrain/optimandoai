/**
 * Channels Domain Editor
 * 
 * Visual editor for ingress channel settings.
 * Controls WHAT DOORS EXIST for packages to enter.
 * 
 * BEAP SECURITY:
 * - BEAP is the primary/mandatory channel
 * - Non-BEAP channels must wrap into BEAP
 */

import type { ChannelsPolicy, ChannelConfig, AttestationTier, NetworkScope } from '../../schema'

interface ChannelsEditorProps {
  policy: ChannelsPolicy
  onChange: (updated: ChannelsPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
}

const ATTESTATION_TIERS: { value: AttestationTier; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No attestation (dev only)' },
  { value: 'self_signed', label: 'Self-Signed', description: 'Self-signed keys accepted' },
  { value: 'known_sender', label: 'Known Sender', description: 'Handshake registry match' },
  { value: 'verified_org', label: 'Verified Org', description: 'Organization key verified' },
  { value: 'hardware_bound', label: 'Hardware Bound', description: 'Hardware attestation required' },
]

const NETWORK_SCOPES: { value: NetworkScope; label: string }[] = [
  { value: 'localhost', label: 'Localhost' },
  { value: 'lan', label: 'LAN' },
  { value: 'vpn', label: 'VPN' },
  { value: 'internet', label: 'Internet' },
]

const CHANNELS: {
  key: keyof Omit<ChannelsPolicy, 'requireBeapWrapper' | 'auditChannelActivity'>
  name: string
  icon: string
  description: string
  mandatory?: boolean
}[] = [
  { key: 'beapPackages', name: 'BEAP Packages', icon: '📦', description: 'Primary secure transport', mandatory: true },
  { key: 'localPackageBuilder', name: 'Local Package Builder', icon: '🔧', description: 'Local authoring' },
  { key: 'browserExtension', name: 'Browser Extension', icon: '🌐', description: 'Extension inbound' },
  { key: 'httpsWebhooks', name: 'HTTPS Webhooks', icon: '🔗', description: 'Non-BEAP inbound (must wrap)' },
  { key: 'emailBridge', name: 'Email Bridge', icon: '📧', description: 'Legacy email (must wrap)' },
  { key: 'filesystemWatch', name: 'Filesystem Watch', icon: '📁', description: 'Folder drop' },
]

export function ChannelsEditor({ policy, onChange, theme = 'default' }: ChannelsEditorProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'
  const activeBg = isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.1)'
  const inactiveBg = isDark ? 'rgba(239, 68, 68, 0.05)' : 'rgba(239, 68, 68, 0.05)'

  const updateChannel = (key: keyof ChannelsPolicy, updates: Partial<ChannelConfig>) => {
    const current = policy[key] as ChannelConfig
    onChange({
      ...policy,
      [key]: { ...current, ...updates },
    })
  }

  const toggleScope = (key: keyof ChannelsPolicy, scope: NetworkScope) => {
    const current = policy[key] as ChannelConfig
    const scopes = current.allowedScopes || []
    const updated = scopes.includes(scope)
      ? scopes.filter(s => s !== scope)
      : [...scopes, scope]
    updateChannel(key, { allowedScopes: updated })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Security Notice */}
      <div style={{
        padding: '14px 16px',
        background: isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.1)',
        border: `1px solid ${isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'start',
        gap: '12px',
      }}>
        <span style={{ fontSize: '18px' }}>🔐</span>
        <div>
          <div style={{ color: textColor, fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
            BEAP Security Invariant
          </div>
          <div style={{ color: mutedColor, fontSize: '12px', lineHeight: '1.5' }}>
            All packages must be BEAP-verified before content processing. Non-BEAP channels wrap
            into BEAP before entering the policy engine. No content parsing occurs before verification.
          </div>
        </div>
      </div>

      {/* Channel Cards */}
      {CHANNELS.map(channel => {
        const config = policy[channel.key] as ChannelConfig
        const isEnabled = config?.enabled ?? false
        
        return (
          <div
            key={channel.key}
            style={{
              padding: '16px',
              background: isEnabled ? activeBg : inactiveBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>{channel.icon}</span>
                <div>
                  <div style={{ color: textColor, fontWeight: 600, fontSize: '14px' }}>
                    {channel.name}
                    {channel.mandatory && (
                      <span style={{ marginLeft: '8px', fontSize: '10px', color: '#8b5cf6', fontWeight: 500 }}>
                        PRIMARY
                      </span>
                    )}
                  </div>
                  <div style={{ color: mutedColor, fontSize: '12px' }}>{channel.description}</div>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => updateChannel(channel.key, { enabled: !isEnabled })}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ color: isEnabled ? '#22c55e' : '#ef4444', fontWeight: 500, fontSize: '12px' }}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            {isEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${borderColor}` }}>
                {/* Attestation Tier */}
                <div>
                  <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Required Attestation
                  </label>
                  <select
                    value={config.requiredAttestation}
                    onChange={(e) => updateChannel(channel.key, { requiredAttestation: e.target.value as AttestationTier })}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: cardBg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: '6px',
                      color: textColor,
                      fontSize: '13px',
                    }}
                  >
                    {ATTESTATION_TIERS.map(tier => (
                      <option key={tier.value} value={tier.value}>{tier.label}</option>
                    ))}
                  </select>
                </div>

                {/* Rate Limit */}
                <div>
                  <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Rate Limit/Hour (0 = unlimited)
                  </label>
                  <input
                    type="number"
                    value={config.rateLimitPerHour}
                    onChange={(e) => updateChannel(channel.key, { rateLimitPerHour: parseInt(e.target.value) || 0 })}
                    min={0}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: cardBg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: '6px',
                      color: textColor,
                      fontSize: '13px',
                    }}
                  />
                </div>

                {/* Network Scopes */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Allowed Network Scopes
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {NETWORK_SCOPES.map(scope => {
                      const isActive = config.allowedScopes?.includes(scope.value)
                      return (
                        <button
                          key={scope.value}
                          onClick={() => toggleScope(channel.key, scope.value)}
                          style={{
                            padding: '6px 12px',
                            background: isActive ? 'rgba(139, 92, 246, 0.2)' : cardBg,
                            border: `1px solid ${isActive ? '#8b5cf6' : borderColor}`,
                            borderRadius: '6px',
                            color: isActive ? '#a78bfa' : mutedColor,
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: isActive ? 600 : 400,
                          }}
                        >
                          {scope.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Global Settings */}
      <div style={{ padding: '16px', background: cardBg, border: `1px solid ${borderColor}`, borderRadius: '10px' }}>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Global Channel Settings
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.requireBeapWrapper}
              onChange={() => onChange({ ...policy, requireBeapWrapper: !policy.requireBeapWrapper })}
              style={{ width: '16px', height: '16px' }}
            />
            <div>
              <span style={{ color: textColor, fontSize: '13px', fontWeight: 500 }}>Require BEAP Wrapper</span>
              <span style={{ color: mutedColor, fontSize: '12px', marginLeft: '8px' }}>
                Non-BEAP must wrap into BEAP
              </span>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.auditChannelActivity}
              onChange={() => onChange({ ...policy, auditChannelActivity: !policy.auditChannelActivity })}
              style={{ width: '16px', height: '16px' }}
            />
            <div>
              <span style={{ color: textColor, fontSize: '13px', fontWeight: 500 }}>Audit Channel Activity</span>
              <span style={{ color: mutedColor, fontSize: '12px', marginLeft: '8px' }}>
                Log all channel events
              </span>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}


