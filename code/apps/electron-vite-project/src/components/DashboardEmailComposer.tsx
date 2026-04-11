/**
 * Full-width dashboard email composer with inline account management and AI context rail.
 * Send pipeline mirrors EmailInlineComposer (does not import it per product constraint).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ConnectEmailLaunchSource } from '@ext/shared/email/connectEmailFlow'
import { EMAIL_SIGNATURE, type DraftAttachment } from './EmailComposeOverlay'
import { AiDraftContextRail } from './AiDraftContextRail'
import { ComposerAttachmentButton } from './ComposerAttachmentButton'
import { DraftRefineLabel } from './DraftRefineLabel'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { EmailAccountSelector } from './shared/EmailAccountSelector'
import '../styles/dashboard-base.css'
import './composer-layout.css'
import './AnalysisCanvas.css'

export interface DashboardEmailComposerProps {
  onClose: () => void
}

export function DashboardEmailComposer({ onClose }: DashboardEmailComposerProps) {
  const connect = useDraftRefineStore((s) => s.connect)
  const disconnect = useDraftRefineStore((s) => s.disconnect)
  const connected = useDraftRefineStore((s) => s.connected)
  const refineTarget = useDraftRefineStore((s) => s.refineTarget)
  const updateDraftText = useDraftRefineStore((s) => s.updateDraftText)

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [pathAttachments, setPathAttachments] = useState<DraftAttachment[]>([])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const emailSuccessCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFieldSelect = useCallback(
    (field: 'subject' | 'body') => {
      const target = field === 'subject' ? 'email-subject' : 'email'
      if (connected && refineTarget === target) {
        disconnect()
        return
      }
      if (field === 'subject') {
        connect(null, 'New Email', subject, setSubject, 'email-subject')
      } else {
        connect(null, 'New Email', body, setBody, 'email')
      }
    },
    [connected, refineTarget, disconnect, connect, subject, body],
  )

  const handleClose = useCallback(() => {
    useDraftRefineStore.getState().disconnect()
    onClose()
  }, [onClose])

  useEffect(() => {
    return () => {
      if (emailSuccessCloseTimerRef.current) {
        clearTimeout(emailSuccessCloseTimerRef.current)
        emailSuccessCloseTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    if (refineTarget === 'email') updateDraftText(body)
    else if (refineTarget === 'email-subject') updateDraftText(subject)
  }, [body, subject, connected, refineTarget, updateDraftText])

  useEffect(() => () => disconnect(), [disconnect])

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
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
    const accountId = selectedAccountId
    if (!accountId) {
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
        }, 2000)
      } else {
        setError(res.error || 'Failed to send')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setIsSending(false)
    }
  }, [selectedAccountId, attachments, body, pathAttachments, subject, to])

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleSend()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSend])

  const canSend = Boolean(selectedAccountId) && !isSending && !sendSuccess

  return (
    <div className="dashboard-email-composer">
      <div className="composer-grid">
        <div className="composer-form-column dashboard-email-composer__form">
          <div className="compose-field-fixed">
            <EmailAccountSelector
              selectedAccountId={selectedAccountId}
              onAccountChange={setSelectedAccountId}
              connectTheme="professional"
              connectLaunchSource={ConnectEmailLaunchSource.Inbox}
            />
          </div>

          <hr className="dashboard-email-composer__divider" />

          <label className="dashboard-email-composer__field compose-field-fixed">
            <span>To</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com (comma-separated allowed)"
              autoComplete="off"
            />
          </label>

          <label className="dashboard-email-composer__field compose-field-fixed">
            <span>
              <DraftRefineLabel active={connected && refineTarget === 'email-subject'}>Subject</DraftRefineLabel>
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onClick={() => handleFieldSelect('subject')}
              placeholder="Subject"
              autoComplete="off"
              className={connected && refineTarget === 'email-subject' ? 'field-selected-for-ai' : undefined}
            />
          </label>

          <div className="composer-body-container dashboard-email-composer__field dashboard-email-composer__field--grow">
            <span>
              <DraftRefineLabel active={connected && refineTarget === 'email'}>Body</DraftRefineLabel>
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onClick={() => handleFieldSelect('body')}
              placeholder="Write your message…"
              data-compose-field="email-body"
              className={connected && refineTarget === 'email' ? 'field-selected-for-ai' : undefined}
            />
          </div>

          <div className="dashboard-email-composer__attachments compose-field-fixed">
            <span className="dashboard-email-composer__attachments-label">Attachments</span>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
            <ComposerAttachmentButton label="+ Add File" onClick={() => fileInputRef.current?.click()} />
            {(attachments.length > 0 || pathAttachments.length > 0) && (
              <div className="dashboard-email-composer__attachment-chips">
                {attachments.map((f, i) => (
                  <span key={`file-${i}-${f.name}`} className="dashboard-email-composer__chip">
                    {f.name}
                    <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${f.name}`}>
                      ×
                    </button>
                  </span>
                ))}
                {pathAttachments.map((pa, i) => (
                  <span key={`path-${i}-${pa.path}`} className="dashboard-email-composer__chip">
                    {pa.name}
                    <span className="dashboard-email-composer__chip-size">{Math.round(pa.size / 1024)} KB</span>
                    <button type="button" onClick={() => removePathAttachment(i)} aria-label={`Remove ${pa.name}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="dashboard-email-composer__tagline compose-field-fixed">— Automate your inbox. wrdesk.com</p>

          <div className="dashboard-email-composer__signature compose-field-fixed">
            <div className="dashboard-email-composer__signature-label">Signature (appended on send)</div>
            <pre className="dashboard-email-composer__signature-pre">{EMAIL_SIGNATURE.trim()}</pre>
          </div>

          {sendSuccess && <div className="dashboard-email-composer__success">Email sent successfully</div>}
          {error && <div className="dashboard-email-composer__error">{error}</div>}

          <div className="dashboard-email-composer__actions compose-field-fixed">
            <button type="button" className="dashboard-email-composer__btn-send" onClick={() => void handleSend()} disabled={!canSend}>
              {isSending ? 'Sending…' : 'Send Email'}
            </button>
            <button type="button" className="dashboard-email-composer__btn-secondary" onClick={handleClose}>
              Cancel
            </button>
          </div>
        </div>

        <div className="dashboard-email-composer__context">
          <AiDraftContextRail
            footer={
              <>
                <p className="dashboard-email-composer__context-footer">
                  Files added in the left column attach to the outgoing email, not the AI context list above.
                </p>
                <p className="dashboard-email-composer__context-footer">The signature block is appended automatically when you send.</p>
              </>
            }
          />
        </div>
      </div>
    </div>
  )
}

export default DashboardEmailComposer
