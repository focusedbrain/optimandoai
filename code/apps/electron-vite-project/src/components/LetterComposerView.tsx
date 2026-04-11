import { useEffect } from 'react'
import { useChatFocusStore } from '@ext/stores/chatFocusStore'
import { useLetterComposerStore } from '../stores/useLetterComposerStore'
import { LetterTemplatePort } from './LetterTemplatePort'
import { LetterViewerPort } from './LetterViewerPort'
import './LetterComposerView.css'

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
    const excerpt = (t?.renderedHtml ?? '').slice(0, 12_000)
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
    const text = (page?.text ?? '').trim() || (letter?.fullText ?? '').slice(0, 12000)
    st.setChatFocusMode(
      { mode: 'letter-composer', startedAt },
      {
        letterComposerPort: 'letter',
        letterComposerLetterPageText: text,
      },
    )
  }
}

export function LetterComposerView({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const unsub = useLetterComposerStore.subscribe(syncLetterComposerChatFocus)
    syncLetterComposerChatFocus()
    return () => {
      unsub()
      if (useChatFocusStore.getState().chatFocusMode.mode === 'letter-composer') {
        useChatFocusStore.getState().clearChatFocusMode()
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
