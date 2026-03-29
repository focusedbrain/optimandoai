/**
 * Inline plain-email composer for the Electron inbox (panel layout, not modal).
 * Send pipeline matches `EmailComposeOverlay`: `window.emailAccounts.sendEmail` + `EMAIL_SIGNATURE`.
 */

import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { EMAIL_SIGNATURE, type DraftAttachment } from './EmailComposeOverlay'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { AiDraftContextRail } from './AiDraftContextRail'
import { ComposerAttachmentButton } from './ComposerAttachmentButton'
import { DraftRefineLabel } from './DraftRefineLabel'

export interface EmailInlineComposerProps {
  onClose: () => void
  onSent: () => void
  replyTo?: { to: string; subject: string; body: string; initialAttachments?: DraftAttachment[] } | null
}

const draftSurface: CSSProperties = {
  background: '#ffffff',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
}

const draftFocusRing = '0 0 0 1px #6366f1'

export function EmailInlineComposer({ onClose, onSent, replyTo }: EmailInlineComposerProps) {
  const border = '1px solid #e2e8f0'
  const muted = '#64748b'
  const fg = '#e2e8f0'
  const hintOnRail = '#475569'

  const [to, setTo] = useState(replyTo?.to ?? '')
  const [subject, setSubject] = useState(replyTo?.subject ?? '')
  const [body, setBody] = useState(replyTo?.body ?? '')
  const [attachments, setAttachments] = useState<File[]>([])
  const [pathAttachments, setPathAttachments] = useState<DraftAttachment[]>(replyTo?.initialAttachments ?? [])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: string; status?: string }>>([])
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const emailSuccessCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const connect = useDraftRefineStore((s) => s.connect)
  const disconnect = useDraftRefineStore((s) => s.disconnect)
  const connected = useDraftRefineStore((s) => s.connected)
  const refineTarget = useDraftRefineStore((s) => s.refineTarget)
  const updateDraftText = useDraftRefineStore((s) => s.updateDraftText)

  const handleBodyFieldClick = useCallback(() => {
    if (connected && refineTarget === 'email') {
      disconnect()
    } else {
      connect(null, 'New Email', body, setBody, 'email')
    }
  }, [connected, refineTarget, disconnect, connect, body])

  useEffect(() => {
    if (!connected || refineTarget !== 'email') return
    updateDraftText(body)
  }, [body, connected, refineTarget, updateDraftText])

  useEffect(() => () => disconnect(), [disconnect])

  useEffect(() => {
    return () => {
      if (emailSuccessCloseTimerRef.current) {
        clearTimeout(emailSuccessCloseTimerRef.current)
        emailSuccessCloseTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (replyTo) {
      setTo(replyTo.to ?? '')
      setSubject(replyTo.subject ?? '')
      setBody(replyTo.body ?? '')
      setPathAttachments(replyTo.initialAttachments ?? [])
    }
  }, [replyTo])

  useEffect(() => {
    const load = async () => {
      if (typeof window.emailAccounts?.listAccounts !== 'function') {
        setIsLoadingAccounts(false)
        return
      }
      try {
        const res = await window.emailAccounts.listAccounts()
        if (res.ok && res.data && res.data.length > 0) {
          setAccounts(res.data)
          const pick = pickDefaultEmailAccountRowId(
            res.data.map((a: { id: string; status?: string }) => ({ id: a.id, status: a.status })),
          )
          setSelectedAccountId(pick ?? res.data[0].id)
        }
      } catch {
        /* ignore */
      } finally {
        setIsLoadingAccounts(false)
      }
    }
    void load()
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    setAttachments((prev) => [...prev, ...Array.from(files)])
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const removePathAttachment = (index: number) => {
    setPathAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSend = useCallback(async () => {
    setError(null)
    setSendSuccess(false)
    if (emailSuccessCloseTimerRef.current) {
      clearTimeout(emailSuccessCloseTimerRef.current)
      emailSuccessCloseTimerRef.current = null
    }
    const toTrimmed = to.trim()
    if (!toTrimmed) {
      setError('To is required')
      return
    }
    const accountId =
      selectedAccountId || pickDefaultEmailAccountRowId(accounts.map((a) => ({ id: a.id, status: a.status })))
    if (!accountId || accounts.length === 0) {
      setError('No email account connected')
      return
    }
    if (typeof window.emailAccounts?.sendEmail !== 'function') {
      setError('Email send not available')
      return
    }
    setIsSending(true)
    try {
      const fullBody = body.trim() + EMAIL_SIGNATURE
      const emailAttachments: { filename: string; mimeType: string; contentBase64: string }[] = []

      for (const f of attachments) {
        const buf = await f.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
        const mimeMap: Record<string, string> = {
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xls: 'application/vnd.ms-excel',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          txt: 'text/plain',
        }
        emailAttachments.push({
          filename: f.name,
          mimeType: mimeMap[ext] ?? 'application/octet-stream',
          contentBase64: base64,
        })
      }

      if (window.emailInbox?.readFileForAttachment && pathAttachments.length > 0) {
        for (const pa of pathAttachments) {
          const res = await window.emailInbox.readFileForAttachment(pa.path)
          if (res?.ok && res?.data) {
            emailAttachments.push({
              filename: res.data.filename,
              mimeType: res.data.mimeType,
              contentBase64: res.data.contentBase64,
            })
          }
        }
      }

      const res = await window.emailAccounts.sendEmail(accountId, {
        to: toTrimmed
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        subject: subject.trim() || '(No subject)',
        bodyText: fullBody,
        attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
      })
      if (res.ok && res.data?.success) {
        setSendSuccess(true)
        emailSuccessCloseTimerRef.current = setTimeout(() => {
          emailSuccessCloseTimerRef.current = null
          setSendSuccess(false)
          setAttachments([])
          setPathAttachments([])
          onSent()
        }, 2000)
      } else {
        setError(res.error || 'Failed to send')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setIsSending(false)
    }
  }, [accounts, attachments, body, onSent, pathAttachments, selectedAccountId, subject, to])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSend()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSend])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 260px',
        gap: 0,
        minHeight: 0,
        height: '100%',
        flex: 1,
        overflow: 'hidden',
        background: 'var(--color-bg, #0f172a)',
        color: fg,
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          borderRight: border,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: border,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>New Email</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '4px 10px', cursor: 'pointer', background: 'transparent', border, borderRadius: 6, color: fg }} aria-label="Close composer">
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {accounts.length > 1 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>From</label>
              <select
                value={selectedAccountId || ''}
                onChange={(e) => setSelectedAccountId(e.target.value || null)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 13,
                  ...draftSurface,
                  borderRadius: 8,
                  outline: 'none',
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email || a.displayName} ({a.provider})
                  </option>
                ))}
              </select>
            </div>
          )}

          {isLoadingAccounts && <div style={{ fontSize: 12, color: muted }}>Loading accounts…</div>}

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>To</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com (comma-separated allowed)"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                ...draftSurface,
                borderRadius: 8,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = draftFocusRing
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 13,
                ...draftSurface,
                borderRadius: 8,
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = draftFocusRing
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>
              <DraftRefineLabel active={connected && refineTarget === 'email'}>Body</DraftRefineLabel>
            </label>
            <textarea
              data-compose-field="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onClick={handleBodyFieldClick}
              placeholder="Write your message…"
              style={{
                flex: 1,
                minHeight: 280,
                width: '100%',
                maxWidth: '100%',
                boxSizing: 'border-box',
                padding: '12px 14px',
                fontSize: 14,
                lineHeight: 1.5,
                background: '#ffffff',
                color: '#0f172a',
                border: connected && refineTarget === 'email' ? '2px solid #7c3aed' : '1px solid #cbd5e1',
                borderRadius: 8,
                outline: 'none',
                resize: 'vertical',
              }}
              onFocus={(e) => {
                if (!(connected && refineTarget === 'email')) e.currentTarget.style.boxShadow = draftFocusRing
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: muted, display: 'block', marginBottom: 6 }}>Attachments</label>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            <ComposerAttachmentButton label="Add attachments" onClick={() => fileInputRef.current?.click()} />
            {(attachments.length > 0 || pathAttachments.length > 0) && (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {attachments.map((f, i) => (
                  <span
                    key={`file-${i}-${f.name}`}
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {f.name}
                    <button type="button" onClick={() => removeAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 14 }}>
                      ×
                    </button>
                  </span>
                ))}
                {pathAttachments.map((pa, i) => (
                  <span
                    key={`path-${i}-${pa.path}`}
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {pa.name}
                    <span style={{ fontSize: 10, opacity: 0.8 }}>{Math.round(pa.size / 1024)} KB</span>
                    <button type="button" onClick={() => removePathAttachment(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: muted, fontSize: 14 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: muted, marginBottom: 6 }}>Signature (appended on send)</div>
            <pre
              style={{
                fontSize: 11,
                color: '#334155',
                background: '#f8fafc',
                padding: 10,
                borderRadius: 8,
                margin: 0,
                whiteSpace: 'pre-wrap',
                border: '1px solid #e2e8f0',
                fontFamily: 'inherit',
              }}
            >
              {EMAIL_SIGNATURE.trim()}
            </pre>
          </div>

          {sendSuccess && (
            <div
              style={{
                background: '#dcfce7',
                color: '#166534',
                border: '1px solid #86efac',
                borderRadius: 6,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              ✅ Email sent successfully
            </div>
          )}

          {error && <div style={{ fontSize: 13, color: '#f87171' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={isSending || sendSuccess || isLoadingAccounts || accounts.length === 0}
              style={{
                padding: '12px 20px',
                fontSize: 14,
                fontWeight: 700,
                background: '#2563eb',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                cursor: isSending || accounts.length === 0 ? 'not-allowed' : 'pointer',
                opacity: isSending || accounts.length === 0 ? 0.6 : 1,
              }}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '12px 16px',
                fontSize: 14,
                borderRadius: 8,
                border,
                background: 'transparent',
                color: fg,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <aside
        style={{
          padding: '18px 16px',
          fontSize: 12,
          lineHeight: 1.55,
          color: hintOnRail,
          overflowY: 'auto',
          minWidth: 0,
          minHeight: 0,
          borderLeft: border,
          background: '#f8fafc',
        }}
      >
        <AiDraftContextRail
          footer={
            <>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: hintOnRail }}>
                Files added in the main column attach to the outgoing email, not the AI context list above.
              </p>
              <p style={{ margin: '0 0 10px', color: hintOnRail }}>The signature block is appended automatically when you send.</p>
              <p style={{ margin: 0, color: hintOnRail }}>
                Click the body field to connect the top chat bar for AI refinement; click again to disconnect.
              </p>
            </>
          }
        />
      </aside>
    </div>
  )
}

export default EmailInlineComposer
