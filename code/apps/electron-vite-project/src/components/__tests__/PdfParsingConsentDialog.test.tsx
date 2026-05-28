/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { PdfParsingConsentDialog } from '../PdfParsingConsentDialog.js'
import type { PdfParsingConsentVariant } from '../../lib/pdfParsingConsentDecision.js'

function renderDialog(variant: PdfParsingConsentVariant): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <PdfParsingConsentDialog
        variant={variant}
        filename="report.pdf"
        open
        onProceedOnce={() => {}}
        onDontAskAgainSession={() => {}}
        onSetupServer={() => {}}
        onFinishSetup={() => {}}
        onWaitForServer={() => {}}
        onCancel={() => {}}
      />,
    )
  })
  return container
}

describe('PdfParsingConsentDialog variants', () => {
  const variants: PdfParsingConsentVariant[] = [
    'VARIANT_FREE_TIER',
    'VARIANT_PAID_NO_EDGE',
    'VARIANT_EDGE_UNREACHABLE',
    'VARIANT_EDGE_INCOMPLETE',
    'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED',
  ]

  it.each(variants)('renders title for %s', (variant) => {
    const el = renderDialog(variant)
    expect(el.textContent).toContain('report.pdf')
    if (variant === 'VARIANT_PAID_EDGE_ACTIVE_UNEXPECTED') {
      expect(el.textContent).toContain('Unexpected state')
    } else {
      expect(el.textContent).toContain('Parse this PDF on your computer?')
    }
  })

  it('VARIANT_FREE_TIER shows session opt-out', () => {
    const el = renderDialog('VARIANT_FREE_TIER')
    expect(el.textContent).toContain('Do not ask again this session')
    expect(el.textContent).toContain('Proceed once')
  })

  it('VARIANT_EDGE_UNREACHABLE shows wait for server', () => {
    const el = renderDialog('VARIANT_EDGE_UNREACHABLE')
    expect(el.textContent).toContain('Wait for server')
    expect(el.textContent).not.toContain('Do not ask again this session')
  })
})
