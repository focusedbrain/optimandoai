/**
 * ModeHeaderBadge Component
 * 
 * Displays current workspace + mode with a placeholder warning
 * for modes that are not yet functional.
 */

import React from 'react'
import { useUIStore, useIsPlaceholder } from '../../stores/useUIStore'
import { MODE_INFO, WORKSPACE_INFO } from '../../shared/ui/uiState'

interface ModeHeaderBadgeProps {
  /** Theme variant */
  theme?: 'default' | 'dark' | 'professional'
  /** Show full label or compact */
  compact?: boolean
  /** Custom class name */
  className?: string
}

export const ModeHeaderBadge: React.FC<ModeHeaderBadgeProps> = ({
  theme = 'default',
  compact = false,
  className = ''
}) => {
  const { workspace, mode } = useUIStore()
  const isPlaceholder = useIsPlaceholder()

  const workspaceInfo = WORKSPACE_INFO[workspace]
  const modeInfo = workspace === 'wr-chat' ? MODE_INFO[mode] : null

  // Theme styles
  const getStyles = () => {
    const baseContainer: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }

    const baseBadge: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: compact ? '4px 8px' : '6px 10px',
      borderRadius: '6px',
      fontSize: compact ? '11px' : '12px',
      fontWeight: 500
    }

    const baseWarning: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: 500
    }

    switch (theme) {
      case 'professional':
        return {
          container: baseContainer,
          badge: {
            ...baseBadge,
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            color: '#2563eb'
          },
          warning: {
            ...baseWarning,
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.2)',
            color: '#d97706'
          }
        }
      case 'dark':
        return {
          container: baseContainer,
          badge: {
            ...baseBadge,
            background: 'rgba(139,92,246,0.2)',
            border: '1px solid rgba(139,92,246,0.3)',
            color: '#a78bfa'
          },
          warning: {
            ...baseWarning,
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.25)',
            color: '#fbbf24'
          }
        }
      default: // purple
        return {
          container: baseContainer,
          badge: {
            ...baseBadge,
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            color: 'white'
          },
          warning: {
            ...baseWarning,
            background: 'rgba(245,158,11,0.2)',
            border: '1px solid rgba(245,158,11,0.3)',
            color: '#fcd34d'
          }
        }
    }
  }

  const styles = getStyles()

  return (
    <div style={styles.container} className={className}>
      {/* Main Badge */}
      <div style={styles.badge}>
        <span>{workspaceInfo.icon}</span>
        {compact ? (
          <span>
            {modeInfo ? modeInfo.shortLabel : workspaceInfo.label}
          </span>
        ) : (
          <span>
            {workspaceInfo.label}
            {modeInfo && ` · ${modeInfo.label}`}
          </span>
        )}
      </div>

      {/* Placeholder Warning */}
      {isPlaceholder && (
        <div style={styles.warning} title="This mode is a UI placeholder and not yet functional">
          <span>⚠️</span>
          <span>UI Only</span>
        </div>
      )}
    </div>
  )
}

export default ModeHeaderBadge


