/**
 * ThisDeviceCard — shows the local device's pairing identity in Settings → Orchestrator.
 *
 * Surfaces the per-account 6-digit pairing code. The user enters this code on their
 * other device (or vice versa) when initiating an internal handshake — it's the
 * shared secret that gives both devices a coordination identity. The underlying
 * instanceId (UUID) is intentionally NOT shown — it's an implementation detail.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ThisDeviceCardProps {
  /** Local device name (from orchestratorMode.getDeviceInfo). */
  deviceName: string
  /** Local device role. */
  mode: 'host' | 'sandbox'
  /** Local 6-digit pairing code (decimal digits, no dash; "" if not yet generated). */
  pairingCode: string
}

/** Insert a dash after the third digit purely for display. Falls back to "—" when empty. */
function formatPairingCode(code: string): string {
  if (!code) return '—'
  const digits = code.replace(/\D+/g, '')
  if (digits.length !== 6) return code
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}

export default function ThisDeviceCard({ deviceName, mode, pairingCode }: ThisDeviceCardProps) {
  const [displayedCode, setDisplayedCode] = useState(pairingCode)
  const [regenerating, setRegenerating] = useState(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep local state in sync if the parent reloads the config.
  useEffect(() => {
    setDisplayedCode(pairingCode)
  }, [pairingCode])

  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = null
      }
    }
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (regenerating) return
    setRegenerating(true)
    setError(null)
    setConfirmation(null)
    try {
      const bridge = (window as unknown as {
        orchestratorMode?: {
          regeneratePairingCode?: () => Promise<{ ok: boolean; pairingCode?: string; error?: string }>
        }
      }).orchestratorMode
      if (!bridge?.regeneratePairingCode) {
        throw new Error('Pairing code service unavailable')
      }
      const res = await bridge.regeneratePairingCode()
      if (!res?.ok || !res.pairingCode) {
        throw new Error(res?.error || 'Failed to regenerate pairing code')
      }
      setDisplayedCode(res.pairingCode)
      setConfirmation('New code generated')
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = setTimeout(() => setConfirmation(null), 2000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
      fadeTimerRef.current = setTimeout(() => setError(null), 4000)
    } finally {
      setRegenerating(false)
    }
  }, [regenerating])

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
        Pairing code
      </div>
      <div
        data-testid="this-device-pairing-code"
        style={{
          display: 'inline-block',
          padding: '10px 14px',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: '22px',
          fontWeight: 600,
          letterSpacing: '2px',
          lineHeight: 1.2,
          color: 'var(--color-text, #e2e8f0)',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          borderRadius: '6px',
          userSelect: 'all',
        }}
      >
        {formatPairingCode(displayedCode)}
      </div>

      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="this-device-regenerate-button"
          onClick={() => { void handleRegenerate() }}
          disabled={regenerating}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 600,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid var(--color-border, rgba(255,255,255,0.16))',
            borderRadius: '6px',
            color: 'var(--color-text, #e2e8f0)',
            cursor: regenerating ? 'wait' : 'pointer',
            opacity: regenerating ? 0.7 : 1,
          }}
        >
          {regenerating ? 'Regenerating...' : 'Regenerate'}
        </button>
        {confirmation && (
          <span
            data-testid="this-device-pairing-code-confirmation"
            style={{
              fontSize: '12px',
              color: 'var(--success-dark, #10b981)',
              transition: 'opacity 0.3s ease',
            }}
          >
            {confirmation}
          </span>
        )}
        {error && (
          <span
            data-testid="this-device-pairing-code-error"
            style={{ fontSize: '12px', color: 'var(--color-danger, #f87171)' }}
          >
            {error}
          </span>
        )}
      </div>

      <p
        style={{
          margin: '10px 0 0',
          fontSize: '12px',
          lineHeight: 1.5,
          color: 'var(--color-text-muted)',
        }}
      >
        Enter this code on your other device when initiating an internal handshake.
      </p>
    </div>
  )
}
