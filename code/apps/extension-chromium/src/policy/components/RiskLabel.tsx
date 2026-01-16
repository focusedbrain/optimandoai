/**
 * Risk Label Component
 * 
 * Displays risk tier badges with appropriate colors.
 */

import type { RiskTier } from '../schema'

interface RiskLabelProps {
  tier: RiskTier
  size?: 'sm' | 'md' | 'lg'
}

export function RiskLabel({ tier, size = 'md' }: RiskLabelProps) {
  const colors: Record<RiskTier, { bg: string; text: string; border: string }> = {
    low: { bg: 'rgba(34, 197, 94, 0.1)', text: '#22c55e', border: 'rgba(34, 197, 94, 0.3)' },
    medium: { bg: 'rgba(234, 179, 8, 0.1)', text: '#eab308', border: 'rgba(234, 179, 8, 0.3)' },
    high: { bg: 'rgba(239, 68, 68, 0.1)', text: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' },
    critical: { bg: 'rgba(139, 92, 246, 0.1)', text: '#8b5cf6', border: 'rgba(139, 92, 246, 0.3)' },
  }

  const sizes = {
    sm: { padding: '2px 6px', fontSize: '10px' },
    md: { padding: '4px 10px', fontSize: '11px' },
    lg: { padding: '6px 12px', fontSize: '12px' },
  }

  const color = colors[tier]
  const sizeStyle = sizes[size]

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: sizeStyle.padding,
        background: color.bg,
        border: `1px solid ${color.border}`,
        borderRadius: '6px',
        color: color.text,
        fontSize: sizeStyle.fontSize,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}
    >
      {tier === 'low' && '✓'}
      {tier === 'medium' && '⚠'}
      {tier === 'high' && '⚡'}
      {tier === 'critical' && '🔴'}
      {tier} RISK
    </span>
  )
}



