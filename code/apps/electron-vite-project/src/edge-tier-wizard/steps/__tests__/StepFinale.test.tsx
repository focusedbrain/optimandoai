/**
 * StepFinale component tests (P4.5.9).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { StepFinale } from '../StepFinale.js'
import {
  FINALE_OPEN_EMAIL_ACCOUNTS_LABEL,
  FINALE_TITLE,
} from '../../copy/finaleCopy.js'

describe('StepFinale', () => {
  it('renders title, migration guidance, and action buttons', () => {
    const html = renderToStaticMarkup(
      <StepFinale
        totalReplicas={2}
        onOpenEmailAccounts={() => undefined}
        onLater={() => undefined}
      />,
    )
    expect(html).toContain('wizard-step-finale')
    expect(html).toContain(FINALE_TITLE)
    expect(html).toContain('Your edge pod is currently validating BEAP messages')
    expect(html).toContain('Move to edge')
    expect(html).toContain('2 edge replicas are active')
    expect(html).toContain('wizard-finale-open-email-accounts')
    expect(html).toContain(FINALE_OPEN_EMAIL_ACCOUNTS_LABEL)
    expect(html).toContain('wizard-finale-later')
    expect(html).toContain('do this later')
  })

  it('uses singular replica note for one replica', () => {
    const html = renderToStaticMarkup(
      <StepFinale
        totalReplicas={1}
        onOpenEmailAccounts={() => undefined}
        onLater={() => undefined}
      />,
    )
    expect(html).toContain('One edge replica is active.')
  })
})
