/**
 * Build item 13 (2C) — CPR as a declared, typed input to local scam analysis.
 *
 * Guards the one-directional layering: the record informs the analysis; the analysis
 * never suppresses, softens, precedes, or replaces the §IX.3.1 rule-8 alert. Source
 * walking backs the prompt-contract assertions so a refactor that re-routes the wiring
 * fails here rather than silently at runtime.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_PROVENANCE_ANALYSIS_PROMPT_SECTION,
  SCAM_WATCHDOG_PROMPT_SECTION,
  buildChannelProvenanceAnalysisBlock,
  buildScamWatchdogUserContext,
  channelProvenanceAnalysisInput,
} from '../scamWatchdog'

const here = dirname(fileURLToPath(import.meta.url))
const emailDir = join(here, '..')

const METADATA = JSON.stringify({
  format: 'beap_message',
  channel_provenance: {
    marking_scheme: 'optirando-cpr/1',
    spf: { verdict: 'fail', aligned: false },
    dkim: { verdict: 'none', aligned: false },
    dmarc: { verdict: 'unverifiable', aligned: false },
    channel_pass: false,
    authenticated_sender_domain: null,
  },
})

describe('CPR → analysis: typed decode', () => {
  it('projects verdicts, aggregate, and authenticated domain from depackaged_metadata', () => {
    expect(channelProvenanceAnalysisInput(METADATA)).toEqual({
      spf: 'fail',
      dkim: 'none',
      dmarc: 'unverifiable',
      channelPass: false,
      authenticatedSenderDomain: null,
    })
  })

  it('fail-closed on absent or malformed records', () => {
    expect(channelProvenanceAnalysisInput(null)).toBeNull()
    expect(channelProvenanceAnalysisInput('not json')).toBeNull()
    expect(channelProvenanceAnalysisInput({ channel_provenance: {} })).toBeNull()
    expect(
      channelProvenanceAnalysisInput({
        channel_provenance: { spf: { verdict: 'maybe' }, dkim: { verdict: 'none' }, dmarc: { verdict: 'none' } },
      }),
    ).toBeNull()
  })

  it('carries no raw evaluation material into the projection', () => {
    const withRaw = JSON.parse(METADATA) as Record<string, unknown>
    ;(withRaw.channel_provenance as Record<string, unknown>).authentication_results = [
      'mx.test; dkim=none',
    ]
    const projected = channelProvenanceAnalysisInput(withRaw)
    expect(projected).not.toBeNull()
    expect(Object.keys(projected!).sort()).toEqual([
      'authenticatedSenderDomain',
      'channelPass',
      'dkim',
      'dmarc',
      'spf',
    ])
  })
})

describe('CPR → analysis: prompt block', () => {
  it('renders the typed verdicts as evidence, not as a verdict of the model', () => {
    const block = buildChannelProvenanceAnalysisBlock(channelProvenanceAnalysisInput(METADATA))
    expect(block).toMatch(/Channel Provenance Record/)
    expect(block).toMatch(/SPF: fail/)
    expect(block).toMatch(/DKIM: none/)
    expect(block).toMatch(/DMARC: unverifiable/)
    expect(block).toMatch(/evidence only/i)
  })

  it('states absence explicitly rather than staying silent', () => {
    const block = buildChannelProvenanceAnalysisBlock(null)
    expect(block).toMatch(/not available/i)
    expect(block).toMatch(/do NOT infer that it was authenticated/i)
  })

  it('is appended to the scam-watchdog user context', () => {
    const ctx = buildScamWatchdogUserContext(
      'see http://1.2.3.4/login',
      channelProvenanceAnalysisInput(METADATA),
    )
    expect(ctx).toMatch(/TEXT ONLY/)
    expect(ctx).toMatch(/Channel Provenance Record/)
    expect(ctx.indexOf('Link strings')).toBeLessThan(ctx.indexOf('Channel Provenance Record'))
  })

  it('performs no network access while building the block', () => {
    const prev = globalThis.fetch
    const spy = () => {
      throw new Error('network access from analysis prompt builder')
    }
    // @ts-expect-error override for assertion
    globalThis.fetch = spy
    try {
      buildScamWatchdogUserContext('http://a.test/x', channelProvenanceAnalysisInput(METADATA))
    } finally {
      globalThis.fetch = prev
    }
  })
})

describe('one-directional layering', () => {
  it('the prompt forbids the analysis from clearing, replacing, or restating the alert', () => {
    const s = CHANNEL_PROVENANCE_ANALYSIS_PROMPT_SECTION
    expect(s).toMatch(/NEVER a finding on its own/i)
    expect(s).toMatch(/NEVER clears, softens, or outweighs/i)
    expect(s).toMatch(/do NOT restate it/i)
    expect(s).toMatch(/do NOT claim to replace it/i)
    expect(SCAM_WATCHDOG_PROMPT_SECTION).toContain(CHANNEL_PROVENANCE_ANALYSIS_PROMPT_SECTION)
  })

  it('the analysis module never imports or references the alert component', () => {
    const src = readFileSync(join(emailDir, 'scamWatchdog.ts'), 'utf8')
    expect(src).not.toMatch(/shared-beap-ui/)
    expect(src).not.toMatch(/ChannelProvenanceAlert/)
    expect(src).not.toMatch(/channelAlertRequired/)
  })

  it('the alert component never reads scam-analysis output', () => {
    const alert = readFileSync(
      join(emailDir, '../../../../../packages/shared-beap-ui/src/ChannelProvenanceAlert.tsx'),
      'utf8',
    )
    expect(alert).not.toMatch(/scam/i)
    expect(alert).not.toMatch(/ai_analysis_json/)
    expect(alert).not.toMatch(/aiClassification/)
  })

  it('both analysis handlers read the CPR from the row and pass it to the prompt builder', () => {
    const ipc = readFileSync(join(emailDir, 'ipc.ts'), 'utf8')
    const selects = ipc.match(
      /SELECT from_address, from_name, subject, body_text, received_at, source_type, handshake_id, depackaged_json, depackaged_metadata, beap_package_json FROM inbox_messages WHERE id = \?/g,
    )
    expect(selects, 'both analyze handlers must SELECT depackaged_metadata').toHaveLength(2)

    const calls = ipc.match(/buildScamWatchdogUserContext\(body, cpr[A-Za-z]+\)/g)
    expect(calls, 'both analyze handlers must pass the CPR into the prompt').toHaveLength(2)
    expect(ipc.match(/channelProvenanceAnalysisInput\(row\.depackaged_metadata\)/g)).toHaveLength(2)

    // The analysis result must not be written back into the alert's source of truth.
    expect(ipc).not.toMatch(/channel_provenance\s*[:=]\s*(parsed|analysis|scam)/)
  })
})
