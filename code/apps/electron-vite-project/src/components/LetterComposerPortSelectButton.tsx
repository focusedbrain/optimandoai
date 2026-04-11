import { useLetterComposerStore } from '../stores/useLetterComposerStore'

export function PortSelectButton({ port }: { port: 'template' | 'letter' }) {
  const focusedPort = useLetterComposerStore((s) => s.focusedPort)
  const setFocusedPort = useLetterComposerStore((s) => s.setFocusedPort)
  const isSelected = focusedPort === port

  return (
    <button
      type="button"
      className={`port-select-btn${isSelected ? ' port-select-btn--active' : ''}`}
      onClick={() => setFocusedPort(isSelected ? null : port)}
      title={isSelected ? 'Deselect for AI chat' : 'Select for AI chat'}
    >
      {isSelected ? '\u261D Selected' : '\u261D Select for AI'}
    </button>
  )
}
