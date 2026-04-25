import { useState, type ReactNode } from 'react'
import type { SandboxCloneUiMeta } from '../lib/inboxMessageSandboxClone'

const EXPANDED_COPY =
  'This message is a sandbox clone. It was copied from the Host orchestrator so links, PDFs, attachments, and original artifacts can be inspected inside the Sandbox environment. The original Host message stays unchanged.'

type Props = {
  meta: SandboxCloneUiMeta
}

function metaRow(label: string, value: string): ReactNode {
  return (
    <div className="sandbox-clone-disclosure__row" key={label}>
      <span className="sandbox-clone-disclosure__k">{label}</span>
      <span className="sandbox-clone-disclosure__v">{value}</span>
    </div>
  )
}

/**
 * Compact, default-collapsed header for sandbox-cloned BEAP inbox rows (detail view only).
 */
export default function SandboxCloneDisclosure({ meta }: Props) {
  const [open, setOpen] = useState(false)
  const hasMeta =
    Boolean(meta.clonedAtLabel) ||
    Boolean(meta.sourceMessageIdShort) ||
    Boolean(meta.sourceOrchestratorLine) ||
    Boolean(meta.targetSandboxName)

  return (
    <div className="sandbox-clone-disclosure" data-expanded={open ? 'true' : 'false'}>
      <button
        type="button"
        className="sandbox-clone-disclosure__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="sandbox-clone-disclosure__title">Sandbox Clone</span>
        <span className="sandbox-clone-disclosure__chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="sandbox-clone-disclosure__body">
          <p className="sandbox-clone-disclosure__prose">{EXPANDED_COPY}</p>
          {hasMeta ? (
            <div className="sandbox-clone-disclosure__meta">
              {meta.clonedAtLabel ? metaRow('Cloned at', meta.clonedAtLabel) : null}
              {meta.sourceMessageIdShort ? metaRow('Source message', meta.sourceMessageIdShort) : null}
              {meta.sourceOrchestratorLine ? metaRow('Source (Host)', meta.sourceOrchestratorLine) : null}
              {meta.targetSandboxName ? metaRow('Target sandbox', meta.targetSandboxName) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
