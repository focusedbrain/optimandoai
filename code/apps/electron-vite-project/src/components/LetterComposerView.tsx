import { useCallback, useEffect } from 'react'
import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import { useLetterComposerStore } from '../stores/useLetterComposerStore'
import { LetterTemplatePort } from './LetterTemplatePort'
import { LetterViewerPort } from './LetterViewerPort'
import './LetterComposerView.css'

/** Pushes letter-composer into chat focus. `focusedPort` is set by port buttons or implicitly when a template field is focused (`setFocusedTemplateField`). */
function syncLetterComposerChatFocus() {
  const lc = useLetterComposerStore.getState()
  const st = useChatFocusStore.getState()
  if (!lc.focusedPort) {
    if (st.chatFocusMode.mode === 'letter-composer') {
      st.clearChatFocusMode()
    }
    return
  }
  const startedAt =
    st.chatFocusMode.mode === 'letter-composer' && 'startedAt' in st.chatFocusMode
      ? st.chatFocusMode.startedAt
      : new Date().toISOString()

  if (lc.focusedPort === 'template') {
    const t = lc.templates.find((x) => x.id === lc.activeTemplateId)
    const excerpt = t
      ? [
          `Letter template "${t.name}" (${t.pageCount} page(s), PDF preview).`,
          t.fields.length
            ? `Fields: ${t.fields.map((f) => `${f.label} (${f.name})`).join('; ')}`
            : 'Field mapping not completed yet.',
        ]
          .join('\n')
          .slice(0, 12_000)
      : ''
    st.setChatFocusMode(
      { mode: 'letter-composer', startedAt },
      {
        letterComposerPort: 'template',
        letterComposerTemplateId: lc.activeTemplateId,
        letterComposerFields: (t?.fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          value: f.value,
        })),
        letterComposerApplyFieldId: lc.focusedTemplateFieldId,
        letterComposerTemplateHtmlExcerpt: excerpt,
      },
    )
  } else {
    const letter = lc.letters.find((l) => l.id === lc.activeLetterId)
    const pageIdx = Math.max(0, lc.activeLetterPage)
    const page = letter?.pages[pageIdx]
    const fullExcerpt = (letter?.fullText ?? '').trim().slice(0, 12_000)
    const pageText = (page?.text ?? '').trim()
    const text = fullExcerpt || pageText
    const meta =
      letter && Object.keys(letter.extractedFields).length > 0
        ? `\n\nExtracted metadata (may need verification):\n${Object.entries(letter.extractedFields)
            .filter(([, v]) => (v ?? '').trim().length > 0)
            .map(([k, v]) => `- ${k}: ${v}`)
            .join('\n')}`
        : ''
    st.setChatFocusMode(
      { mode: 'letter-composer', startedAt },
      {
        letterComposerPort: 'letter',
        letterComposerLetterPageText: `${text}${meta}`,
      },
    )
  }
}

export function LetterComposerView({ onClose }: { onClose: () => void }) {
  const handleClose = useCallback(() => {
    useDraftRefineStore.getState().disconnect()
    useLetterComposerStore.getState().setFocusedTemplateField(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    const unsub = useLetterComposerStore.subscribe(syncLetterComposerChatFocus)
    syncLetterComposerChatFocus()
    return () => {
      unsub()
      if (useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer') {
        useChatFocusStore.getState().clearChatFocusMode()
      }
      useDraftRefineStore.getState().disconnect()
      useLetterComposerStore.getState().setFocusedTemplateField(null)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  return (
    <div className="letter-composer-view">
      <div className="letter-composer-grid">
        <div className="letter-composer-port letter-composer-port--template">
          <LetterTemplatePort />
        </div>

        <div className="letter-composer-port letter-composer-port--viewer">
          <LetterViewerPort />
        </div>
      </div>
    </div>
  )
}
