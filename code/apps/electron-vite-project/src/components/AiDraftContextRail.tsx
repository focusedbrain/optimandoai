import { useCallback, useRef, type ReactNode } from 'react'
import type { ChangeEvent } from 'react'
import { useAiDraftContextStore } from '../stores/useAiDraftContextStore'
import { ingestAiContextFiles } from '../lib/ingestAiContextFiles'
import { ComposerAttachmentButton } from './ComposerAttachmentButton'

/** Solid, high-contrast rail copy (no translucent / washed panels). */
const railMuted = '#64748b'
const railFg = '#0f172a'
const border = '1px solid #cbd5e1'
const cardBg = '#ffffff'

type AiDraftContextRailProps = {
  /** Optional content below the AI context section (e.g. composer hints). */
  footer?: ReactNode
}

/**
 * Right-rail UI for shared AI drafting context (Prompt 5).
 * Send attachments stay in the main composer form — this store is LLM-only.
 */
export function AiDraftContextRail({ footer }: AiDraftContextRailProps) {
  const documents = useAiDraftContextStore((s) => s.documents)
  const removeDocument = useAiDraftContextStore((s) => s.removeDocument)
  const clear = useAiDraftContextStore((s) => s.clear)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFiles = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    await ingestAiContextFiles(files)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, color: railFg }}>
      <div>
        <div style={{ fontWeight: 700, color: railFg, marginBottom: 6, fontSize: 12, letterSpacing: '0.04em' }}>
          AI drafting context
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: railMuted, lineHeight: 1.45 }}>
          Used for <strong style={{ color: railFg }}>AI drafting only</strong> (chat / refine prompts). These documents are{' '}
          <strong style={{ color: railFg }}>not</strong> sent as BEAP™ package or email attachments.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.csv,.json"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => void onFiles(e)}
        />
        <ComposerAttachmentButton fullWidth label="Add reference files" onClick={() => fileRef.current?.click()} />
        <p style={{ margin: '8px 0 0', fontSize: 10, color: railMuted, lineHeight: 1.4 }}>
          Same library as the top bar 📎 — stays in sync.
        </p>
      </div>

      {documents.length === 0 ? (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px dashed #94a3b8',
            background: '#f8fafc',
            fontSize: 11,
            color: railMuted,
            lineHeight: 1.5,
          }}
        >
          No AI context yet. Add PDF or text files here or via the chat bar 📎. They inform the model when you chat or refine
          drafts — they are not included in send.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: railFg }}>In context ({documents.length})</span>
            <button
              type="button"
              onClick={() => clear()}
              style={{
                fontSize: 10,
                padding: '4px 8px',
                cursor: 'pointer',
                border: 'none',
                background: 'transparent',
                color: railMuted,
                textDecoration: 'underline',
              }}
            >
              Clear all
            </button>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', overflowY: 'auto', maxHeight: 220 }}>
            {documents.map((d) => (
              <li
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  marginBottom: 6,
                  borderRadius: 8,
                  background: cardBg,
                  border: '1px solid #e2e8f0',
                  fontSize: 11,
                  color: railFg,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word' }} title={d.name}>
                  📄 {d.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeDocument(d.id)}
                  aria-label={`Remove ${d.name}`}
                  style={{
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#dc2626',
                    fontSize: 12,
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {footer ? (
        <div style={{ borderTop: border, paddingTop: 12, marginTop: 4 }}>
          <div style={{ fontWeight: 600, color: railFg, marginBottom: 8, fontSize: 13 }}>Hints</div>
          {footer}
        </div>
      ) : null}
    </div>
  )
}
