/**
 * Inline validation message below a wizard field.
 */

import React from 'react'
import { getThemeTokens } from '../../../../shared/ui/lightboxTheme'

export function WizardFieldError({
  id,
  message,
  t,
}: {
  id: string
  message: string | undefined
  t: ReturnType<typeof getThemeTokens>
}) {
  if (!message) return null
  return (
    <p id={id} role="alert" style={{ margin: '4px 0 0', fontSize: 11, color: t.errorText }}>
      {message}
    </p>
  )
}
