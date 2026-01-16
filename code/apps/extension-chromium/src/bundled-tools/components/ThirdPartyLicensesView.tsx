/**
 * Third Party Licenses View Component
 * 
 * Displays all bundled third-party components with their licenses.
 * Accessible from Settings → Legal / About → Third Party Licenses.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { BUNDLED_TOOL_LICENSES, type BundledToolLicenseEntry } from '../licenses'
import { getToolRegistry, exportToolInfo } from '../registry'

interface ThirdPartyLicensesViewProps {
  theme: 'pro' | 'dark' | 'standard'
  onClose?: () => void
}

export const ThirdPartyLicensesView: React.FC<ThirdPartyLicensesViewProps> = ({
  theme,
  onClose
}) => {
  // Map old theme names for backward compatibility
  const effectiveTheme = theme === 'pro' ? 'pro' : theme === 'dark' ? 'dark' : 'standard'
  const isProfessional = effectiveTheme === 'standard'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(0,0,0,0.95)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  const [showRuntimeInfo, setShowRuntimeInfo] = useState(false)
  
  // Get runtime tool info for display
  const runtimeTools = exportToolInfo()
  
  const toggleExpanded = (toolId: string) => {
    setExpandedTool(expandedTool === toolId ? null : toolId)
  }
  
  const getCategoryIcon = (category: 'parser' | 'rasterizer') => {
    return category === 'parser' ? '📄' : '🖼️'
  }
  
  const getCategoryLabel = (category: 'parser' | 'rasterizer') => {
    return category === 'parser' ? 'Semantic Parser' : 'Visual Rasterizer'
  }
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      <div style={{
        background: bgColor,
        borderRadius: '12px',
        width: '100%',
        maxWidth: '700px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: `1px solid ${borderColor}`
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <h2 style={{ 
              margin: 0, 
              fontSize: '18px', 
              fontWeight: 600, 
              color: textColor,
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span>📜</span> Third Party Licenses
            </h2>
            <p style={{ 
              margin: '4px 0 0 0', 
              fontSize: '12px', 
              color: mutedColor 
            }}>
              Open source components bundled with this application
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: mutedColor,
                fontSize: '20px',
                cursor: 'pointer',
                padding: '4px 8px'
              }}
            >
              ×
            </button>
          )}
        </div>
        
        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Intro */}
          <div style={{
            background: isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            color: textColor,
            lineHeight: '1.5'
          }}>
            <strong>BEAP™ Processing Tools</strong>
            <br />
            The following components are bundled locally for offline parsing and rasterization. 
            They run in isolated processes and are never downloaded at runtime.
          </div>
          
          {/* Tool List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {BUNDLED_TOOL_LICENSES.map((tool) => (
              <ToolLicenseCard
                key={tool.id}
                tool={tool}
                isExpanded={expandedTool === tool.id}
                onToggle={() => toggleExpanded(tool.id)}
                theme={theme}
                getCategoryIcon={getCategoryIcon}
                getCategoryLabel={getCategoryLabel}
              />
            ))}
          </div>
          
          {/* Runtime Info Toggle */}
          <div style={{ marginTop: '20px' }}>
            <button
              onClick={() => setShowRuntimeInfo(!showRuntimeInfo)}
              style={{
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                color: mutedColor,
                borderRadius: '6px',
                padding: '8px 14px',
                fontSize: '11px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {showRuntimeInfo ? '▼' : '▶'} Runtime Tool Information
            </button>
            
            {showRuntimeInfo && (
              <div style={{
                marginTop: '10px',
                background: cardBg,
                borderRadius: '8px',
                padding: '12px',
                border: `1px solid ${borderColor}`
              }}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Installed Components (for diagnostics/attestation)
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '10px', color: textColor }}>
                  {runtimeTools.map(tool => (
                    <div key={tool.id} style={{ marginBottom: '6px', padding: '6px', background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                      <div><strong>{tool.name}</strong> v{tool.version}</div>
                      <div style={{ color: mutedColor }}>License: {tool.license}</div>
                      <div style={{ color: mutedColor, wordBreak: 'break-all' }}>Hash: {tool.hash.slice(0, 16)}...</div>
                      <div style={{ color: tool.status === 'installed' ? '#22c55e' : '#ef4444' }}>
                        Status: {tool.status}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div style={{
          padding: '12px 20px',
          borderTop: `1px solid ${borderColor}`,
          fontSize: '11px',
          color: mutedColor,
          textAlign: 'center'
        }}>
          All components use permissive licenses (Apache-2.0, BSD-3-Clause). No GPL/AGPL components.
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Tool License Card Sub-Component
// =============================================================================

interface ToolLicenseCardProps {
  tool: BundledToolLicenseEntry
  isExpanded: boolean
  onToggle: () => void
  theme: 'pro' | 'dark' | 'standard'
  getCategoryIcon: (category: 'parser' | 'rasterizer') => string
  getCategoryLabel: (category: 'parser' | 'rasterizer') => string
}

const ToolLicenseCard: React.FC<ToolLicenseCardProps> = ({
  tool,
  isExpanded,
  onToggle,
  theme,
  getCategoryIcon,
  getCategoryLabel
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  
  return (
    <div style={{
      background: cardBg,
      borderRadius: '8px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden'
    }}>
      {/* Card Header - Clickable */}
      <div
        onClick={onToggle}
        style={{
          padding: '14px 16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px'
        }}
      >
        {/* Icon */}
        <span style={{ fontSize: '24px' }}>{getCategoryIcon(tool.category)}</span>
        
        {/* Content */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
              {tool.name}
            </span>
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: isProfessional ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
              color: '#3b82f6'
            }}>
              v{tool.version}
            </span>
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: isProfessional ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.2)',
              color: '#22c55e'
            }}>
              {tool.license.identifier}
            </span>
          </div>
          <div style={{ fontSize: '11px', color: mutedColor, marginBottom: '4px' }}>
            {getCategoryLabel(tool.category)}
          </div>
          <div style={{ fontSize: '12px', color: textColor, lineHeight: '1.4' }}>
            {tool.description}
          </div>
        </div>
        
        {/* Expand Arrow */}
        <span style={{ color: mutedColor, fontSize: '12px' }}>
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>
      
      {/* Expanded Content - License */}
      {isExpanded && (
        <div style={{
          padding: '0 16px 16px 16px',
          borderTop: `1px solid ${borderColor}`
        }}>
          {/* License Header */}
          <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>
                {tool.license.name}
              </div>
              <div style={{ fontSize: '10px', color: mutedColor, marginTop: '2px' }}>
                Copyright: {tool.license.copyrightHolders.join(', ')}
              </div>
            </div>
            <a
              href={tool.license.upstreamUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '11px',
                color: '#3b82f6',
                textDecoration: 'none'
              }}
            >
              View Project →
            </a>
          </div>
          
          {/* Full License Text */}
          <div style={{
            background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.3)',
            borderRadius: '6px',
            padding: '12px',
            maxHeight: '300px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: '10px',
            lineHeight: '1.5',
            color: mutedColor,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {tool.license.fullText}
          </div>
        </div>
      )}
    </div>
  )
}

export default ThirdPartyLicensesView

