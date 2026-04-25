/**
 * Clone BEAP inbox content to an internal sandbox orchestrator (new qBEAP; original row unchanged).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import type { InternalSandboxTargetWire } from '../hooks/useInternalSandboxesList'
import { beapInboxCloneToSandboxApi, sandboxCloneFeedbackFromOutcome } from '../lib/beapInboxCloneToSandbox'
import type { SandboxCloneFeedbackView } from '../lib/sandboxCloneFeedbackUi'
import SandboxCloneFeedbackBadge from './SandboxCloneFeedbackBadge'
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
  const [cloneFeedback, setCloneFeedback] = useState<SandboxCloneFeedbackView | null>(null)

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
    setCloneFeedback(null)
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
        setCloneFeedback(fb.view)
        onSent?.()
        window.setTimeout(() => onClose(), 1800)
      } else {
        // eslint-disable-next-line no-console
        console.log('[BEAP_SANDBOX_CLONE] send_result', { message_id: message.id, error: r })
        const v = sandboxCloneFeedbackFromOutcome(r).view
        setCloneFeedback(v)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send clone'
      const v = sandboxCloneFeedbackFromOutcome({ success: false, error: msg }).view
      setCloneFeedback(v)
    } finally {
      setSending(false)
    }
  }, [cloneContext, message.id, onClose, onSent, sandboxes, targetId, selected])

  return (
    <div className="wrdesk-modal__backdrop" onClick={onClose} role="presentation">
      <div
        className="wrdesk-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="beap-sandbox-clone-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="beap-sandbox-clone-title" className="wrdesk-modal__title" style={{ fontSize: 17 }}>
          Clone to sandbox
        </h2>
        <p className="wrdesk-modal__body" style={{ margin: '0 0 12px' }}>
          Sends a <strong>new</strong> qBEAP message to your sandbox for testing. The original inbox message is{' '}
          <strong>not modified</strong>.
        </p>
        {sandboxes.length > 1 && (
          <>
            <label className="wrdesk-modal__label" htmlFor="beap-sbx-target">
              Sandbox
            </label>
            <select
              id="beap-sbx-target"
              className="wrdesk-modal__select"
              value={targetId ?? ''}
              onChange={(e) => setTargetId(e.target.value || null)}
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
          <p className="wrdesk-modal__body" style={{ margin: '0 0 12px' }}>
            Target: <strong>{formatSandboxSelectLabel(selected)}</strong>
          </p>
        )}

        {err && <p className="wrdesk-modal__error" style={{ margin: '0 0 8px' }}>{err}</p>}

        {cloneFeedback ? (
          <div style={{ marginBottom: 12 }}>
            <SandboxCloneFeedbackBadge
              view={cloneFeedback}
              onDismiss={cloneFeedback.persistUntilDismiss ? () => setCloneFeedback(null) : undefined}
              maxWidth="100%"
            />
          </div>
        ) : null}

        <div className="wrdesk-modal__actions">
          <button type="button" className="wrdesk-modal__btn" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="wrdesk-modal__btn wrdesk-modal__btn--primary"
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
