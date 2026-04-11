/**
 * Full-width dashboard email composer with inline account management and AI context rail.
 * Send pipeline mirrors EmailInlineComposer (does not import it per product constraint).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from '@ext/shared/email/connectEmailFlow'
import { EMAIL_SIGNATURE, type DraftAttachment } from './EmailComposeOverlay'
import { AiDraftContextRail } from './AiDraftContextRail'
import { ComposerAttachmentButton } from './ComposerAttachmentButton'
import { DraftRefineLabel } from './DraftRefineLabel'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import '../styles/dashboard-base.css'
import './AnalysisCanvas.css'

export interface DashboardEmailComposerProps {
  onClose: () => void
}

type AccountRow = {
  id: string
  displayName: string
  email: string
  provider: string
  status?: string
  processingPaused?: boolean
  lastError?: string
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'gmail':
      return 'Gmail'
    case 'microsoft365':
      return 'Outlook'
    case 'zoho':
      return 'Zoho'
    case 'imap':
      return 'Custom (IMAP)'
    default:
      return provider || 'Email'
  }
}

function accountStatusLabel(a: AccountRow): string {
  if (a.status === 'active' && a.processingPaused) return 'Connected · sync paused'
  switch (a.status) {
    case 'active':
      return 'Connected'
    case 'auth_error':
      return a.lastError?.trim() ? `Sign-in issue: ${a.lastError}` : 'Sign-in required'
    case 'error':
      return a.lastError?.trim() ? a.lastError : 'Connection error'
    case 'disabled':
      return 'Disabled'
    default:
      return 'Unknown'
  }
}

async function fetchAccountRows(): Promise<AccountRow[]> {
  if (typeof window.emailAccounts?.listAccounts !== 'function') return []
  try {
    const res = await window.emailAccounts.listAccounts()
    if (res.ok && res.data && res.data.length > 0) {
      return res.data as AccountRow[]
    }
  } catch {
    /* ignore */
  }
  return []
}

function AccountManagementSection({
  selectedAccountId,
  onAccountChange,
}: {
  selectedAccountId: string | null
  onAccountChange: (id: string | null) => void
}) {
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showManage, setShowManage] = useState(false)

  const loadAccounts = useCallback(async (): Promise<AccountRow[]> => {
    setLoading(true)
    try {
      const list = await fetchAccountRows()
      setAccounts(list)
      return list
    } finally {
      setLoading(false)
    }
  }, [])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    theme: 'professional',
    onAfterConnected: async () => {
      await loadAccounts()
    },
  })

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    const onChanged = () => {
      void loadAccounts()
    }
    window.addEventListener('wrdesk:email-accounts-changed', onChanged)
    return () => window.removeEventListener('wrdesk:email-accounts-changed', onChanged)
  }, [loadAccounts])

  useEffect(() => {
    const unsub = window.emailAccounts?.onAccountConnected?.((data) => {
      void (async () => {
        await loadAccounts()
        if (data.accountId) {
          onAccountChange(data.accountId)
          return
        }
        const em = data.email?.trim().toLowerCase()
        if (em) {
          const list = await fetchAccountRows()
          const row = list.find((a) => a.email?.trim().toLowerCase() === em)
          if (row) onAccountChange(row.id)
        }
      })()
    })
    return () => unsub?.()
  }, [loadAccounts, onAccountChange])

  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedAccountId !== null) onAccountChange(null)
      return
    }
    const stillThere = selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
    if (stillThere) return
    const pick =
      pickDefaultEmailAccountRowId(accounts.map((a) => ({ id: a.id, status: a.status }))) ?? accounts[0].id
    onAccountChange(pick)
  }, [accounts, onAccountChange, selectedAccountId])

  if (loading && accounts.length === 0) {
    return (
      <div className="dashboard-email-composer__account-loading">
        <p>Loading email accounts…</p>
        {connectEmailFlowModal}
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="composer-no-account">
        <p>No email account connected.</p>
        <button type="button" className="dashboard-email-composer__btn-secondary" onClick={() => openConnectEmail(ConnectEmailLaunchSource.Inbox)}>
          + Connect Email Account
        </button>
        {connectEmailFlowModal}
      </div>
    )
  }

  const active = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]

  return (
    <div className="composer-account-section">
      <div className="composer-active-account">
        <div className="composer-active-account__label">Active account</div>
        <div className="composer-active-account__row">
          <span className="composer-active-account__icon" aria-hidden>
            📧
          </span>
          <select
            className="composer-active-account__select"
            value={selectedAccountId ?? active.id}
            onChange={(e) => onAccountChange(e.target.value || null)}
            aria-label="Active email account"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email || a.displayName} ({providerLabel(a.provider)})
              </option>
            ))}
          </select>
        </div>
        <div className="composer-active-account__meta">
          {providerLabel(active.provider)} · {accountStatusLabel(active)}
        </div>
        <div className="composer-active-account__actions">
          <button type="button" className="dashboard-email-composer__btn-secondary" onClick={() => openConnectEmail(ConnectEmailLaunchSource.Inbox)}>
            + Connect Account
          </button>
          <button
            type="button"
            className="dashboard-email-composer__btn-secondary"
            onClick={() => setShowManage((v) => !v)}
            aria-expanded={showManage}
          >
            ⚙ Manage
          </button>
        </div>
      </div>

      {showManage && (
        <div className="composer-account-list">
          {accounts.map((a) => (
            <div key={a.id} className="composer-account-row">
              <div className="composer-account-row__main">
                <span className="composer-account-row__email">{a.email || a.displayName}</span>
                <span className="provider-badge">{providerLabel(a.provider)}</span>
              </div>
              <div className="composer-account-row__actions">
                <button type="button" className="dashboard-email-composer__btn-link" onClick={() => onAccountChange(a.id)}>
                  Set Active
                </button>
                <button
                  type="button"
                  className="dashboard-email-composer__btn-danger"
                  onClick={async () => {
                    if (typeof window.emailAccounts?.deleteAccount !== 'function') return
                    await window.emailAccounts.deleteAccount(a.id)
                    await loadAccounts()
                    try {
                      window.dispatchEvent(new CustomEvent('wrdesk:email-accounts-changed'))
                    } catch {
                      /* noop */
                    }
                  }}
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {connectEmailFlowModal}
    </div>
  )
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
      <div className="dashboard-email-composer__form">
        <AccountManagementSection selectedAccountId={selectedAccountId} onAccountChange={setSelectedAccountId} />

        <hr className="dashboard-email-composer__divider" />

        <label className="dashboard-email-composer__field">
          <span>To</span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com (comma-separated allowed)"
            autoComplete="off"
          />
        </label>

        <label className="dashboard-email-composer__field">
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

        <label className="dashboard-email-composer__field dashboard-email-composer__field--grow">
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
        </label>

        <div className="dashboard-email-composer__attachments">
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

        <p className="dashboard-email-composer__tagline">— Automate your inbox. wrdesk.com</p>

        <div className="dashboard-email-composer__signature">
          <div className="dashboard-email-composer__signature-label">Signature (appended on send)</div>
          <pre className="dashboard-email-composer__signature-pre">{EMAIL_SIGNATURE.trim()}</pre>
        </div>

        {sendSuccess && <div className="dashboard-email-composer__success">Email sent successfully</div>}
        {error && <div className="dashboard-email-composer__error">{error}</div>}

        <div className="dashboard-email-composer__actions">
          <button type="button" className="dashboard-email-composer__btn-send" onClick={() => void handleSend()} disabled={!canSend}>
            {isSending ? 'Sending…' : '📤 Send Email'}
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
  )
}

export default DashboardEmailComposer
