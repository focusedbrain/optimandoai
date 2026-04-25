/**
 * Renders pre-extracted link parts as inline text and Open link buttons (no raw anchor elements).
 * Used for Host and Sandbox inboxes; the parent supplies the open / warning flow.
 */

import type { LinkPart } from '../utils/safeLinks'

export interface BeapMessageSafeLinkPartsProps {
  parts: LinkPart[]
  onLinkClick: (url: string) => void
  /** Disambiguate keys when multiple bodies render in one view */
  keyPrefix?: string
  /** Optional: avoid inheriting &lt;pre&gt; default monospace in some panels */
  className?: string
}

export default function BeapMessageSafeLinkParts({
  parts,
  onLinkClick,
  keyPrefix = 'bmslp',
  className,
}: BeapMessageSafeLinkPartsProps) {
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.type === 'text' ? (
          <span key={`${keyPrefix}-t-${i}`}>{part.text}</span>
        ) : (
          <button
            key={`${keyPrefix}-l-${i}`}
            type="button"
            className="msg-safe-link-btn"
            onClick={(e) => {
              e.stopPropagation()
              onLinkClick(part.url!)
            }}
          >
            {part.text}
          </button>
        )
      )}
    </span>
  )
}
