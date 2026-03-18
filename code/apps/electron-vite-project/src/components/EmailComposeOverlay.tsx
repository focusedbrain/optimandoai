/**
 * EmailComposeOverlay — Plain email compose form for Electron dashboard.
 * To, Subject, Body, Attachments (file picker), mandatory signature preview, Send.
 */

import { useState, useRef, useEffect } from 'react'

const EMAIL_SIGNATURE = '\n\n—\nAutomate your inbox. Try wrdesk.com\nhttps://wrdesk.com'

export interface ReplyToPrefill {
  to?: string
  subject?: string
  body?: string
}

interface EmailComposeOverlayProps {
  theme?: 'professional' | 'default'
  onClose: () => void
  onSent?: () => void
  /** Pre-fill To, Subject, Body when replying to a message */
  replyTo?: ReplyToPrefill
}

export default function EmailComposeOverlay({
  theme = 'professional',
  onClose,
  onSent,
  replyTo,
}: EmailComposeOverlayProps) {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const inputBg = isProfessional ? 'white' : 'rgba(255,255,255,0.08)'

  const [to, setTo] = useState(replyTo?.to ?? '')
  const [subject, setSubject] = useState(replyTo?.subject ?? '')
  const [body, setBody] = useState(replyTo?.body ?? '')
  const [attachments, setAttachments] = useState<File[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: string }>>([])
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (replyTo) {
      setTo(replyTo.to ?? '')
      setSubject(replyTo.subject ?? '')
      setBody(replyTo.body ?? '')
    }
  }, [replyTo])

  useEffect(() => {
    const load = async () => {
      if (typeof window.emailAccounts?.listAccounts !== 'function') {
        setIsLoadingAccounts(false)
        return
      }
      try {
        const res = await window.emailAccounts!.listAccounts()
        if (res.ok && res.data && res.data.length > 0) {
          setAccounts(res.data)
          setSelectedAccountId(res.data[0].id)
        }
      } catch {
        // ignore
      } finally {
        setIsLoadingAccounts(false)
      }
    }
    load()
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

  const handleSend = async () => {
    setError(null)
    const toTrimmed = to.trim()
    if (!toTrimmed) {
      setError('To is required')
      return
    }
    const accountId = selectedAccountId || accounts[0]?.id
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
      const res = await window.emailAccounts!.sendEmail(accountId, {
        to: toTrimmed.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
        subject: subject.trim() || '(No subject)',
        bodyText: fullBody,
      })
      if (res.ok && res.data?.success) {
        onSent?.()
        onClose()
      } else {
        setError(res.error || 'Failed to send')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.04)',
      color: textColor,
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>New Email</span>
        <button
          onClick={onClose}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            background: 'transparent',
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            color: mutedColor,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {accounts.length > 1 && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>From</label>
            <select
              value={selectedAccountId || ''}
              onChange={(e) => setSelectedAccountId(e.target.value || null)}
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                background: inputBg,
                border: `1px solid ${borderColor}`,
                borderRadius: 6,
                color: textColor,
                outline: 'none',
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.email || a.displayName} ({a.provider})</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>To</label>
          <input
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              color: textColor,
              outline: 'none',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              color: textColor,
              outline: 'none',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            rows={8}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: inputBg,
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              color: textColor,
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 600, color: mutedColor, display: 'block', marginBottom: 4 }}>Attachments</label>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              background: 'transparent',
              border: `1px dashed ${borderColor}`,
              borderRadius: 6,
              color: mutedColor,
              cursor: 'pointer',
            }}
          >
            + Add files
          </button>
          {attachments.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {attachments.map((f, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    padding: '4px 8px',
                    background: 'rgba(0,0,0,0.1)',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {f.name}
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: mutedColor, fontSize: 12 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: mutedColor, marginBottom: 4 }}>Signature (appended automatically)</div>
          <pre style={{
            fontSize: 11,
            color: mutedColor,
            background: 'rgba(0,0,0,0.05)',
            padding: 8,
            borderRadius: 6,
            margin: 0,
            whiteSpace: 'pre-wrap',
          }}>
            {EMAIL_SIGNATURE.trim()}
          </pre>
        </div>
        {error && (
          <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>
        )}
        <button
          onClick={handleSend}
          disabled={isSending || isLoadingAccounts || accounts.length === 0}
          style={{
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            background: '#2563eb',
            border: 'none',
            borderRadius: 8,
            color: 'white',
            cursor: isSending ? 'not-allowed' : 'pointer',
            opacity: isSending || accounts.length === 0 ? 0.6 : 1,
          }}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}
