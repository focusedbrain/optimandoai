/**
 * Shared layout / input styles for custom mode wizard steps.
 */

import type React from 'react'
import { getThemeTokens, inputStyle } from '../../../shared/ui/lightboxTheme'

export function wizardFieldColumnStyle(): React.CSSProperties {
  return { display: 'flex', flexDirection: 'column', gap: 14 }
}

export function wizardTextareaStyle(t: ReturnType<typeof getThemeTokens>): React.CSSProperties {
  return {
    ...inputStyle(t),
    minHeight: 88,
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    lineHeight: 1.45,
  }
}

export function wizardReviewRowStyle(t: ReturnType<typeof getThemeTokens>): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 38%) 1fr',
    gap: '8px 12px',
    fontSize: 12,
    alignItems: 'start',
    padding: '6px 0',
    borderBottom: `1px solid ${t.border}`,
  }
}

export function inputStyleWithError(
  base: React.CSSProperties,
  t: ReturnType<typeof getThemeTokens>,
  error: string | undefined,
): React.CSSProperties {
  if (!error) return base
  return {
    ...base,
    borderColor: t.error,
    boxShadow: `0 0 0 1px ${t.error}40`,
  }
}
