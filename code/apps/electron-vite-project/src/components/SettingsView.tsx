/**
 * SettingsView — Application settings including High-Assurance Relay and Inbox AI.
 * Tier-gated: only Pro, Publisher, Enterprise can access relay setup.
 */

import { useState, useEffect, useCallback } from 'react'
import RelaySetupWizard from './RelaySetupWizard'
import ThisDeviceCard from './ThisDeviceCard'
import { useSandboxHostInference } from '../hooks/useSandboxHostInference'
import { useHostToSandboxDirectReachability } from '../hooks/useHostToSandboxDirectReachability'
import {
  directP2pReachabilityCopyForHostToSandbox,
  directP2pReachabilityCopyForSandboxToHost,
  hostInferenceDirectUnavailableMessage,
} from '../lib/hostInferenceUiGates'

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

/** Local mirrors of preload orchestratorMode store shape (Settings-only). */
interface SettingsOrchestratorPeer {
  instanceId: string
  deviceName: string
  mode: 'host' | 'sandbox'
  handshakeId: string
  lastSeen: string
  status: 'connected' | 'disconnected'
}

interface SettingsOrchestratorConfig {
  mode: 'host' | 'sandbox'
  deviceName: string
  /** Per-install UUID. Kept on the type so setMode can round-trip the full config; the UI must not display it. */
  instanceId: string
  /** 6-digit decimal pairing code, scoped per SSO account. Display formatting (XXX-XXX) lives in ThisDeviceCard. */
  pairingCode: string
  connectedPeers: SettingsOrchestratorPeer[]
}

