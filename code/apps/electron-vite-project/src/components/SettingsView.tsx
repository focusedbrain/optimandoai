/**
 * SettingsView — Application settings including High-Assurance Relay and Inbox AI.
 * Tier-gated: only Pro, Publisher, Enterprise can access relay setup.
 */

import { useState, useEffect, useCallback } from 'react'
import RelaySetupWizard from './RelaySetupWizard'

// ── Inbox AI Settings types ──
interface InboxAiSettings {
  tone: string
  sortRules: string
  contextDocs: Array<{ id: string; name: string; size: number }>
  batchSize: number
}

const ALLOWED_TIERS = new Set(['pro', 'publisher', 'publisher_lifetime', 'enterprise'])

function isTierAllowed(tier: string | null): boolean {
  if (!tier) return false
  const t = tier.toLowerCase().trim()
  return ALLOWED_TIERS.has(t)
}

const DEFAULT_INBOX_AI: InboxAiSettings = {
  tone: '',
  sortRules: '',
  contextDocs: [],
  batchSize: 10,
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
  const [inboxAi, setInboxAi] = useState<InboxAiSettings>(DEFAULT_INBOX_AI)
  const [inboxAiSaving, setInboxAiSaving] = useState(false)
  const [inboxAiUploading, setInboxAiUploading] = useState(false)

  const auth = (window as any).auth
  const relay = (window as any).relay
  const emailInbox = (window as any).emailInbox

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

  const loadInboxAiSettings = useCallback(async () => {
    if (!emailInbox?.getInboxSettings) return
    try {
      const res = await emailInbox.getInboxSettings()
      if (res?.ok && res?.data) {
        const d = res.data
        setInboxAi({
          tone: d.tone ?? '',
          sortRules: d.sortRules ?? '',
          contextDocs: Array.isArray(d.contextDocs) ? d.contextDocs.map((x: any) => ({ id: x.id, name: x.name, size: x.size ?? 0 })) : [],
          batchSize: [10, 12, 24, 48].includes(d.batchSize) ? d.batchSize : 10,
        })
      }
    } catch {
      /* ignore */
    }
  }, [emailInbox])

  useEffect(() => {
    loadInboxAiSettings()
  }, [loadInboxAiSettings])

  const handleDeactivate = async () => {
    if (!relay?.deactivate) return
    try {
      await relay.deactivate()
      setRelayStatus((prev) => prev ? { ...prev, relay_mode: 'local', relay_url: null } : { relay_mode: 'local', relay_url: null })
    } catch (e) {
      console.error('Deactivate failed:', e)
    }
  }

  const saveInboxAiTone = async () => {
    if (!emailInbox?.setInboxSettings) return
    setInboxAiSaving(true)
    try {
      await emailInbox.setInboxSettings({ tone: inboxAi.tone })
    } finally {
      setInboxAiSaving(false)
    }
  }

  const saveInboxAiSortRules = async () => {
    if (!emailInbox?.setInboxSettings) return
    setInboxAiSaving(true)
    try {
      await emailInbox.setInboxSettings({ sortRules: inboxAi.sortRules })
    } finally {
      setInboxAiSaving(false)
    }
  }

  const handleBatchSizeChange = async (size: number) => {
    if (!emailInbox?.setInboxSettings) return
    setInboxAi((prev) => ({ ...prev, batchSize: size }))
    try {
      await emailInbox.setInboxSettings({ batchSize: size })
    } catch {
      /* ignore */
    }
  }

  const handleUploadContextDoc = async () => {
    if (!emailInbox?.selectAndUploadContextDoc) return
    setInboxAiUploading(true)
    try {
      const res = await emailInbox.selectAndUploadContextDoc()
      if (res?.ok && res?.data && !res.data.skipped) {
        const docs = res.data.docs ?? []
        setInboxAi((prev) => ({ ...prev, contextDocs: docs.map((d: any) => ({ id: d.id, name: d.name, size: d.size ?? 0 })) }))
      }
    } finally {
      setInboxAiUploading(false)
    }
  }

  const handleDeleteContextDoc = async (docId: string) => {
    if (!emailInbox?.deleteContextDoc) return
    try {
      const res = await emailInbox.deleteContextDoc(docId)
      if (res?.ok && res?.data?.docs) {
        setInboxAi((prev) => ({ ...prev, contextDocs: res.data.docs }))
      }
    } catch {
      /* ignore */
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

      {/* Inbox AI */}
      <section style={{
        marginBottom: '24px',
        padding: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.04))',
        borderRadius: '10px',
        border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>
          Inbox AI
        </h3>
        <div style={{ height: '1px', background: 'var(--color-border)', margin: '0 0 12px' }} />

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Response Tone & Style
          </label>
          <textarea
            value={inboxAi.tone}
            onChange={(e) => setInboxAi((p) => ({ ...p, tone: e.target.value }))}
            onBlur={saveInboxAiTone}
            placeholder="e.g., Professional and concise. Always greet by first name. Sign off with 'Best regards, [Your Name]'. Use formal German for German emails."
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '13px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
              borderRadius: '8px',
              color: 'var(--color-text, #e2e8f0)',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          {inboxAiSaving && <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px', display: 'block' }}>Saving…</span>}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Custom Sorting Rules
          </label>
          <textarea
            value={inboxAi.sortRules}
            onChange={(e) => setInboxAi((p) => ({ ...p, sortRules: e.target.value }))}
            onBlur={saveInboxAiSortRules}
            placeholder="e.g., Emails from @clientdomain.com are always 'urgent'. Newsletters from Substack are 'normal'. Anything from noreply@ is 'irrelevant' unless it contains an invoice."
            rows={5}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '13px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
              borderRadius: '8px',
              color: 'var(--color-text, #e2e8f0)',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Business Context Documents
          </label>
          <p style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            Upload PDFs to help the AI understand your business, products, and communication style. Content is extracted and included in AI prompts. Max 5 files, 10MB total.
          </p>
          <button
            type="button"
            onClick={handleUploadContextDoc}
            disabled={inboxAiUploading || inboxAi.contextDocs.length >= 5}
            style={{
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: 600,
              background: 'var(--color-accent-bg, rgba(147,51,234,0.2))',
              border: '1px solid var(--color-accent-border, var(--purple-accent))',
              borderRadius: '8px',
              color: 'var(--color-accent, var(--purple-accent))',
              cursor: inboxAiUploading || inboxAi.contextDocs.length >= 5 ? 'not-allowed' : 'pointer',
              opacity: inboxAiUploading || inboxAi.contextDocs.length >= 5 ? 0.6 : 1,
            }}
          >
            {inboxAiUploading ? 'Uploading…' : 'Upload PDF'}
          </button>
          {inboxAi.contextDocs.length > 0 && (
            <ul style={{ marginTop: '12px', padding: 0, listStyle: 'none' }}>
              {inboxAi.contextDocs.map((doc) => (
                <li
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    marginBottom: '6px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.name}>
                    {doc.name} ({formatFileSize(doc.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteContextDoc(doc.id)}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Bulk Inbox Batch Size
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[10, 12, 24, 48].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleBatchSizeChange(n)}
                style={{
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background: inboxAi.batchSize === n ? 'var(--purple-accent, #9333ea)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${inboxAi.batchSize === n ? 'var(--purple-accent)' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: '8px',
                  color: inboxAi.batchSize === n ? '#fff' : 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
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
