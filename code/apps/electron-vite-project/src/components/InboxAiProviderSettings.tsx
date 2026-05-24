/**
 * InboxAiProviderSettings — "AI analysis" provider settings panel.
 *
 * Renders inside the AI detail panel when the user clicks the ⚙ gear icon.
 * Lets the user choose between Default, Local Ollama, and Cloud for
 * phishing assessment and validation cross-check analyses.
 *
 * Non-goals (P2.6):
 * - API key storage is NOT handled here; see existing Backend Configuration.
 * - Endpoint override for custom cloud deployments is stored but not yet wired
 *   (the field is shown with a TODO note; actual dispatch override is P2.x).
 * - Failover is not implemented; if the chosen provider is unavailable, analyses
 *   will silently fail per P2.4 best-effort contract.
 */

import { useState, useEffect, useCallback } from 'react'
import type { AiProviderSetting, AiProviderKind } from '../../../electron/main/email/ai/inboxAiProviderSetting'

// Re-export so callers can use the type without reaching into main-process imports.
export type { AiProviderSetting, AiProviderKind }

export const AI_PROVIDER_PRIVACY_DISCLAIMER =
  'Cloud analysis sends email content to your selected provider. Local analysis runs entirely on your machine but may produce less accurate results depending on your hardware and model.'

const DOCS_LINK = 'https://docs.optimando.ai/ai-provider-settings'

// ── Radio options ─────────────────────────────────────────────────────────────

const RADIO_OPTIONS: Array<{ kind: AiProviderKind; label: string; description: string }> = [
  {
    kind: 'default',
    label: 'Default',
    description: 'Use the tier default: Local Ollama for free accounts, Cloud for paid accounts.',
  },
  {
    kind: 'local_ollama',
    label: 'Local Ollama',
    description: 'Always use the locally-running Ollama model. Private — no data leaves your machine.',
  },
  {
    kind: 'cloud',
    label: 'Cloud',
    description: 'Use your configured cloud provider (set up in Backend Configuration).',
  },
]

// ── Pure form (testable without IPC) ─────────────────────────────────────────

export interface InboxAiProviderSettingsFormProps {
  initialSetting?: AiProviderSetting
  onSave?: (setting: AiProviderSetting) => Promise<{ ok: boolean; error?: string }>
}

/**
 * Pure settings form — stateful only over UI inputs, not IPC loading.
 * Exported for unit tests and for use by the IPC-connected InboxAiProviderSettings wrapper.
 */
