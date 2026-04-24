/**
 * Clone BEAP inbox content to an internal sandbox orchestrator (new qBEAP; original row unchanged).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { InternalSandboxTargetWire } from '../hooks/useInternalSandboxesList'
import { beapInboxCloneToSandboxApi } from '../lib/beapInboxCloneToSandbox'
import { UI_BUTTON } from '../styles/uiContrastTokens'
import './handshakeViewTypes'

function primaryActionLabel(
  s: InternalSandboxTargetWire | undefined,
  multipleTargets: boolean,
): { main: string; hint?: string } {
  if (!s) return { main: multipleTargets ? 'Sandbox…' : 'Sandbox' }
  if (s.live_status_optional === 'relay_disconnected') {
    return {
      main: 'Queue to Sandbox',
      hint: 'Sandbox offline — message will be queued for delivery when the relay connects.',
    }
  }
  if (s.live_status_optional === 'coordination_disabled') {
    return {
      main: 'Queue to Sandbox',
      hint: 'Coordination relay not connected — message will be queued if supported.',
    }
  }
  if (multipleTargets) return { main: 'Send to sandbox…' }
  return { main: 'Send to Sandbox' }
}

export interface BeapSandboxCloneDialogProps {
  message: InboxMessage
  sandboxes: InternalSandboxTargetWire[]
  onClose: () => void
  onSent?: () => void
}

export default function BeapSandboxCloneDialog({
  message,
  sandboxes,
  onClose,
  onSent,
}: BeapSandboxCloneDialogProps) {
  const [targetId, setTargetId] = useState<string | null>(sandboxes.length === 1 ? sandboxes[0]!.handshake_id : null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (sandboxes.length === 1) setTargetId(sandboxes[0]!.handshake_id)
  }, [sandboxes])

  const selected = useMemo(
    () => sandboxes.find((s) => s.handshake_id === targetId),
    [sandboxes, targetId],
  )

  const labels = useMemo(
    () => primaryActionLabel(selected, sandboxes.length > 1),
    [selected, sandboxes.length],
  )

  const send = useCallback(async () => {
    if (!targetId) {
      setErr('Select a sandbox')
      return
    }
    setSending(true)
    setErr(null)
    try {
      const r = await beapInboxCloneToSandboxApi({
        sourceMessageId: message.id,
        targetHandshakeId: targetId,
      })
      if (r.success) {
        onSent?.()
        onClose()
      } else {
        setErr('error' in r ? r.error : 'Failed')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSending(false)
    }
  }, [message.id, onClose, onSent, targetId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beap-sandbox-clone-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: 'var(--color-surface-elevated, #1e293b)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
          borderRadius: 10,
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="beap-sandbox-clone-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
          Clone to sandbox
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.5 }}>
          Sends a <strong>new</strong> qBEAP message to your sandbox for automation testing. The original inbox
          message is not modified.
        </p>
        {labels.hint && (
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>{labels.hint}</p>
        )}

        {sandboxes.length > 1 && (
          <>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }} htmlFor="beap-sbx-target">
              Sandbox
            </label>
            <select
              id="beap-sbx-target"
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value || null)}
              style={{
                width: '100%',
                marginBottom: 12,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 12,
                background: 'var(--color-surface, #0f172a)',
                color: 'var(--color-text, #e2e8f0)',
                border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
              }}
            >
              <option value="">Select…</option>
              {sandboxes.map((s) => (
                <option key={s.handshake_id} value={s.handshake_id}>
                  {s.peer_device_name || s.peer_device_id} ({s.handshake_id.slice(0, 8)}…)
                </option>
              ))}
            </select>
          </>
        )}

        {sandboxes.length === 1 && selected && (
          <p style={{ fontSize: 12, color: 'var(--color-text)', marginBottom: 12 }}>
            Target: <strong>{selected.peer_device_name || 'Sandbox'}</strong>
          </p>
        )}

        {err && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className={UI_BUTTON.ghost} onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className={UI_BUTTON.primary}
            disabled={!targetId || sending}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : labels.main}
          </button>
        </div>
      </div>
    </div>
  )
}
