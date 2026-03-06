/**
 * SettingsView — Application settings including High-Assurance Relay.
 * Tier-gated: only Pro, Publisher, Enterprise can access relay setup.
 */

import { useState, useEffect } from 'react'
import RelaySetupWizard from './RelaySetupWizard'

const ALLOWED_TIERS = new Set(['pro', 'publisher', 'publisher_lifetime', 'enterprise'])

function isTierAllowed(tier: string | null): boolean {
  if (!tier) return false
  const t = tier.toLowerCase().trim()
  return ALLOWED_TIERS.has(t)
}

export default function SettingsView() {
  const [tier, setTier] = useState<string | null>(null)
  const [relayStatus, setRelayStatus] = useState<{
    relay_mode: string
    relay_url: string | null
  } | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [showTlsWizard, setShowTlsWizard] = useState(false)
  const [loading, setLoading] = useState(true)

  const auth = (window as any).auth
  const relay = (window as any).relay

  useEffect(() => {
    if (!auth?.getStatus) return
    auth.getStatus().then((s: { tier?: string | null }) => {
      setTier(s?.tier ?? null)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [auth])

  useEffect(() => {
    if (!relay?.getSetupStatus) return
    relay.getSetupStatus().then((s: any) => {
      setRelayStatus({
        relay_mode: s?.relay_mode ?? 'local',
        relay_url: s?.relay_url ?? null,
      })
    }).catch(() => {})
  }, [relay, showWizard])

  const handleDeactivate = async () => {
    if (!relay?.deactivate) return
    try {
      await relay.deactivate()
      setRelayStatus((prev) => prev ? { ...prev, relay_mode: 'local', relay_url: null } : { relay_mode: 'local', relay_url: null })
    } catch (e) {
      console.error('Deactivate failed:', e)
    }
  }

  const tierAllowed = isTierAllowed(tier)
  const relayActive = relayStatus?.relay_mode === 'remote' && relayStatus?.relay_url

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div style={{
      padding: '24px',
      maxWidth: '560px',
      color: 'var(--color-text)',
    }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: 700 }}>
        Settings
      </h2>

      <section style={{
        marginBottom: '24px',
        padding: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.04))',
        borderRadius: '10px',
        border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>
          High-Assurance Relay
        </h3>
        <div style={{ height: '1px', background: 'var(--color-border)', margin: '0 0 12px' }} />

        {!tierAllowed ? (
          <>
            <p style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
              The High-Assurance Relay adds an extra security layer by validating all incoming BEAP Capsules on a separate server before they reach your computer.
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.6, color: 'var(--color-text-muted)' }}>
              This feature is available on Pro, Publisher, and Enterprise plans.
            </p>
            <button
              type="button"
              onClick={() => {
                // Upgrade link - could open external URL
                window.open('https://wrdesk.com/pricing', '_blank')
              }}
              style={{
                padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
              }}
            >
              Upgrade to Pro →
            </button>
          </>
        ) : relayActive ? (
          <>
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Status: <span style={{ color: 'var(--success-dark, #10b981)' }}>Active ✓</span>
            </p>
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Relay: {relayStatus.relay_url}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Mode: High-Assurance (Remote)
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {relayStatus.relay_url?.startsWith('http://') && (
                <button
                  type="button"
                  onClick={() => setShowTlsWizard(true)}
                  style={{
                    padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                    borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
                  }}
                >
                  Enable TLS
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                style={{
                  padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                  background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                  borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
                }}
              >
                Reconfigure
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                style={{
                  padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                  background: 'transparent', border: '1px solid var(--color-border)',
                  borderRadius: '8px', color: 'var(--color-text-muted)', cursor: 'pointer',
                }}
              >
                Deactivate
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
              Status: Not configured
            </p>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              style={{
                padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                background: 'var(--color-accent-bg)', border: '1px solid var(--color-accent-border)',
                borderRadius: '8px', color: 'var(--color-accent)', cursor: 'pointer',
              }}
            >
              Set Up Relay →
            </button>
          </>
        )}
      </section>
      {showWizard && (
        <RelaySetupWizard
          onClose={() => {
            setShowWizard(false)
            setShowTlsWizard(false)
            relay?.getSetupStatus?.().then((s: any) => {
              setRelayStatus({
                relay_mode: s?.relay_mode ?? 'local',
                relay_url: s?.relay_url ?? null,
              })
            })
          }}
        />
      )}
      {showTlsWizard && !showWizard && (
        <RelaySetupWizard
          initialStep="tls"
          onClose={() => {
            setShowTlsWizard(false)
            relay?.getSetupStatus?.().then((s: any) => {
              setRelayStatus({
                relay_mode: s?.relay_mode ?? 'local',
                relay_url: s?.relay_url ?? null,
              })
            })
          }}
        />
      )}
    </div>
  )
}
