/**
 * Clone BEAP inbox content to an internal sandbox orchestrator (new qBEAP; original row unchanged).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { InternalSandboxTargetWire } from '../hooks/useInternalSandboxesList'
import { beapInboxCloneToSandboxApi, sandboxCloneFeedbackFromOutcome } from '../lib/beapInboxCloneToSandbox'
import { UI_BUTTON } from '../styles/uiContrastTokens'
import './handshakeViewTypes'

function formatSandboxSelectLabel(s: InternalSandboxTargetWire): string {
  const name = (s.peer_device_name || s.peer_device_id || 'Device').trim()
  const code =
    s.peer_pairing_code_six && /^\d{6}$/.test(s.peer_pairing_code_six) ? s.peer_pairing_code_six : '— — —'
  return `${name} — Sandbox orchestrator — ${code}`
}

export interface BeapSandboxCloneDialogProps {
  message: InboxMessage
  sandboxes: InternalSandboxTargetWire[]
  /** When set (e.g. from external-link warning), pass clone reason + URL into prepare/send. */
  cloneContext?: { cloneReason: 'external_link_or_artifact_review'; triggeredUrl: string } | null
  onClose: () => void
  onSent?: () => void
}

export default function BeapSandboxCloneDialog({
  message,
  sandboxes,
  cloneContext = null,
  onClose,
  onSent,
}: BeapSandboxCloneDialogProps) {
  const [targetId, setTargetId] = useState<string | null>(sandboxes.length === 1 ? sandboxes[0]!.handshake_id : null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (sandboxes.length === 1) setTargetId(sandboxes[0]!.handshake_id)
  }, [sandboxes])

  const selected = useMemo(
    () => sandboxes.find((s) => s.handshake_id === targetId),
    [sandboxes, targetId],
  )

  const send = useCallback(async () => {
    if (sandboxes.length > 1 && !targetId) {
      setErr('Select a sandbox orchestrator')
      return
    }
    const hid = sandboxes.length === 1 ? sandboxes[0]!.handshake_id : (targetId ?? '')
    // eslint-disable-next-line no-console
    console.log('[BEAP_SANDBOX_CLONE] target_selected', {
      message_id: message.id,
      handshake_id: hid,
      peer_role: 'sandbox',
      peer_pairing_code: selected?.peer_pairing_code_six,
    })
    // eslint-disable-next-line no-console
    console.log('[BEAP_SANDBOX_CLONE] send_begin', { message_id: message.id, target_handshake_id: hid })
    setSending(true)
    setErr(null)
    setToast(null)
    try {
      const r = await beapInboxCloneToSandboxApi({
        sourceMessageId: message.id,
        ...(sandboxes.length === 1
          ? {}
          : { targetHandshakeId: targetId ?? undefined }),
        ...(cloneContext
          ? {
              cloneReason: 'external_link_or_artifact_review' as const,
              triggeredUrl: cloneContext.triggeredUrl,
            }
          : {}),
      })
      if (r.success) {
        const fb = sandboxCloneFeedbackFromOutcome(r)
        // eslint-disable-next-line no-console
        console.log('[BEAP_SANDBOX_CLONE] send_result', { message_id: message.id, deliveryMode: r.deliveryMode })
        setToast({ type: 'success', text: fb.text })
        onSent?.()
        window.setTimeout(() => onClose(), 1200)
      } else {
        // eslint-disable-next-line no-console
        console.log('[BEAP_SANDBOX_CLONE] send_result', { message_id: message.id, error: r })
        const msg = 'error' in r ? `Sandbox clone failed: ${r.error}` : 'Sandbox clone failed.'
        setToast({ type: 'error', text: msg })
        setErr(msg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send clone'
      setToast({ type: 'error', text: msg })
      setErr(msg)
    } finally {
      setSending(false)
    }
  }, [cloneContext, message.id, onClose, onSent, sandboxes, targetId, selected])

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
          background: '#0f172a',
          color: '#e2e8f0',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 12,
          padding: 22,
          boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="beap-sandbox-clone-title"
          style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700, color: '#f8fafc' }}
        >
          Clone to sandbox
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#e2e8f0', lineHeight: 1.55, fontWeight: 500 }}>
          Sends a <strong style={{ color: '#f8fafc' }}>new</strong> qBEAP message to your sandbox for testing. The
          original inbox message is <strong style={{ color: '#f8fafc' }}>not modified</strong>.
        </p>
        {sandboxes.length > 1 && (
          <>
            <label
              style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 6, color: '#cbd5e1' }}
              htmlFor="beap-sbx-target"
            >
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
                  {formatSandboxSelectLabel(s)}
                </option>
              ))}
            </select>
          </>
        )}

        {sandboxes.length === 1 && selected && (
          <p style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 12 }}>
            Target: <strong style={{ color: '#f8fafc' }}>{formatSandboxSelectLabel(selected)}</strong>
          </p>
        )}

        {err && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{err}</p>}

        {toast && (
          <p
            style={{
              fontSize: 12,
              marginBottom: 10,
              color: toast.type === 'success' ? '#4ade80' : '#f87171',
            }}
            role="status"
          >
            {toast.text}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            style={{
              fontSize: 12,
              padding: '8px 14px',
              borderRadius: 6,
              cursor: sending ? 'not-allowed' : 'pointer',
              opacity: sending ? 0.6 : 1,
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--color-text, #e2e8f0)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...UI_BUTTON.primary,
              fontSize: 12,
              padding: '8px 14px',
              borderRadius: 6,
              cursor:
                (sandboxes.length > 1 && !targetId) || sending ? 'not-allowed' : 'pointer',
              opacity: (sandboxes.length > 1 && !targetId) || sending ? 0.5 : 1,
            }}
            disabled={(sandboxes.length > 1 && !targetId) || sending}
            onClick={() => void send()}
          >
            {sending
              ? 'Sending…'
              : sandboxes.length > 1
                ? 'Send clone'
                : 'Send clone to Sandbox'}
          </button>
        </div>
      </div>
    </div>
  )
}
