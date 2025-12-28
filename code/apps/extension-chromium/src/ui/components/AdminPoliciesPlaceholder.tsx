/**
 * AdminPoliciesPlaceholder Component
 * 
 * Placeholder UI for Admin Policies mode.
 * Two-panel layout: Policy editor + Targets/Publish area.
 */

import React from 'react'

interface AdminPoliciesPlaceholderProps {
  theme?: 'default' | 'dark' | 'professional'
  className?: string
}

export const AdminPoliciesPlaceholder: React.FC<AdminPoliciesPlaceholderProps> = ({
  theme = 'default',
  className = ''
}) => {
  const getThemeStyles = () => {
    switch (theme) {
      case 'professional':
        return {
          banner: { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#b45309' },
          panel: { background: '#ffffff', border: '1px solid #e2e8f0' },
          header: { background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#0f172a' },
          item: { background: '#f8fafc', border: '1px solid #e2e8f0' },
          button: { background: '#3b82f6', color: 'white' },
          buttonSecondary: { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }
        }
      case 'dark':
        return {
          banner: { background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' },
          panel: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' },
          header: { background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#e5e7eb' },
          item: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' },
          button: { background: '#8b5cf6', color: 'white' },
          buttonSecondary: { background: 'rgba(255,255,255,0.1)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.15)' }
        }
      default:
        return {
          banner: { background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.3)', color: '#fcd34d' },
          panel: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' },
          header: { background: 'rgba(0,0,0,0.15)', borderBottom: '1px solid rgba(255,255,255,0.15)', color: 'white' },
          item: { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' },
          button: { background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', color: 'white' },
          buttonSecondary: { background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.25)' }
        }
    }
  }

  const styles = getThemeStyles()

  const mockPolicies = [
    { name: 'Data Retention', status: 'active' },
    { name: 'Access Control', status: 'active' },
    { name: 'Encryption Rules', status: 'draft' }
  ]

  const mockTargets = [
    { name: 'All Users', count: 128 },
    { name: 'Admins', count: 5 },
    { name: 'External', count: 42 }
  ]

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Placeholder Banner */}
      <div style={{
        ...styles.banner,
        padding: '8px 12px',
        margin: '8px',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '11px'
      }}>
        <span>⚠️</span>
        <span><strong>Admin – Policies</strong> - UI Preview (not functional)</span>
      </div>

      {/* Two-Panel Layout */}
      <div style={{ flex: 1, display: 'flex', margin: '0 8px 8px', gap: '8px', overflow: 'hidden' }}>
        {/* Left Panel: Policy Editor */}
        <div style={{
          flex: 1,
          ...styles.panel,
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            ...styles.header,
            padding: '10px 12px',
            fontWeight: 600,
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>🛡️ Policy Editor</span>
            <button style={{
              ...styles.buttonSecondary,
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '10px',
              cursor: 'not-allowed',
              opacity: 0.5
            }}>
              + New Policy
            </button>
          </div>
          
          <div style={{ flex: 1, padding: '8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mockPolicies.map((policy, i) => (
              <div key={i} style={{
                ...styles.item,
                padding: '10px 12px',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 500 }}>{policy.name}</div>
                  <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '2px' }}>
                    Last modified: Today
                  </div>
                </div>
                <span style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: policy.status === 'active' ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)',
                  color: policy.status === 'active' ? '#22c55e' : '#f59e0b'
                }}>
                  {policy.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right Panel: Targets & Publish */}
        <div style={{
          width: '180px',
          ...styles.panel,
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          <div style={{
            ...styles.header,
            padding: '10px 12px',
            fontWeight: 600,
            fontSize: '12px'
          }}>
            🎯 Targets
          </div>
          
          <div style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mockTargets.map((target, i) => (
              <div key={i} style={{
                ...styles.item,
                padding: '8px 10px',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '11px'
              }}>
                <span>{target.name}</span>
                <span style={{ opacity: 0.6 }}>{target.count}</span>
              </div>
            ))}
          </div>

          {/* Publish Button */}
          <div style={{ padding: '8px' }}>
            <button style={{
              ...styles.button,
              width: '100%',
              padding: '10px',
              borderRadius: '6px',
              border: 'none',
              fontWeight: 600,
              fontSize: '12px',
              cursor: 'not-allowed',
              opacity: 0.5
            }}>
              📤 Publish Policies
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AdminPoliciesPlaceholder






