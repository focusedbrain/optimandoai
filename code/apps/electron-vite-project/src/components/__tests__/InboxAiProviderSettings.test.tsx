/**
 * InboxAiProviderSettings — P2.6 UI component tests.
 *
 * Uses renderToStaticMarkup (no jsdom) following the established pattern.
 * Tests use InboxAiProviderSettingsForm (pure, no IPC loading state) for
 * structural assertions; InboxAiProviderSettings wrapper is tested for the
 * loading-state path only.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  InboxAiProviderSettingsForm,
  InboxAiProviderSettings,
  AI_PROVIDER_PRIVACY_DISCLAIMER,
} from '../InboxAiProviderSettings'

// ── InboxAiProviderSettingsForm ───────────────────────────────────────────────

describe('InboxAiProviderSettingsForm', () => {
  it('renders all three provider radio options', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    expect(html).toContain('Default')
    expect(html).toContain('Local Ollama')
    expect(html).toContain('Cloud')
    expect(html).toContain('provider-radio-default')
    expect(html).toContain('provider-radio-local_ollama')
    expect(html).toContain('provider-radio-cloud')
  })

  it('renders the privacy disclaimer verbatim', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    expect(html).toContain(AI_PROVIDER_PRIVACY_DISCLAIMER)
    expect(html).toContain('ai-provider-privacy-disclaimer')
  })

  it('renders the Save button', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    expect(html).toContain('save-provider-settings')
    expect(html).toContain('Save')
  })

  it('renders ai-provider-settings wrapper', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    expect(html).toContain('ai-provider-settings')
  })

  it('defaults to "default" provider selected', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    // The default radio has checked=true in the initial state.
    expect(html).toContain('provider-radio-default')
    // Cloud sub-fields should NOT be visible with default selected.
    expect(html).not.toContain('cloud-sub-fields')
  })

  it('does not show cloud sub-fields when kind is local_ollama', () => {
    const html = renderToStaticMarkup(
      <InboxAiProviderSettingsForm initialSetting={{ kind: 'local_ollama' }} />,
    )
    expect(html).not.toContain('cloud-sub-fields')
  })

  it('shows cloud sub-fields when initialSetting is cloud', () => {
    const html = renderToStaticMarkup(
      <InboxAiProviderSettingsForm initialSetting={{ kind: 'cloud', model: 'gpt-4o' }} />,
    )
    expect(html).toContain('cloud-sub-fields')
    expect(html).toContain('cloud-model-input')
    expect(html).toContain('cloud-endpoint-input')
  })

  it('includes a Learn more link to docs', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettingsForm />)
    expect(html).toContain('Learn more')
    expect(html).toContain('docs.optimando.ai')
  })

  it('mentions Backend Configuration for API keys', () => {
    const html = renderToStaticMarkup(
      <InboxAiProviderSettingsForm initialSetting={{ kind: 'cloud' }} />,
    )
    expect(html).toContain('Backend Configuration')
  })
})

// ── InboxAiProviderSettings (IPC wrapper) ─────────────────────────────────────

describe('InboxAiProviderSettings', () => {
  it('renders loading state during initial SSR (before IPC resolves)', () => {
    const html = renderToStaticMarkup(<InboxAiProviderSettings />)
    expect(html).toContain('Loading settings')
  })
})

// ── AI_PROVIDER_PRIVACY_DISCLAIMER constant ───────────────────────────────────

describe('AI_PROVIDER_PRIVACY_DISCLAIMER', () => {
  it('mentions cloud data transfer', () => {
    expect(AI_PROVIDER_PRIVACY_DISCLAIMER).toContain('Cloud analysis sends email content')
  })

  it('mentions local analysis privacy', () => {
    expect(AI_PROVIDER_PRIVACY_DISCLAIMER).toContain('runs entirely on your machine')
  })

  it('mentions hardware dependency', () => {
    expect(AI_PROVIDER_PRIVACY_DISCLAIMER).toContain('hardware and model')
  })
})
