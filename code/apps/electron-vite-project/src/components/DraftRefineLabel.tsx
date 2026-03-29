import type { ReactNode } from 'react';

/** Pointing-finger before the label when this field is the active AI refinement target (with textarea border cues). */

export function DraftRefineLabel({ children, active }: { children: ReactNode; active: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {active ? (
        <span
          title="AI refinement connected for this field"
          aria-label="AI refinement active"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
          }}
          aria-hidden
        >
          👆
        </span>
      ) : null}

      {children}
    </span>
  );
}