export function InboxAiProviderSettingsForm({
  initialSetting = { kind: 'default' },
  onSave,
}: InboxAiProviderSettingsFormProps) {
  const [kind, setKind] = useState<AiProviderKind>(initialSetting.kind)
  const [cloudModel, setCloudModel] = useState(
    initialSetting.kind === 'cloud' ? (initialSetting.model ?? '') : '',
  )
  const [cloudEndpoint, setCloudEndpoint] = useState(
    initialSetting.kind === 'cloud' ? (initialSetting.endpoint ?? '') : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(async () => {
    if (!onSave) return
    setSaving(true)
    setError(null)
    const payload: AiProviderSetting =
      kind === 'cloud'
        ? {
            kind: 'cloud',
            model: cloudModel.trim() || undefined,
            endpoint: cloudEndpoint.trim() || undefined,
          }
        : { kind }
    const res = await onSave(payload)
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(res.error ?? 'Save failed')
    }
  }, [kind, cloudModel, cloudEndpoint, onSave])

  return (
    <div data-testid="ai-provider-settings" style={{ padding: '8px 0' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--color-text-muted, #94a3b8)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        AI ANALYSIS PROVIDER
      </div>

      {/* Radio group */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {RADIO_OPTIONS.map((opt) => (
          <label
            key={opt.kind}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: 4,
              background: kind === opt.kind ? 'rgba(147,51,234,0.08)' : 'transparent',
              border: `1px solid ${kind === opt.kind ? 'rgba(147,51,234,0.3)' : 'transparent'}`,
            }}
          >
            <input
              type="radio"
              name="ai-security-provider"
              value={opt.kind}
              checked={kind === opt.kind}
              onChange={() => setKind(opt.kind)}
              style={{ marginTop: 2, flexShrink: 0, accentColor: 'var(--purple-accent, #9333ea)' }}
              data-testid={`provider-radio-${opt.kind}`}
            />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                {opt.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)', marginTop: 2 }}>
                {opt.description}
              </div>
            </div>
          </label>
        ))}
      </div>

      {/* Cloud sub-fields */}
      {kind === 'cloud' && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            borderRadius: 4,
            background: 'rgba(148,163,184,0.05)',
            border: '1px solid rgba(148,163,184,0.15)',
          }}
          data-testid="cloud-sub-fields"
        >
          <div style={{ marginBottom: 8 }}>
            <label
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted, #94a3b8)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Model name{' '}
              <span style={{ opacity: 0.6 }}>(optional — leave blank to use provider default)</span>
            </label>
            <input
              type="text"
              value={cloudModel}
              onChange={(e) => setCloudModel(e.target.value)}
              placeholder="e.g. gpt-4o, claude-3-5-sonnet-20241022"
              data-testid="cloud-model-input"
              style={{
                width: '100%',
                padding: '5px 8px',
                borderRadius: 4,
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'rgba(148,163,184,0.05)',
                color: 'var(--color-text, #e2e8f0)',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label
              style={{
                fontSize: 11,
                color: 'var(--color-text-muted, #94a3b8)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              Custom endpoint URL{' '}
              <span style={{ opacity: 0.6 }}>(optional — leave blank to use provider default)</span>
            </label>
            <input
              type="text"
              value={cloudEndpoint}
              onChange={(e) => setCloudEndpoint(e.target.value)}
              placeholder="https://api.openai.com/v1"
              data-testid="cloud-endpoint-input"
              style={{
                width: '100%',
                padding: '5px 8px',
                borderRadius: 4,
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'rgba(148,163,184,0.05)',
                color: 'var(--color-text, #e2e8f0)',
                fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 10, color: 'rgba(148,163,184,0.6)', marginTop: 4 }}>
              API keys are managed in Backend Configuration, not here.
            </div>
          </div>
        </div>
      )}

      {/* Privacy disclaimer */}
      <div
        style={{
          marginBottom: 12,
          padding: '8px 10px',
          borderRadius: 4,
          background: 'rgba(148,163,184,0.04)',
          border: '1px solid rgba(148,163,184,0.12)',
          fontSize: 10,
          color: 'var(--color-text-muted, #94a3b8)',
          lineHeight: '1.5',
        }}
        data-testid="ai-provider-privacy-disclaimer"
      >
        {AI_PROVIDER_PRIVACY_DISCLAIMER}{' '}
        <a
          href={DOCS_LINK}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--purple-accent, #9333ea)', textDecoration: 'none' }}
        >
          Learn more
        </a>
      </div>

      {/* Save button + feedback */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          data-testid="save-provider-settings"
          style={{
            padding: '5px 14px',
            borderRadius: 4,
            border: 'none',
            background: 'var(--purple-accent, #9333ea)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && (
          <span style={{ fontSize: 11, color: '#22c55e' }} data-testid="save-success">
            Saved
          </span>
        )}
        {error && <span style={{ fontSize: 11, color: '#ef4444' }}>{error}</span>}
      </div>
    </div>
  )
}

// ── IPC-connected wrapper ──────────────────────────────────────────────────────

export interface InboxAiProviderSettingsProps {
  /** Called after a successful save so the panel can close/notify. */
  onSaved?: () => void
}

/**
 * IPC-connected wrapper — loads current setting via getInboxSettings,
 * then renders InboxAiProviderSettingsForm once loaded.
 */
export function InboxAiProviderSettings({ onSaved }: InboxAiProviderSettingsProps) {
  const [loaded, setLoaded] = useState(false)
  const [initialSetting, setInitialSetting] = useState<AiProviderSetting>({ kind: 'default' })

  useEffect(() => {
    if (!window.emailInbox?.getInboxSettings) {
      setLoaded(true)
      return
    }
    void window.emailInbox.getInboxSettings().then((res) => {
      if (res.ok && res.data?.aiSecurityProvider) {
        const sp = res.data.aiSecurityProvider
        if (sp.kind === 'local_ollama') {
          setInitialSetting({ kind: 'local_ollama' })
        } else if (sp.kind === 'cloud') {
          setInitialSetting({ kind: 'cloud', model: sp.model, endpoint: sp.endpoint })
        } else {
          setInitialSetting({ kind: 'default' })
        }
      }
      setLoaded(true)
    })
  }, [])

  if (!loaded) {
    return (
      <div style={{ padding: '12px 0', color: 'var(--color-text-muted, #94a3b8)', fontSize: 12 }}>
        Loading settings…
      </div>
    )
  }

  return (
    <InboxAiProviderSettingsForm
      initialSetting={initialSetting}
      onSave={async (setting) => {
        if (!window.emailInbox?.setInboxSettings) return { ok: false, error: 'IPC unavailable' }
        const res = await window.emailInbox.setInboxSettings({ aiSecurityProvider: setting })
        if (res.ok) onSaved?.()
        return res
      }}
    />
  )
}
