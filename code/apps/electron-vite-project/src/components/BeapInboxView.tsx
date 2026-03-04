import { useState, useEffect, type CSSProperties } from 'react'

type BeapSubmode = 'inbox' | 'draft' | 'outbox' | 'archived' | 'rejected'

interface EmailAccount {
  id: string
  displayName: string
  email: string
  provider: 'gmail' | 'microsoft365' | 'imap'
  status: 'active' | 'error' | 'disabled'
  lastError?: string
}

const NAV_ITEMS: { key: BeapSubmode; label: string; icon: string }[] = [
  { key: 'inbox',    label: 'Inbox',    icon: '📥' },
  { key: 'draft',    label: 'Draft',    icon: '✏️' },
  { key: 'outbox',   label: 'Outbox',   icon: '📤' },
  { key: 'archived', label: 'Archived', icon: '📁' },
  { key: 'rejected', label: 'Rejected', icon: '🚫' },
]

export default function BeapInboxView() {
  const [submode, setSubmode] = useState<BeapSubmode>('inbox')
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [draftTo, setDraftTo] = useState('')
  const [draftMessage, setDraftMessage] = useState('')

  useEffect(() => {
    window.emailAccounts?.listAccounts().then(res => {
      if (res.ok && res.data) {
        setEmailAccounts(res.data as EmailAccount[])
        if (res.data.length > 0) setSelectedAccountId(res.data[0].id)
      }
    }).catch(() => {})
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar nav */}
      <aside style={{
        width: '160px',
        flexShrink: 0,
        borderRight: '1px solid var(--color-border, rgba(255,255,255,0.1))',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 8px',
        gap: '4px',
        background: 'var(--color-bg-surface, rgba(255,255,255,0.03))',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, rgba(255,255,255,0.5))', padding: '0 8px', marginBottom: '8px' }}>
          BEAP™ Inbox
        </div>
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => setSubmode(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: submode === item.key ? 600 : 400,
              background: submode === item.key ? 'var(--color-accent, rgba(147,51,234,0.25))' : 'transparent',
              color: submode === item.key ? 'var(--color-text, #e2e8f0)' : 'var(--color-text-muted, rgba(255,255,255,0.6))',
              textAlign: 'left',
              width: '100%',
            }}
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {submode === 'inbox' && <PlaceholderPanel icon="📥" title="BEAP Inbox" description="Received BEAP™ packages will appear here. All packages are verified before display." onNew={() => setSubmode('draft')} />}
        {submode === 'outbox' && <PlaceholderPanel icon="📤" title="BEAP Outbox" description="Packages pending delivery. Monitor send status and delivery confirmations." />}
        {submode === 'archived' && <PlaceholderPanel icon="📁" title="Archived Packages" description="Successfully executed packages are archived here for reference." />}
        {submode === 'rejected' && <PlaceholderPanel icon="🚫" title="Rejected Packages" description="Rejected packages that failed verification or were declined by the user." />}
        {submode === 'draft' && (
          <DraftCompose
            emailAccounts={emailAccounts}
            selectedAccountId={selectedAccountId}
            onSelectAccount={setSelectedAccountId}
            draftTo={draftTo}
            onChangeTo={setDraftTo}
            draftMessage={draftMessage}
            onChangeMessage={setDraftMessage}
            onBack={() => setSubmode('inbox')}
          />
        )}
      </main>
    </div>
  )
}

function PlaceholderPanel({ icon, title, description, onNew }: { icon: string; title: string; description: string; onNew?: () => void }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', textAlign: 'center', position: 'relative' }}>
      <span style={{ fontSize: '56px', marginBottom: '20px' }}>{icon}</span>
      <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)', marginBottom: '10px' }}>{title}</div>
      <div style={{ fontSize: '14px', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', maxWidth: '360px', lineHeight: 1.6 }}>{description}</div>
      {onNew && (
        <button
          onClick={onNew}
          style={{
            position: 'absolute', bottom: '32px', right: '32px',
            width: '52px', height: '52px', borderRadius: '50%',
            border: 'none', cursor: 'pointer', fontSize: '26px',
            background: 'var(--color-accent, #9333ea)', color: 'white',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="New Draft"
        >
          +
        </button>
      )}
    </div>
  )
}

function DraftCompose({ emailAccounts, selectedAccountId, onSelectAccount, draftTo, onChangeTo, draftMessage, onChangeMessage, onBack }: {
  emailAccounts: EmailAccount[]
  selectedAccountId: string | null
  onSelectAccount: (id: string) => void
  draftTo: string
  onChangeTo: (v: string) => void
  draftMessage: string
  onChangeMessage: (v: string) => void
  onBack: () => void
}) {
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', marginBottom: '6px', display: 'block' }
  const inputStyle: CSSProperties = { width: '100%', padding: '10px 12px', background: 'var(--color-input-bg, rgba(255,255,255,0.08))', border: '1px solid var(--color-border, rgba(255,255,255,0.12))', borderRadius: '8px', color: 'var(--color-text, #e2e8f0)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' as const }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px', gap: '20px', overflowY: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted, rgba(255,255,255,0.6))', fontSize: '20px', lineHeight: 1, padding: '4px' }}>←</button>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>New BEAP™ Draft</h2>
      </div>

      {/* Send From */}
      {emailAccounts.length > 0 ? (
        <div>
          <label style={labelStyle}>Send From</label>
          <select value={selectedAccountId || ''} onChange={e => onSelectAccount(e.target.value)} style={inputStyle}>
            {emailAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.email || a.displayName} ({a.provider})</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{ padding: '16px', background: 'var(--color-bg-surface, rgba(255,255,255,0.04))', borderRadius: '8px', border: '1px dashed var(--color-border, rgba(255,255,255,0.15))', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-muted, rgba(255,255,255,0.5))' }}>
          No email accounts connected. Connect one via the Handshakes settings.
        </div>
      )}

      {/* Recipient */}
      <div>
        <label style={labelStyle}>Recipient Email</label>
        <input type="email" value={draftTo} onChange={e => onChangeTo(e.target.value)} placeholder="recipient@example.com" style={inputStyle} />
      </div>

      {/* Message */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <label style={labelStyle}>Message</label>
        <textarea
          value={draftMessage}
          onChange={e => onChangeMessage(e.target.value)}
          placeholder="Write your BEAP™ message here..."
          style={{ ...inputStyle, flex: 1, minHeight: '200px', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
        <button onClick={onBack} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--color-border, rgba(255,255,255,0.15))', background: 'transparent', color: 'var(--color-text-muted, rgba(255,255,255,0.7))', cursor: 'pointer', fontSize: '13px' }}>
          Cancel
        </button>
        <button
          disabled={!draftTo || !draftMessage}
          style={{ padding: '10px 24px', borderRadius: '8px', border: 'none', background: draftTo && draftMessage ? 'var(--color-accent, #9333ea)' : 'rgba(147,51,234,0.3)', color: 'white', cursor: draftTo && draftMessage ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: 600 }}
        >
          Send BEAP™
        </button>
      </div>
    </div>
  )
}
