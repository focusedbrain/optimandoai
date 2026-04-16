/**
 * ThisDeviceCard — shows the local device's pairing identity in Settings → Orchestrator.
 *
 * Phase 1 (display-only): surfaces the Coordination ID (instanceId) so a user can copy it
 * and share it with their other device to enable internal handshakes. This component does
 * not perform any validation or mutate any state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ThisDeviceCardProps {
  /** Local device name (from orchestratorMode.getDeviceInfo). */
  deviceName: string
  /** Local device role. */
  mode: 'host' | 'sandbox'
  /** Local coordination device id (the per-install UUID). */
  instanceId: string
}

export default function ThisDeviceCard({ deviceName, mode, instanceId }: ThisDeviceCardProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (!instanceId) return
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(instanceId)
      }
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — no-op; user can still select the text manually */
    }
  }, [instanceId])

  return (
    <div
      data-testid="this-device-card"
      style={{
        marginBottom: '16px',
        padding: '12px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '8px',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
      }}
    >
      <div
        style={{
          display: 'block',
          marginBottom: '10px',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
        }}
      >
        This device
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-text)' }}>
          {deviceName || 'This device'}
        </span>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '999px',
            fontSize: '10px',
            fontWeight: 600,
            textTransform: 'capitalize',
            background: 'rgba(147,51,234,0.2)',
            color: 'var(--purple-accent, #c084fc)',
            border: '1px solid rgba(147,51,234,0.35)',
          }}
        >
          {mode}
        </span>
      </div>

      <div
        style={{
          display: 'block',
          marginBottom: '6px',
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        Coordination ID
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <code
          data-testid="this-device-coordination-id"
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            padding: '8px 10px',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: '12px',
            lineHeight: 1.4,
            color: 'var(--color-text, #e2e8f0)',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
            borderRadius: '6px',
            userSelect: 'all',
            wordBreak: 'break-all',
          }}
        >
          {instanceId || '—'}
        </code>
        <button
          type="button"
          data-testid="this-device-copy-button"
          aria-label="Copy Coordination ID"
          onClick={() => { void handleCopy() }}
          disabled={!instanceId}
          style={{
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: 600,
            background: copied ? 'rgba(16,185,129,0.2)' : 'var(--color-accent-bg, rgba(147,51,234,0.15))',
            border: `1px solid ${copied ? 'rgba(16,185,129,0.45)' : 'var(--color-accent-border, rgba(147,51,234,0.35))'}`,
            borderRadius: '6px',
            color: copied ? 'var(--success-dark, #10b981)' : 'var(--color-accent, #c084fc)',
            cursor: instanceId ? 'pointer' : 'not-allowed',
            flexShrink: 0,
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p
        style={{
          margin: '10px 0 0',
          fontSize: '12px',
          lineHeight: 1.5,
          color: 'var(--color-text-muted)',
        }}
      >
        Share this ID with your other device to pair it for internal handshakes.
      </p>
    </div>
  )
}
