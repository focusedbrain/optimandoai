/**
 * Close during deploy confirmation + wizard entry gate (A2, A5 UI).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { WizardEntryGate } from '../WizardEntryGate.js'

describe('Wizard close confirmation copy', () => {
  it('names deployment cancellation consequence', () => {
    const html = renderToStaticMarkup(
      <div data-testid="wizard-close-confirm">
        <h2>Cancel deployment and close?</h2>
        <p>A deployment is in progress. Cancel deployment and close?</p>
        <button data-testid="wizard-close-confirm-abort">Cancel deployment &amp; close</button>
        <button data-testid="wizard-close-confirm-keep-open">Keep wizard open</button>
      </div>,
    )
    expect(html).toContain('Cancel deployment and close?')
    expect(html).toContain('wizard-close-confirm-abort')
  })
})

describe('WizardEntryGate setup in progress', () => {
  it('offers resume and start over', () => {
    const html = renderToStaticMarkup(
      <WizardEntryGate
        configurationState="setup_in_progress"
        primaryHost="203.0.113.10"
        confirmStartOver={false}
        confirmReconfigure={false}
        busy={false}
        onResumeSetup={() => undefined}
        onStartOverRequest={() => undefined}
        onStartOverConfirm={() => undefined}
        onStartOverCancel={() => undefined}
        onAddReplica={() => undefined}
        onReconfigureRequest={() => undefined}
        onReconfigureConfirm={() => undefined}
        onReconfigureCancel={() => undefined}
        onCancel={() => undefined}
      />,
    )
    expect(html).toContain('Resume setup')
    expect(html).toContain('Start over')
  })
})
