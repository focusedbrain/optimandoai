/**
 * Redirect a BEAP inbox message to another active handshake (new qBEAP package; no ciphertext reuse).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import { executeDeliveryAction, type BeapPackageConfig } from '@ext/beap-messages/services/BeapPackageBuilder'
import { getSigningKeyPair } from '@ext/beap-messages/services/beapCrypto'
import { hasHandshakeKeyMaterial, type HandshakeRecord } from '@ext/handshake/rpcTypes'
import { listHandshakes } from '../shims/handshakeRpc'
import { handshakeRecordToSelectedRecipient } from '../lib/handshakeRecipientMap'
import { UI_BUTTON } from '../styles/uiContrastTokens'
import './handshakeViewTypes'

const REDIRECT_BANNER =
  '[BEAP redirect — sent by you]\n' +
  'This message is a redirect you chose to send. It is not from the original author and does not re-use the original wire ciphertext.\n\n'

export type BeapRedirectSourcePayload = {
  message_id: string
  source_type: string
  original_handshake_id: string | null
  subject: string
  public_text: string
  encrypted_text: string
  has_attachments?: boolean
  content_warning?: string
  redirected_by_account: string | null
}

function buildProvenanceBlock(
  o: {
    original_message_id: string
    original_handshake_id: string | null
    redirected_by_account: string
    target_handshake_id: string
  },
  atIso: string,
): string {
  return [
    '\n\n---\n',
    JSON.stringify({
      beap_redirect_provenance: {
        action_type: 'redirect',
        original_message_id: o.original_message_id,
        original_handshake_id: o.original_handshake_id,
        redirected_at: atIso,
        redirected_by_account: o.redirected_by_account,
        target_handshake_id: o.target_handshake_id,
      },
    }),
  ].join('')
}

export interface BeapRedirectDialogProps {
  message: InboxMessage
  onClose: () => void
  /** Optional: after successful send */
  onSent?: () => void
}

