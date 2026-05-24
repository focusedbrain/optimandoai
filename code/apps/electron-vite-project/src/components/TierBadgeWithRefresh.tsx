/**
 * Reusable tier badge with manual refresh — Phase 4.5 (P4.5.3).
 * Visual reference: extension vault `#wrv-tier-badge` (uppercase pill, accent border).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
function TierRefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={spinning ? { animation: 'tier-badge-refresh-spin 0.8s linear infinite' } : undefined}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

function formatTierBadgeLabel(tier: string): string {
  if (tier === 'free') return 'Free'
  if (tier === 'enterprise') return 'Enterprise'
  if (tier === 'publisher' || tier === 'publisher_lifetime') return 'Publisher'
  if (tier === 'pro') return 'Pro'
  if (tier === 'private' || tier === 'private_lifetime') return 'Private'
  return tier.replace(/_/g, ' ')
}

export interface TierBadgeWithRefreshProps {
  initialTier: string
  onRefresh: () => Promise<{ tier: string }>
  displayHint?: 'default' | 'upgrade-prompt'
}

const COOLDOWN_MS = 5000

const badgeStyle: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  background: 'rgba(99, 102, 241, 0.12)',
  color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.2)',
  lineHeight: 1.4,
}

const refreshButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: 4,
  border: '1px solid transparent',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer',
  flexShrink: 0,
}

const refreshButtonDisabledStyle: CSSProperties = {
  ...refreshButtonStyle,
  cursor: 'wait',
  opacity: 0.65,
}

const tooltipStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  padding: '4px 8px',
  borderRadius: 4,
  background: '#1e293b',
  border: '1px solid #475569',
  color: '#cbd5e1',
  fontSize: 11,
  whiteSpace: 'nowrap',
  zIndex: 1,
}

export function TierBadgeWithRefresh({
  initialTier,
  onRefresh,
  displayHint = 'default',
}: TierBadgeWithRefreshProps) {
  const [tier, setTier] = useState(initialTier)
  const [refreshing, setRefreshing] = useState(false)
  const [cooldownTooltip, setCooldownTooltip] = useState(false)
  const lastRefreshAtRef = useRef<number | null>(null)
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTier(initialTier)
  }, [initialTier])

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    }
  }, [])

  const refreshAriaLabel =
    displayHint === 'upgrade-prompt'
      ? 'Refresh plan tier to check upgrade'
      : 'Refresh plan tier'

  const handleRefresh = useCallback(async () => {
    if (refreshing) return

    const now = Date.now()
    if (lastRefreshAtRef.current != null && now - lastRefreshAtRef.current < COOLDOWN_MS) {
      setCooldownTooltip(true)
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
      cooldownTimerRef.current = setTimeout(() => setCooldownTooltip(false), 2500)
      return
    }

    setRefreshing(true)
    try {
      const result = await onRefresh()
      setTier(result.tier)
      lastRefreshAtRef.current = Date.now()
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, refreshing])

  return (
    <div
      data-testid="tier-badge-with-refresh"
      role="group"
      aria-label="Current plan tier"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, position: 'relative' }}
    >
      <style>{`@keyframes tier-badge-refresh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <span data-testid="tier-badge" style={badgeStyle}>
        {formatTierBadgeLabel(tier)}
      </span>
      <button
        type="button"
        data-testid="tier-badge-refresh"
        aria-label={refreshAriaLabel}
        aria-busy={refreshing}
        disabled={refreshing}
        onClick={() => void handleRefresh()}
        style={refreshing ? refreshButtonDisabledStyle : refreshButtonStyle}
      >
        <TierRefreshIcon spinning={refreshing} />
      </button>
      {cooldownTooltip ? (
        <span
          data-testid="tier-badge-refresh-cooldown"
          role="status"
          aria-live="polite"
          style={tooltipStyle}
        >
          Already refreshed just now
        </span>
      ) : null}
    </div>
  )
}
