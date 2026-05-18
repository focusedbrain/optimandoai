import { useCallback, useEffect, useState } from 'react'

type QueueSnap = { pending: number; failed: number }

/**
 * Passive notice when durable `context_sync_pending` is set — vault / relay /
 * outbound queue deferrals without changing handshake data paths.
 */
export default function SecureContextSyncPendingBanner({
  handshakeId,
  vaultUnlocked,
  handshakeType,
  internalCoordinationIdentityComplete,
}: {
  handshakeId: string
  vaultUnlocked: boolean
  handshakeType?: 'internal' | 'standard' | null
  internalCoordinationIdentityComplete?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [queueSnap, setQueueSnap] = useState<QueueSnap>({ pending: 0, failed: 0 })
  const [flushErr, setFlushErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      const p2p = (window as unknown as { p2p?: { getQueueStatus?: (id: string) => Promise<{ entries?: { status: string }[] }> } }).p2p
      if (!p2p?.getQueueStatus) return
      p2p.getQueueStatus(handshakeId).then((r) => {
        if (cancelled) return
        const rows = r?.entries ?? []
        let pending = 0
        let failed = 0
        for (const row of rows) {
          if (row.status === 'pending') pending += 1
          else if (row.status === 'failed') failed += 1
        }
        setQueueSnap({ pending, failed })
      }).catch(() => {
        if (!cancelled) setQueueSnap({ pending: 0, failed: 0 })
      })
    }
    poll()
    const id = window.setInterval(poll, 12_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [handshakeId])

  const onRetryDrain = useCallback(async () => {
    setFlushErr(null)
    const p2p = (window as unknown as { p2p?: { flushOutboundQueue?: () => Promise<unknown> } }).p2p
    if (!p2p?.flushOutboundQueue) {
      setFlushErr('Delivery flush is unavailable in this build.')
      return
    }
    setBusy(true)
    try {
      await p2p.flushOutboundQueue()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setFlushErr(msg || 'Flush failed.')
    } finally {
      setBusy(false)
    }
  }, [])

  const vaultBlocked = vaultUnlocked === false
  const internalRelayIncomplete =
    handshakeType === 'internal' &&
    typeof internalCoordinationIdentityComplete === 'boolean' &&
    !internalCoordinationIdentityComplete

  let detail =
    'Context sync will send automatically once prerequisites are satisfied.'
  if (vaultBlocked) {
    detail =
      'Your vault is locked — unlock when you are ready so we can finish the encrypted context exchange.'
  } else if (internalRelayIncomplete) {
    detail =
      'Internal handshake routing is still finishing setup. This retries automatically once relay identity is ready.'
  }

  const showDrainHint = !vaultBlocked && (queueSnap.failed > 0 || queueSnap.pending > 0)

  return (
    <div
      style={{
        marginBottom: '14px',
        padding: '12px 14px',
        background: 'rgba(245,158,11,0.08)',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: '8px',
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', marginBottom: '4px' }}>
        Secure action pending
      </div>
      <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.45, marginBottom: '8px' }}>
        {detail}
      </div>
      {(queueSnap.pending > 0 || queueSnap.failed > 0) && (
        <div style={{ fontSize: '10px', color: '#a8a29e', marginBottom: '8px', fontFamily: 'monospace' }}>
          Outbound queue: {queueSnap.pending} pending · {queueSnap.failed} failed
        </div>
      )}
      {flushErr && (
        <div style={{ fontSize: '10px', color: '#f87171', marginBottom: '8px' }}>{flushErr}</div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
        {vaultBlocked ? (
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
            Use the vault banner above when you're ready to unlock.
          </span>
        ) : null}
        {showDrainHint ? (
          <button
            type="button"
            disabled={busy || vaultBlocked}
            onClick={() => { void onRetryDrain() }}
            title={vaultBlocked ? 'Unlock the vault first' : 'Request an immediate outbound flush / retry'}
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              background: vaultBlocked ? 'rgba(107,114,128,0.15)' : 'rgba(251,191,36,0.15)',
              color: vaultBlocked ? '#78716c' : '#fbbf24',
              border: `1px solid ${vaultBlocked ? 'rgba(107,114,128,0.35)' : 'rgba(251,191,36,0.35)'}`,
              borderRadius: '6px',
              cursor: vaultBlocked ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Retrying…' : 'Retry delivery'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
