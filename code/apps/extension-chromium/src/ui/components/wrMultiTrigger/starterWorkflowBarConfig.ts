/**
 * Optional top-bar quick-launch metadata for default / starter workflows.
 * Does not affect project triggers or `fetchTriggerProjects` — desktop only wires `onRun` in App.
 *
 * Rule: if `topBarIcon` is empty or omitted, the workflow does not appear in the header control bar.
 */

export type StarterWorkflowBarDef = {
  /** Stable id — must match App.tsx navigation mapping */
  id: 'reply-letter' | 'email-composer' | 'document-actions' | 'beap-composer'
  title: string
  /** Emoji or short glyph; falsy = hidden from top bar */
  topBarIcon?: string
}

export const STARTER_WORKFLOW_BAR_DEFINITIONS: StarterWorkflowBarDef[] = [
  {
    id: 'reply-letter',
    title: 'Reply to Incoming Letter',
    topBarIcon: '\u{2709}\u{FE0F}',
  },
  {
    id: 'email-composer',
    title: 'Email Composer',
    topBarIcon: '\u{270D}\u{FE0F}',
  },
  {
    id: 'document-actions',
    title: 'Document Actions',
    topBarIcon: '\u{1F4C4}',
  },
  {
    id: 'beap-composer',
    title: 'BEAP Composer',
    topBarIcon: '\u{1F4E6}',
  },
]