export default function BeapRedirectDialog({ message, onClose, onSent }: BeapRedirectDialogProps) {
  const [source, setSource] = useState<BeapRedirectSourcePayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<HandshakeRecord[]>([])
  const [hsLoading, setHsLoading] = useState(true)
  const [hsError, setHsError] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const fn = window.emailInbox?.getBeapRedirectSource
        if (typeof fn !== 'function') {
          setLoadError('emailInbox.getBeapRedirectSource is not available')
          setSource(null)
          return
        }
        const r = (await fn(message.id)) as { ok?: boolean; error?: string } & Partial<BeapRedirectSourcePayload>
        if (cancelled) return
        if (r?.ok && r.message_id) {
          setSource(r as BeapRedirectSourcePayload)
        } else {
          setSource(null)
          setLoadError(typeof r?.error === 'string' ? r.error : 'Could not load message for redirect')
        }
      } catch (e) {
        if (!cancelled) {
          setSource(null)
          setLoadError(e instanceof Error ? e.message : 'Load failed')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [message.id])

  const loadHandshakes = useCallback(async () => {
    setHsLoading(true)
    setHsError(null)
    try {
      const list = await listHandshakes('active')
      setRows(Array.isArray(list) ? list : [])
    } catch (e) {
      setHsError(e instanceof Error ? e.message : 'Failed to list handshakes')
      setRows([])
    } finally {
      setHsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHandshakes()
  }, [loadHandshakes])

  const sourceHs = (message.handshake_id ?? '').trim()
  const eligible = useMemo(() => {
    return rows.filter((h) => {
      if (h.state !== 'ACTIVE') return false
      if (sourceHs && h.handshake_id === sourceHs) return false
      if (!hasHandshakeKeyMaterial(handshakeRecordToSelectedRecipient(h))) return false
      if (!(h.p2pEndpoint && String(h.p2pEndpoint).trim())) return false
      if (!h.localX25519PublicKey?.trim()) return false
      if (h.handshake_type === 'internal' && h.internal_coordination_identity_complete === false) return false
      return true
    })
  }, [rows, sourceHs])

  const doRedirect = useCallback(async () => {
    if (!source || !targetId) return
    setSending(true)
    setSendError(null)
    try {
      const target = rows.find((r) => r.handshake_id === targetId)
      if (!target) {
        setSendError('Select a target handshake')
        return
      }
      const selectedRecipient = handshakeRecordToSelectedRecipient(target)
      if (!hasHandshakeKeyMaterial(selectedRecipient)) {
        setSendError('Target handshake is missing key material for qBEAP')
        return
      }
      const kp = await getSigningKeyPair()
      const senderFp = kp.publicKey
      const senderShort =
        senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp
      const at = new Date().toISOString()
      const by =
        (source.redirected_by_account && source.redirected_by_account.trim()) ||
        '(signed-in account)'
      const prov = buildProvenanceBlock(
        {
          original_message_id: source.message_id,
          original_handshake_id: source.original_handshake_id,
          redirected_by_account: by,
          target_handshake_id: targetId,
        },
        at,
      )
      const pub = `${REDIRECT_BANNER}${source.public_text || source.encrypted_text}`.trim()
      const enc = `${source.encrypted_text.trim()}${prov}`.trim()
      const config: BeapPackageConfig = {
        recipientMode: 'private',
        deliveryMethod: 'p2p',
        selectedRecipient,
        senderFingerprint: senderFp,
        senderFingerprintShort: senderShort,
        messageBody: pub,
        encryptedMessage: enc,
        attachments: [],
      }
      const delivery = await executeDeliveryAction(config)
      if (delivery.success) {
        try {
          const subj =
            source.subject.startsWith('Re:') || source.subject.startsWith('Redirect:')
              ? source.subject
              : `Redirect: ${source.subject}`
          void window.outbox
            ?.insertSent?.({
              id: crypto.randomUUID(),
              handshakeId: targetId,
              counterpartyDisplay: target.counterparty_email || 'Peer',
              subject: subj,
              publicBodyPreview: pub.slice(0, 500),
              encryptedBodyPreview: enc.slice(0, 500),
              hasEncryptedInner: true,
              deliveryMethod: 'p2p',
              deliveryStatus: 'sent',
              deliveryDetailJson: JSON.stringify({
                beap_redirect: true,
                original_message_id: source.message_id,
                target_handshake_id: targetId,
                action: delivery.action,
                message: delivery.message,
                coordinationRelayDelivery: delivery.coordinationRelayDelivery,
              }),
            })
            .catch((err: unknown) => console.warn('[Outbox] insert failed:', err))
        } catch {
          /* ignore */
        }
        onSent?.()
        onClose()
      } else {
        setSendError(delivery.message || 'Send failed')
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }, [onClose, onSent, rows, source, targetId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beap-redirect-title"
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
        <h2 id="beap-redirect-title" style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>
          Redirect BEAP message
        </h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted, #94a3b8)', lineHeight: 1.5 }}>
          Sends a <strong>new</strong> qBEAP message to the handshake you select. The original inbox row is not changed.
        </p>

        {loading && <p style={{ fontSize: 12 }}>Loading message…</p>}
        {loadError && <p style={{ fontSize: 12, color: '#f87171' }}>{loadError}</p>}

        {source?.content_warning && (
          <p style={{ fontSize: 12, color: '#fbbf24', marginBottom: 12 }}>{source.content_warning}</p>
        )}

        {source?.has_attachments && (
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Attachments on the original message are not copied into the redirect (text only).
          </p>
        )}

        {source && !loading && (
          <>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 6 }} htmlFor="beap-redirect-target">
              Target handshake (ACTIVE, P2P)
            </label>
            {hsLoading && <p style={{ fontSize: 12 }}>Loading handshakes…</p>}
            {hsError && <p style={{ fontSize: 12, color: '#f87171' }}>{hsError}</p>}
            {!hsLoading && eligible.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                No eligible handshakes. You need another ACTIVE handshake with P2P endpoint, bound local key, and (for
                internal) completed coordination identity.
              </p>
            )}
            {eligible.length > 0 && (
              <select
                id="beap-redirect-target"
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
                <option value="">Select handshake…</option>
                {eligible.map((h) => {
                  const label = h.counterparty_email
                    ? `${h.counterparty_email} (${h.handshake_id.slice(0, 8)}…)`
                    : h.handshake_id
                  return (
                    <option key={h.handshake_id} value={h.handshake_id}>
                      {label}
                      {h.handshake_type === 'internal' ? ' — internal' : ''}
                    </option>
                  )
                })}
              </select>
            )}

            {sendError && <p style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{sendError}</p>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className={UI_BUTTON.ghost} onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button
                type="button"
                className={UI_BUTTON.primary}
                disabled={!targetId || sending || eligible.length === 0}
                onClick={() => void doRedirect()}
              >
                {sending ? 'Sending…' : 'Send redirect'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
