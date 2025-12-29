/**
 * Pre-Verification Handling Editor
 * 
 * Visual editor for pre-verification settings.
 * Controls DoS protection, rate limits, quarantine BEFORE BEAP verification.
 * 
 * BEAP SECURITY:
 * - NO content parsing at this stage
 * - Only envelope-level / size-level checks
 */

import type { PreVerificationPolicy, QuarantineBehavior, RateLimitAction } from '../../schema'

interface PreVerificationEditorProps {
  policy: PreVerificationPolicy
  onChange: (updated: PreVerificationPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
}

const QUARANTINE_BEHAVIORS: { value: QuarantineBehavior; label: string }[] = [
  { value: 'reject', label: 'Reject' },
  { value: 'quarantine', label: 'Quarantine' },
  { value: 'hold_timeout', label: 'Hold with Timeout' },
  { value: 'drop_silent', label: 'Drop Silent' },
]

const RATE_LIMIT_ACTIONS: { value: RateLimitAction; label: string }[] = [
  { value: 'reject', label: 'Reject' },
  { value: 'queue', label: 'Queue' },
  { value: 'throttle', label: 'Throttle' },
  { value: 'drop_silent', label: 'Drop Silent' },
]

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`
  return `${bytes} B`
}

export function PreVerificationEditor({ policy, onChange, theme = 'default' }: PreVerificationEditorProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'
  const inputBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'

  const updateNumber = (key: keyof PreVerificationPolicy, value: number) => {
    onChange({ ...policy, [key]: value })
  }

  const updateSelect = (key: keyof PreVerificationPolicy, value: string) => {
    onChange({ ...policy, [key]: value })
  }

  const toggleBoolean = (key: keyof PreVerificationPolicy) => {
    onChange({ ...policy, [key]: !policy[key] })
  }

  const sectionStyle = {
    padding: '16px',
    background: cardBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '10px',
  }

  const labelStyle = {
    display: 'block',
    color: mutedColor,
    fontSize: '11px',
    marginBottom: '6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    background: inputBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    color: textColor,
    fontSize: '13px',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Security Notice */}
      <div style={{
        padding: '14px 16px',
        background: isDark ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.1)',
        border: `1px solid ${isDark ? 'rgba(245, 158, 11, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'start',
        gap: '12px',
      }}>
        <span style={{ fontSize: '18px' }}>⚠️</span>
        <div>
          <div style={{ color: textColor, fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
            Pre-Verification Layer
          </div>
          <div style={{ color: mutedColor, fontSize: '12px', lineHeight: '1.5' }}>
            These controls operate BEFORE BEAP verification completes. No content inspection
            occurs here—only envelope-level DoS protection, rate limiting, and storage limits.
          </div>
        </div>
      </div>

      {/* Package Limits */}
      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 16px', color: textColor, fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📦</span> Package Limits
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Max Package Size</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min={1_000_000}
                max={500_000_000}
                step={1_000_000}
                value={policy.maxPackageSizeBytes}
                onChange={(e) => updateNumber('maxPackageSizeBytes', parseInt(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: textColor, fontSize: '12px', minWidth: '70px' }}>
                {formatBytes(policy.maxPackageSizeBytes)}
              </span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Max Artefact Size</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min={1_000_000}
                max={200_000_000}
                step={1_000_000}
                value={policy.maxArtefactSizeBytes}
                onChange={(e) => updateNumber('maxArtefactSizeBytes', parseInt(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ color: textColor, fontSize: '12px', minWidth: '70px' }}>
                {formatBytes(policy.maxArtefactSizeBytes)}
              </span>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Max Chunks/Package</label>
            <input
              type="number"
              value={policy.maxChunksPerPackage}
              onChange={(e) => updateNumber('maxChunksPerPackage', parseInt(e.target.value) || 1)}
              min={1}
              max={1000}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Max Artefacts/Package</label>
            <input
              type="number"
              value={policy.maxArtefactsPerPackage}
              onChange={(e) => updateNumber('maxArtefactsPerPackage', parseInt(e.target.value) || 1)}
              min={1}
              max={500}
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Rate Limiting */}
      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 16px', color: textColor, fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>⏱️</span> Rate Limiting
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Packages/Sender/Hour</label>
            <input
              type="number"
              value={policy.maxPackagesPerSenderPerHour}
              onChange={(e) => updateNumber('maxPackagesPerSenderPerHour', parseInt(e.target.value) || 0)}
              min={0}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Packages/Group/Hour</label>
            <input
              type="number"
              value={policy.maxPackagesPerGroupPerHour}
              onChange={(e) => updateNumber('maxPackagesPerGroupPerHour', parseInt(e.target.value) || 0)}
              min={0}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Unknown Sender/Hour</label>
            <input
              type="number"
              value={policy.maxUnknownSenderPackagesPerHour}
              onChange={(e) => updateNumber('maxUnknownSenderPackagesPerHour', parseInt(e.target.value) || 0)}
              min={0}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Rate Limit Action</label>
            <select
              value={policy.rateLimitAction}
              onChange={(e) => updateSelect('rateLimitAction', e.target.value)}
              style={inputStyle}
            >
              {RATE_LIMIT_ACTIONS.map(action => (
                <option key={action.value} value={action.value}>{action.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quarantine Behavior */}
      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 16px', color: textColor, fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>🚫</span> Failure Handling
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Verification Failure</label>
            <select
              value={policy.verificationFailureBehavior}
              onChange={(e) => updateSelect('verificationFailureBehavior', e.target.value)}
              style={inputStyle}
            >
              {QUARANTINE_BEHAVIORS.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Invalid Signature</label>
            <select
              value={policy.invalidSignatureBehavior}
              onChange={(e) => updateSelect('invalidSignatureBehavior', e.target.value)}
              style={inputStyle}
            >
              {QUARANTINE_BEHAVIORS.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Blocked Sender</label>
            <select
              value={policy.blockedSenderBehavior}
              onChange={(e) => updateSelect('blockedSenderBehavior', e.target.value)}
              style={inputStyle}
            >
              {QUARANTINE_BEHAVIORS.map(b => (
                <option key={b.value} value={b.value}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Quarantine Timeout (sec)</label>
            <input
              type="number"
              value={policy.quarantineTimeoutSeconds}
              onChange={(e) => updateNumber('quarantineTimeoutSeconds', parseInt(e.target.value) || 0)}
              min={0}
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Verification Requirements */}
      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 16px', color: textColor, fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>✅</span> Verification Requirements
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { key: 'requireValidEnvelope', label: 'Require Valid Envelope', desc: 'BEAP structure validation' },
            { key: 'requireValidTimestamp', label: 'Require Valid Timestamp', desc: 'Within validity window' },
            { key: 'requireReplayProtection', label: 'Require Replay Protection', desc: 'Nonce verification' },
          ].map(item => (
            <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={policy[item.key as keyof PreVerificationPolicy] as boolean}
                onChange={() => toggleBoolean(item.key as keyof PreVerificationPolicy)}
                style={{ width: '16px', height: '16px' }}
              />
              <div>
                <span style={{ color: textColor, fontSize: '13px', fontWeight: 500 }}>{item.label}</span>
                <span style={{ color: mutedColor, fontSize: '12px', marginLeft: '8px' }}>{item.desc}</span>
              </div>
            </label>
          ))}
          <div style={{ marginTop: '8px' }}>
            <label style={labelStyle}>Timestamp Validity Window (sec)</label>
            <input
              type="number"
              value={policy.timestampValidityWindowSeconds}
              onChange={(e) => updateNumber('timestampValidityWindowSeconds', parseInt(e.target.value) || 60)}
              min={10}
              max={86400}
              style={{ ...inputStyle, width: '150px' }}
            />
          </div>
        </div>
      </div>

      {/* Audit */}
      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📋</span> Audit Settings
        </h4>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
          {[
            { key: 'auditPreVerification', label: 'Audit Pre-Verification' },
            { key: 'auditRejections', label: 'Audit Rejections' },
            { key: 'auditRateLimits', label: 'Audit Rate Limits' },
          ].map(item => (
            <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={policy[item.key as keyof PreVerificationPolicy] as boolean}
                onChange={() => toggleBoolean(item.key as keyof PreVerificationPolicy)}
                style={{ width: '16px', height: '16px' }}
              />
              <span style={{ color: textColor, fontSize: '13px' }}>{item.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}