function formatOrchestratorLastSeen(iso: string): string {
  const t = iso?.trim()
  if (!t) return '—'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function mapInternalHandshakeRecordToOrchPeer(r: Record<string, unknown>): SettingsOrchestratorPeer | null {
  const handshakeId = typeof r.handshake_id === 'string' ? r.handshake_id : ''
  if (!handshakeId) return null
  const localRole = r.local_role
  const initiator = r.initiator as { email?: string } | null | undefined
  const acceptor = r.acceptor as { email?: string } | null | undefined
  const receiverEmail = typeof r.receiver_email === 'string' ? r.receiver_email : ''
  const cp =
    localRole === 'initiator'
      ? (acceptor?.email ?? receiverEmail ?? '')
      : (initiator?.email ?? '')
  const deviceName =
    localRole === 'initiator'
      ? (typeof r.acceptor_device_name === 'string' && r.acceptor_device_name.trim()
        ? r.acceptor_device_name
        : (cp || 'Peer device'))
      : (typeof r.initiator_device_name === 'string' && r.initiator_device_name.trim()
        ? r.initiator_device_name
        : (cp || 'Peer device'))
  const peerRole =
    localRole === 'initiator' ? r.acceptor_device_role : r.initiator_device_role
  const mode: 'host' | 'sandbox' =
    peerRole === 'host' || peerRole === 'sandbox' ? peerRole : 'sandbox'
  const lastSeen =
    typeof r.activated_at === 'string' && r.activated_at.trim()
      ? r.activated_at
      : (typeof r.created_at === 'string' ? r.created_at : '')
  const state = typeof r.state === 'string' ? r.state : ''
  return {
    instanceId: handshakeId,
    deviceName,
    mode,
    handshakeId,
    lastSeen,
    status: state === 'ACTIVE' ? 'connected' : 'disconnected',
  }
}

export interface SettingsViewProps {
  /** When set, Connect opens handshake initiation with internal preset (Electron dashboard). */
  onNavigateToHandshake?: (opts?: { presetInternal?: boolean }) => void
}

export default function SettingsView({ onNavigateToHandshake }: SettingsViewProps = {}) {
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

  const [orchConfig, setOrchConfig] = useState<SettingsOrchestratorConfig | null>(null)
  const [orchDeviceNameInput, setOrchDeviceNameInput] = useState('')
  const [orchPeers, setOrchPeers] = useState<SettingsOrchestratorPeer[]>([])
  const [orchLoading, setOrchLoading] = useState(true)
  const [orchConnectMessage, setOrchConnectMessage] = useState<string | null>(null)
  const [hostInfProbeId, setHostInfProbeId] = useState<string | null>(null)
  const [hostP2pProbeId, setHostP2pProbeId] = useState<string | null>(null)
  const sandboxHostInf = useSandboxHostInference(hostInfProbeId)
  const hostToSand = useHostToSandboxDirectReachability(hostP2pProbeId)

  const auth = (window as any).auth
  const relay = (window as any).relay
  const emailInbox = (window as any).emailInbox
  const orchestratorMode = (window as any).orchestratorMode as
    | {
        getMode: () => Promise<SettingsOrchestratorConfig>
        setMode: (c: SettingsOrchestratorConfig) => Promise<{ ok: boolean; error?: string }>
        setDeviceName: (name: string) => Promise<{ ok: boolean; error?: string }>
        getDeviceInfo: () => Promise<{ deviceName: string; mode: string; pairingCode: string }>
        getConnectedPeers: () => Promise<SettingsOrchestratorPeer[]>
        removePeer: (instanceId: string) => Promise<{ ok: boolean; error?: string }>
      }
    | undefined
  const handshakeView = (window as any).handshakeView as
    | { listHandshakes?: (filter?: unknown) => Promise<unknown[]> }
    | undefined
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

  useEffect(() => {
    if (orchConfig?.mode !== 'sandbox') {
      setHostInfProbeId(null)
      return
    }
    const direct = sandboxHostInf.candidates.filter((c) => c.directP2pAvailable)
    if (direct.length === 0) {
      setHostInfProbeId(null)
      return
    }
    setHostInfProbeId((prev) => {
      if (prev && direct.some((d) => d.handshakeId === prev)) {
        return prev
      }
      return direct[0]!.handshakeId
    })
  }, [orchConfig?.mode, sandboxHostInf.candidates])

  useEffect(() => {
    if (orchConfig?.mode !== 'host') {
      setHostP2pProbeId(null)
      return
    }
    const direct = hostToSand.candidates.filter((c) => c.directP2pAvailable)
    if (direct.length === 0) {
      setHostP2pProbeId(null)
      return
    }
    setHostP2pProbeId((prev) => {
      if (prev && direct.some((d) => d.handshakeId === prev)) {
        return prev
      }
      return direct[0]!.handshakeId
    })
  }, [orchConfig?.mode, hostToSand.candidates])

  const loadOrchestratorSettings = useCallback(async () => {
    if (!orchestratorMode?.getMode) {
      setOrchLoading(false)
      return
    }
    setOrchLoading(true)
    try {
      const infoPromise = orchestratorMode.getDeviceInfo?.() ?? Promise.resolve(null)
      const [cfg, info] = await Promise.all([orchestratorMode.getMode(), infoPromise])
      if (cfg && typeof cfg === 'object') {
        setOrchConfig(cfg)
        let peersFromHandshakes: SettingsOrchestratorPeer[] = []
        try {
          if (typeof handshakeView?.listHandshakes === 'function') {
            const rows = await handshakeView.listHandshakes({
              filter: { state: 'ACTIVE', handshake_type: 'internal' },
            })
            if (Array.isArray(rows)) {
              peersFromHandshakes = rows
                .map((row) => mapInternalHandshakeRecordToOrchPeer(row as Record<string, unknown>))
                .filter((p): p is SettingsOrchestratorPeer => p != null)
            }
          }
        } catch {
          /* ignore */
        }
        if (peersFromHandshakes.length > 0) {
          setOrchPeers(peersFromHandshakes)
        } else {
          setOrchPeers(Array.isArray(cfg.connectedPeers) ? cfg.connectedPeers : [])
        }
      }
      if (info && typeof info === 'object' && typeof (info as { deviceName?: string }).deviceName === 'string') {
        setOrchDeviceNameInput((info as { deviceName: string }).deviceName)
      } else if (cfg && typeof cfg.deviceName === 'string') {
        setOrchDeviceNameInput(cfg.deviceName)
      }
    } catch {
      /* ignore */
    } finally {
      setOrchLoading(false)
    }
  }, [orchestratorMode])

  useEffect(() => {
    void loadOrchestratorSettings()
  }, [loadOrchestratorSettings])

  const saveOrchestratorDeviceNameBlur = async () => {
    if (!orchestratorMode?.setDeviceName) return
    const name = orchDeviceNameInput.trim()
    if (!name) return
    try {
      const res = await orchestratorMode.setDeviceName(name)
      if (res && typeof res === 'object' && res.ok === false && res.error) {
        console.warn('[Settings] setDeviceName:', res.error)
      }
      await loadOrchestratorSettings()
    } catch (e) {
      console.warn('[Settings] setDeviceName failed:', e)
    }
  }

  const handleOrchestratorModeChange = async (next: 'host' | 'sandbox') => {
    if (!orchestratorMode?.getMode || !orchestratorMode?.setMode) return
    try {
      const cfg = await orchestratorMode.getMode()
      const res = await orchestratorMode.setMode({ ...cfg, mode: next })
      if (res && typeof res === 'object' && res.ok === false && res.error) {
        console.warn('[Settings] setMode:', res.error)
      }
      await loadOrchestratorSettings()
    } catch (e) {
      console.warn('[Settings] setMode failed:', e)
    }
  }

  const handleOrchestratorConnect = () => {
    setOrchConnectMessage(null)
    // Open handshake initiation modal with internal mode pre-set (parent passes navigation callback).
    if (onNavigateToHandshake) {
      onNavigateToHandshake({ presetInternal: true })
      return
    }
    window.dispatchEvent(
      new CustomEvent('optimando-open-handshake-initiate', { detail: { presetInternal: true } }),
    )
    setOrchConnectMessage(
      'Open the Handshakes panel and check "Internal handshake" to connect your devices.',
    )
  }

  const handleOrchestratorRemovePeer = async (instanceId: string) => {
    if (!orchestratorMode?.removePeer) return
    try {
      await orchestratorMode.removePeer(instanceId)
      await loadOrchestratorSettings()
    } catch (e) {
      console.warn('[Settings] removePeer failed:', e)
    }
  }

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

      {/* Orchestrator Mode */}
      <section style={{
        marginBottom: '24px',
        padding: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.04))',
        borderRadius: '10px',
        border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>
          Orchestrator Mode
        </h3>
        <div style={{ height: '1px', background: 'var(--color-border)', margin: '0 0 12px' }} />

        {!orchestratorMode ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
            Orchestrator settings are not available in this context.
          </p>
        ) : orchLoading ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>Loading orchestrator settings…</p>
        ) : (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                Device name
              </label>
              <input
                type="text"
                value={orchDeviceNameInput}
                onChange={(e) => setOrchDeviceNameInput(e.target.value)}
                onBlur={saveOrchestratorDeviceNameBlur}
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '13px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                  borderRadius: '8px',
                  color: 'var(--color-text, #e2e8f0)',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              <p style={{ margin: '8px 0 0', fontSize: '12px', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
                This name identifies your device to other connected instances.
              </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <span style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                Mode
              </span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['host', 'sandbox'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { void handleOrchestratorModeChange(m) }}
                    style={{
                      padding: '8px 14px',
                      fontSize: '12px',
                      fontWeight: 600,
                      background: orchConfig?.mode === m ? 'var(--purple-accent, #9333ea)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${orchConfig?.mode === m ? 'var(--purple-accent)' : 'rgba(255,255,255,0.12)'}`,
                      borderRadius: '8px',
                      color: orchConfig?.mode === m ? '#fff' : 'var(--color-text)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <button
                type="button"
                onClick={handleOrchestratorConnect}
                style={{
                  padding: '10px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: 'var(--color-accent-bg)',
                  border: '1px solid var(--color-accent-border)',
                  borderRadius: '8px',
                  color: 'var(--color-accent)',
                  cursor: 'pointer',
                }}
              >
                Connect to my devices
              </button>
              {orchConnectMessage && (
                <p style={{ margin: '10px 0 0', fontSize: '12px', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
                  {orchConnectMessage}
                </p>
              )}
            </div>

            <ThisDeviceCard
              deviceName={orchConfig?.deviceName ?? ''}
              mode={orchConfig?.mode ?? 'host'}
              pairingCode={orchConfig?.pairingCode ?? ''}
            />

            {orchConfig?.mode === 'sandbox' && (() => {
              const directRows = sandboxHostInf.candidates.filter((c) => c.directP2pAvailable)
              const probed = hostInfProbeId
                ? directRows.find((c) => c.handshakeId === hostInfProbeId) ?? null
                : null
              const p2pMsg = probed ? hostInferenceDirectUnavailableMessage(probed.directP2pAvailable) : null
              return (
                <div
                  style={{
                    marginTop: 16,
                    marginBottom: 8,
                    padding: 12,
                    background: 'rgba(30, 64, 175, 0.06)',
                    borderRadius: 8,
                    border: '1px solid rgba(30, 64, 175, 0.2)',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      marginBottom: 8,
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    Host inference (WR Chat)
                  </span>
                  {(() => {
                    const dr = directP2pReachabilityCopyForSandboxToHost(sandboxHostInf.directReachability)
                    if (directRows.length === 0) return null
                    return (
                      <p
                        style={{
                          margin: '0 0 8px',
                          fontSize: 12,
                          lineHeight: 1.45,
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 600,
                            color: sandboxHostInf.directReachability === 'reachable' ? '#4ade80' : 'var(--color-text)',
                          }}
                        >
                          {dr.primary}
                        </span>
                        {dr.hint ? (
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            <br />
                            {dr.hint}
                          </span>
                        ) : null}
                      </p>
                    )
                  })()}
                  {sandboxHostInf.listLoading ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
                      Checking Host inference status…
                    </p>
                  ) : directRows.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text)' }}>
                      No Host connection — add an active internal Handshake to a Host (Sandbox role) in
                      Handshakes, with direct P2P, to use Host inference.
                    </p>
                  ) : (
                    <>
                      {directRows.length > 1 && (
                        <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                          Host
                          <select
                            value={hostInfProbeId ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              setHostInfProbeId(v || null)
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              marginTop: 6,
                              padding: '8px 10px',
                              fontSize: 12,
                              borderRadius: 6,
                              border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                              background: 'rgba(255,255,255,0.04)',
                              color: 'var(--color-text)',
                            }}
                          >
                            {directRows.map((c) => (
                              <option key={c.handshakeId} value={c.handshakeId}>
                                {c.hostDisplayName} · {c.hostRoleLabel} · {c.pairingCodeDisplay}
                                {c.endpointHostLabel ? ` · ${c.endpointHostLabel}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {sandboxHostInf.policy === 'no_direct' || p2pMsg ? (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#f87171' }}>
                          {p2pMsg ?? hostInferenceDirectUnavailableMessage(false)}
                        </p>
                      ) : sandboxHostInf.policy === 'deny' ? (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#f87171' }}>
                          Host inference is not enabled on the Host.
                        </p>
                      ) : sandboxHostInf.policy === 'unreachable' || sandboxHostInf.policy === 'unknown' ? (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>
                          {sandboxHostInf.policy === 'unreachable' && sandboxHostInf.policyDetail
                            ? sandboxHostInf.policyDetail
                            : 'Checking Host policy…'}
                        </p>
                      ) : (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text)' }}>
                          Use the chat bar model menu (<strong>On Host (orchestrator)</strong>)
                          {probed ? (
                            <>
                              {' '}
                              to run on <strong>{probed.hostDisplayName}</strong> ({probed.hostRoleLabel},{' '}
                              {probed.pairingCodeDisplay}
                              {probed.endpointHostLabel ? ` · direct ${probed.endpointHostLabel}` : ''}).
                            </>
                          ) : (
                            '.'
                          )}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )
            })()}

            {orchConfig?.mode === 'host' && (() => {
              const directS = hostToSand.candidates.filter((c) => c.directP2pAvailable)
              const sprobe = hostP2pProbeId
                ? directS.find((c) => c.handshakeId === hostP2pProbeId) ?? null
                : null
              const sCopy = directP2pReachabilityCopyForHostToSandbox(hostToSand.reachability)
              return (
                <div
                  style={{
                    marginTop: 16,
                    marginBottom: 8,
                    padding: 12,
                    background: 'rgba(22, 101, 52, 0.08)',
                    borderRadius: 8,
                    border: '1px solid rgba(34, 197, 94, 0.25)',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      marginBottom: 8,
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    Direct P2P to Sandbox
                  </span>
                  {hostToSand.listLoading ? (
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>Loading…</p>
                  ) : directS.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text)' }}>
                      No internal Sandbox handshakes with a direct P2P endpoint.
                    </p>
                  ) : (
                    <>
                      {directS.length > 1 && (
                        <label style={{ display: 'block', marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
                          Sandbox
                          <select
                            value={hostP2pProbeId ?? ''}
                            onChange={(e) => {
                              const v = e.target.value
                              setHostP2pProbeId(v || null)
                            }}
                            style={{
                              display: 'block',
                              width: '100%',
                              marginTop: 6,
                              padding: '8px 10px',
                              fontSize: 12,
                              borderRadius: 6,
                              border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                              background: 'rgba(255,255,255,0.04)',
                              color: 'var(--color-text)',
                            }}
                          >
                            {directS.map((c) => (
                              <option key={c.handshakeId} value={c.handshakeId}>
                                {c.peerDisplayName} · {c.peerRoleLabel} · {c.pairingCodeDisplay}
                                {c.endpointHostLabel ? ` · ${c.endpointHostLabel}` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontWeight: 600,
                            color: hostToSand.reachability === 'reachable' ? '#4ade80' : 'var(--color-text)',
                          }}
                        >
                          {sCopy.primary}
                        </span>
                        {sCopy.hint ? (
                          <span style={{ color: 'var(--color-text-muted)' }}>
                            <br />
                            {sCopy.hint}
                          </span>
                        ) : null}
                      </p>
                      {sprobe && hostToSand.reachability === 'reachable' ? (
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                          Measured to <strong>{sprobe.peerDisplayName}</strong> ({sprobe.peerRoleLabel},{' '}
                          {sprobe.pairingCodeDisplay}
                          {sprobe.endpointHostLabel ? ` · ${sprobe.endpointHostLabel}` : ''}).
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })()}

            <div>
              <span style={{ display: 'block', marginBottom: '10px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                Connected devices
              </span>
              {orchPeers.length === 0 ? (
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-muted)' }}>
                  No devices connected yet.
                </p>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {orchPeers.map((peer) => (
                    <li
                      key={peer.instanceId}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px',
                        marginBottom: '8px',
                        background: 'rgba(255,255,255,0.04)',
                        borderRadius: '8px',
                        fontSize: '12px',
                        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                          <span
                            style={{
                              fontWeight: 700,
                              fontSize: '13px',
                              color: 'var(--color-text)',
                            }}
                          >
                            {peer.deviceName || 'Device'}
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
                            {peer.mode}
                          </span>
                          <span
                            title={peer.status}
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              flexShrink: 0,
                              background: peer.status === 'connected' ? 'var(--success-dark, #10b981)' : 'rgba(148,163,184,0.7)',
                            }}
                          />
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                          Last seen: {formatOrchestratorLastSeen(peer.lastSeen)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { void handleOrchestratorRemovePeer(peer.instanceId) }}
                        style={{
                          padding: '6px 10px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: 'transparent',
                          border: '1px solid var(--color-border)',
                          borderRadius: '6px',
                          color: 'var(--color-text-muted)',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        Disconnect
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
