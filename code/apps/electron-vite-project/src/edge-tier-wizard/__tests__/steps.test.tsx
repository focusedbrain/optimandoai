/**
 * Wizard step component tests (P4.5).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { StepAuthenticate } from '../steps/StepAuthenticate.js'
import { StepProvideVm } from '../steps/StepProvideVm.js'
import { StepReplicaCount } from '../steps/StepReplicaCount.js'
import { StepVerifyAndSwitch } from '../steps/StepVerifyAndSwitch.js'
import { LiveLogPanel } from '../LiveLogPanel.js'
import { STEP2_VM_HELP, STEP4_REPLICA_HELP } from '../copy.js'

describe('StepAuthenticate', () => {
  it('renders sign-in prompt', () => {
    const html = renderToStaticMarkup(
      <StepAuthenticate
        loading={false}
        error={null}
        onAuthenticate={() => undefined}
        onCancelWizard={() => undefined}
      />,
    )
    expect(html).toContain('wizard-step-authenticate')
    expect(html).toContain('paid subscription')
  })
})

describe('StepProvideVm', () => {
  it('renders form fields and help text', () => {
    const html = renderToStaticMarkup(
      <StepProvideVm
        replicaIndex={0}
        totalReplicas={1}
        error={null}
        loading={false}
        onSubmit={() => undefined}
        onCancelWizard={() => undefined}
      />,
    )
    expect(html).toContain('wizard-step-provide-vm')
    expect(html).toContain('wizard-vm-host')
    expect(html).toContain('wizard-step2-help')
    expect(html).toContain('We don')
    expect(html).toContain('recommend a host')
    expect(html).not.toContain('providers dropdown')
  })
})

describe('StepReplicaCount', () => {
  it('renders three replica options and strategy help', () => {
    const html = renderToStaticMarkup(
      <StepReplicaCount
        value={2}
        error={null}
        loading={false}
        onChange={() => undefined}
        onSubmit={() => undefined}
        onCancelWizard={() => undefined}
      />,
    )
    expect(html).toContain('wizard-step-replica-count')
    expect(html).toContain('wizard-replica-1')
    expect(html).toContain('wizard-replica-2')
    expect(html).toContain('wizard-replica-3')
    expect(html).toContain(STEP4_REPLICA_HELP)
  })
})

describe('StepVerifyAndSwitch', () => {
  it('requires confirmation before verify button', () => {
    const html = renderToStaticMarkup(
      <StepVerifyAndSwitch
        loading={false}
        error={null}
        verified={null}
        confirmed={false}
        onConfirmUnderstand={() => undefined}
        onVerify={() => undefined}
        onCancelWizard={() => undefined}
      />,
    )
    expect(html).toContain('wizard-verify-confirm-checkbox')
    expect(html).toContain('disabled')
  })
})

describe('LiveLogPanel', () => {
  it('groups stage events', () => {
    const html = renderToStaticMarkup(
      <LiveLogPanel
        events={[
          { kind: 'stage', message: 'Installing…', stage_name: 'install' },
          { kind: 'log', message: 'Fetched packages', stage_name: 'install' },
        ]}
      />,
    )
    expect(html).toContain('wizard-live-log')
    expect(html).toContain('install')
    expect(html).toContain('Fetched packages')
  })
})
