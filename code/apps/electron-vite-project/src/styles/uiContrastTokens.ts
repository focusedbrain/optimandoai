/**
 * Standard UI contrast pairs (WCAG AA–oriented: dark text on light pastel, or white on solid).
 * Use for badges, pills, chips — avoid same-hue rgba tints with saturated foregrounds.
 */
export const UI_BADGE = {
  purple: {
    background: '#f3e8ff',
    color: '#4c1d95',
    border: '1px solid #c4b5fd',
  },
  green: {
    background: '#dcfce7',
    color: '#166534',
    border: '1px solid #86efac',
  },
  red: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
  },
  blue: {
    background: '#dbeafe',
    color: '#1e40af',
    border: '1px solid #93c5fd',
  },
  amber: {
    background: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fcd34d',
  },
  gray: {
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
  },
} as const

/** Inactive tabs / toggles — no opacity tricks */
export const UI_TAB = {
  inactive: {
    background: '#f9fafb',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
  },
  active: {
    background: '#7c3aed',
    color: '#ffffff',
    border: '1px solid #7c3aed',
  },
} as const

export const UI_BUTTON = {
  primary: { background: '#7c3aed', color: '#ffffff', border: '1px solid #7c3aed' },
  secondary: { background: '#ffffff', color: '#374151', border: '1px solid #d1d5db' },
  danger: { background: '#dc2626', color: '#ffffff', border: '1px solid #dc2626' },
  /** Lavender outline / soft action */
  purpleSoft: {
    background: '#f3e8ff',
    color: '#4c1d95',
    border: '1px solid #c4b5fd',
  },
} as const

/**
 * BEAP Redirect (historical solid chip) / Sandbox: solid fills + #fff on Sandbox; Redirect UI is icon-only
 * in App.css (`.beap-action-icon--redirect` / `.beap-action-icon--sandbox`, optional `--row`).
 */
export const UI_INBOX_BEAP_ACTION = {
  redirect: {
    background: '#1d4ed8' as const,
    color: '#ffffff' as const,
    border: '1px solid #2563eb' as const,
    hoverBackground: '#2563eb' as const,
    activeBackground: '#1e40af' as const,
  },
  sandbox: {
    background: '#6d28d9' as const,
    color: '#ffffff' as const,
    border: '1px solid #7c3aed' as const,
    hoverBackground: '#7c3aed' as const,
    activeBackground: '#5b21b6' as const,
  },
} as const

/** Message detail BEAP buttons — slightly larger than list row (see App.css). */
export const UI_INBOX_MESSAGE_DETAIL_ACTION = {
  minHeightPx: 34,
  fontSize: '12px',
  borderRadius: '8px',
} as const

/** Inbox list row BEAP chips — compact, same color system as detail (see App.css). */
export const UI_INBOX_BEAP_LIST_ROW = {
  minHeightPx: 26,
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '6px',
  redirect: UI_INBOX_BEAP_ACTION.redirect,
  sandbox: UI_INBOX_BEAP_ACTION.sandbox,
} as const
