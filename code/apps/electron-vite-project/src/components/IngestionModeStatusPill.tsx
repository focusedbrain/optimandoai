/**
 * Status pill + decision panel for ingestion mode (renderer).
 */

import { useCallback, useEffect, useState } from 'react'

export type IngestionModePublic =
  | 'EdgeActive'
  | 'HostPodActive'
  | 'LegacyInProcess'
  | 'Blocked'

export interface IngestionModeUiState {
  mode: IngestionModePublic
  hostPodVariant: 'user_chosen' | 'session_fallback' | 'starting' | 'halted_by_anomaly' | null
  hostPodHaltReason: string | null
  blockedWithoutConnectivity: boolean
  holdQueueCount: number
  edgeSetupPending: boolean
  sessionHostFallbackAuthorized: boolean
  lastEdgeSuccessAt: number | null
}

const DEFAULT_STATE: IngestionModeUiState = {
  mode: 'HostPodActive',
  hostPodVariant: 'user_chosen',
  hostPodHaltReason: null,
  blockedWithoutConnectivity: false,
  holdQueueCount: 0,
  edgeSetupPending: false,
  sessionHostFallbackAuthorized: false,
  lastEdgeSuccessAt: null,
}

function mapSnapshot(raw: unknown): IngestionModeUiState {
  const s = raw as Record<string, unknown>
  const settings = s.settings as Record<string, unknown> | undefined
  const hold = s.holdQueue as { count?: number } | undefined
  const probes = s.probes as { lastEdgeSuccessAt?: number | null } | undefined
  return {
    mode: (s.mode as IngestionModePublic) ?? 'HostPodActive',
    hostPodVariant: (s.hostPodVariant as IngestionModeUiState['hostPodVariant']) ?? null,
    hostPodHaltReason:
      typeof s.hostPodHaltReason === 'string' ? s.hostPodHaltReason : null,
    blockedWithoutConnectivity: s.blockedWithoutConnectivity === true,
    holdQueueCount: hold?.count ?? 0,
    edgeSetupPending: settings?.enabled === 'pending',
    sessionHostFallbackAuthorized: s.sessionHostFallbackAuthorized === true,
    lastEdgeSuccessAt: probes?.lastEdgeSuccessAt ?? null,
  }
}

function pillLabel(state: IngestionModeUiState): string {
  if (state.edgeSetupPending) return 'Edge setup incomplete'
  switch (state.mode) {
    case 'EdgeActive':
      return 'Secure mode'
    case 'HostPodActive':
      if (state.hostPodVariant === 'halted_by_anomaly') {
        return `Verification halted · ${state.holdQueueCount} held`
      }
      if (state.hostPodVariant === 'session_fallback') return 'Host fallback (session)'
      if (state.hostPodVariant === 'starting') return 'Starting local pod…'
      return 'Host mode'
    case 'LegacyInProcess':
      return 'Legacy mode'
    case 'Blocked':
      return state.blockedWithoutConnectivity
        ? `No network · ${state.holdQueueCount} held`
        : `Edge unreachable · ${state.holdQueueCount} held`
    default:
      return 'Ingestion'
  }
}

export function IngestionModeStatusPill(): JSX.Element | null {
  const [state, setState] = useState<IngestionModeUiState>(DEFAULT_STATE)
  const [panelOpen, setPanelOpen] = useState(false)
  const [showFallbackConfirm, setShowFallbackConfirm] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.ingestionMode
    if (!api?.get) return
    const snap = await api.get()
    setState(mapSnapshot(snap))
  }, [])

  useEffect(() => {
    void refresh()
    const api = window.ingestionMode
    const off = api?.onUpdated?.((snap) => setState(mapSnapshot(snap)))
    const offPanel = api?.onOpenPanel?.(() => setPanelOpen(true))
    return () => {
      off?.()
      offPanel?.()
    }
  }, [refresh])

  const onRetryEdge = async () => {
    await window.ingestionMode?.retryEdge?.()
    setPanelOpen(false)
  }

  const onRetryHostPod = async () => {
    await window.ingestionMode?.retryHostPod?.()
    setPanelOpen(false)
    void refresh()
  }

  const onAuthorize = async () => {
    await window.ingestionMode?.authorizeHostFallback?.()
    setShowFallbackConfirm(false)
    setPanelOpen(false)
  }

  return (
    <div className="ingestion-mode-status" style={{ position: 'relative' }}>
      <button
        type="button"
        className={`ingestion-mode-pill ingestion-mode-pill--${state.mode.toLowerCase()}`}
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
      >
        {pillLabel(state)}
      </button>

      {panelOpen ? (
        <div
          className="ingestion-mode-panel"
          role="dialog"
          aria-label="Ingestion mode"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            padding: 16,
            minWidth: 320,
            background: 'var(--surface-elevated, #1e1e1e)',
            border: '1px solid var(--border-subtle, #444)',
            borderRadius: 8,
            zIndex: 1000,
          }}
        >
          {state.mode === 'EdgeActive' ? (
            <p>Secure mode active. Remote VPS verifying your messages.</p>
          ) : null}
          {state.mode === 'HostPodActive' &&
          state.hostPodVariant === 'halted_by_anomaly' ? (
            <>
              <p>
                Message verification has stopped because something unexpected happened. Your
                messages are held safely ({state.holdQueueCount} in queue).
              </p>
              {state.hostPodHaltReason ? (
                <p style={{ fontSize: 13, opacity: 0.85 }}>{state.hostPodHaltReason}</p>
              ) : null}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                <button type="button" onClick={onRetryHostPod}>
                  Try to recover
                </button>
                <button type="button" onClick={() => setPanelOpen(false)}>
                  Close
                </button>
              </div>
            </>
          ) : null}
          {state.mode === 'HostPodActive' &&
          state.hostPodVariant !== 'session_fallback' &&
          state.hostPodVariant !== 'halted_by_anomaly' ? (
            <p>Host mode active. Local pod verifying.</p>
          ) : null}
          {state.mode === 'HostPodActive' && state.hostPodVariant === 'session_fallback' ? (
            <p>Host fallback active for this session only. Edge tier is still enabled.</p>
          ) : null}
          {state.mode === 'LegacyInProcess' ? (
            <p>
              Legacy mode: in-process verification. For isolated verification, install Podman
              Desktop.
            </p>
          ) : null}
          {state.edgeSetupPending ? (
            <p>Edge tier setup incomplete — finish setup in Settings when you are ready.</p>
          ) : null}
          {state.mode === 'Blocked' ? (
            <>
              <p>
                {state.blockedWithoutConnectivity
                  ? `No network connection. ${state.holdQueueCount} message(s) held safely.`
                  : `Edge unreachable. ${state.holdQueueCount} message(s) held safely.`}
              </p>
              {!showFallbackConfirm ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={() => setPanelOpen(false)}>
                    Keep waiting
                  </button>
                  <button type="button" onClick={onRetryEdge}>
                    Retry now
                  </button>
                  <button type="button" onClick={() => setShowFallbackConfirm(true)}>
                    Allow host fallback for this session
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 14 }}>
                    Allowing host fallback means emails will be depackaged on this computer instead
                    of the remote VPS for the rest of this session. Attachments from unverified
                    senders will be processed locally. This authorization expires when you quit the
                    app.
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => setShowFallbackConfirm(false)}>
                      Cancel
                    </button>
                    <button type="button" onClick={onAuthorize}>
                      Allow for this session
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : state.hostPodVariant !== 'halted_by_anomaly' ? (
            <button type="button" style={{ marginTop: 12 }} onClick={() => setPanelOpen(false)}>
              Close
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
