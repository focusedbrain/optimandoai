/**
 * The submission view a WR Code surface renders (`wrcSubmissionView.ts`),
 * built from real pipeline outcomes against the built-in test registry.
 *
 * Pins: an offer carries only verified EVP and namespace material (A2,
 * EVP-first); every refusal has human copy and a tone, never a bare reason
 * code as its headline; statuses reuse the three-layer copy; compromised is a
 * warning; superseded names its successor.
 */
import { describe, expect, it } from 'vitest'
import { runWrCodeGatePipeline, type WrCodeGateRefusal } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryUseLimitStore } from '../useLimitStore'
import { createWrcTestRegistry } from '../wrcTestRegistry'
import { buildWrcSubmissionView, type WrcSubmissionView } from '../wrcSubmissionView'

const NOW = 1_790_000_000
const SSO = 'tester@example.org'

async function viewFor(raw: string): Promise<WrcSubmissionView> {
  const registry = createWrcTestRegistry({ now: () => NOW, ssoEmail: () => SSO })
  const client = new WrcResolutionClient({
    transport: registry.transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: registry.config.ingestPublicKey,
    now: () => NOW,
  })
  const directory = new WrcDirectoryClient({
    transport: registry.transport,
    operator: { kid: registry.config.directoryOperatorKid, pub: registry.config.directoryOperatorPub },
    now: () => NOW,
  })
  const useLimits = createMemoryUseLimitStore()
  registry.seedUseLimits(useLimits)
  const receiver = { ...registry.identity().receiver, sso_email: SSO }
  const outcome = await runWrCodeGatePipeline(
    { raw, receiver },
    createWrcGateDeps(client, { now: () => NOW, directory, useLimits }),
  )
  return buildWrcSubmissionView(outcome)
}

const CODES = createWrcTestRegistry({ now: () => NOW }).codes
const code = (display: string) => CODES.find((c) => c.display === display)!.canonical

describe('offers are EVP-first [A2]', () => {
  it('a published offering renders the verified EVP and the Gate-2 namespace only', async () => {
    const v = await viewFor(code('P-TEST01-10001N'))
    expect(v.kind).toBe('offer')
    if (v.kind !== 'offer') return
    expect(v.class_label).toBe('Publisher offering')
    expect(v.offer).toMatchObject({
      publisher_part: 'TEST01',
      verified_domain: 'publisher-a.test',
      publisher_domain_verified: true,
      entry_local_part: '10001',
      code_display: 'P-TEST01-10001N',
      value_statement: 'Published offering. Built-in test data from Test Publisher A; not a real publisher.',
      self_description: 'Optirando WR Code test registry. Every value here is test data.',
      next_steps: ['Review the test offer'],
      resolution_mode: 'public',
      suspension: null,
    })
  })

  it('every admitted test code becomes an offer with its class label', async () => {
    for (const c of CODES.filter((x) => x.expect.ok)) {
      const v = await viewFor(c.canonical)
      expect(v.kind, c.display).toBe('offer')
    }
    const se = await viewFor(code('SE-TEST01-400001-B'))
    expect(se.kind === 'offer' && [se.class_label, se.offer.resolution_mode]).toEqual([
      'Session sub-handshake',
      'session_bound',
    ])
  })
})

describe('refusals carry human copy and a tone', () => {
  const cases: Array<[string, WrcSubmissionView['kind'], string, string]> = [
    ['P-TEST01-100010', 'refusal', 'input', 'Typing error: the check character does not match. Compare each character.'],
    ['P-TEST09-10001F', 'refusal', 'input', 'This code is not registered. Check it for typing errors.'],
    ['P-TEST01-199992', 'refusal', 'input', 'This code is not registered. Check it for typing errors.'],
    ['P-TEST03-100011', 'refusal', 'status', 'This publisher is currently not offering connections.'],
    ['P-TEST04-10001J', 'refusal', 'status', 'This publisher identifier has been revoked.'],
    ['P-TEST05-10001R', 'refusal', 'status', 'This publisher identifier has been superseded. Successor: TEST01.'],
    ['P-TEST06-100016', 'refusal', 'warning', 'Do not act on this code.'],
    ['P-TEST01-10002K', 'refusal', 'status', 'Suspended by the platform. Reason: test_platform_review.'],
    ['P-TEST01-10003H', 'refusal', 'status', 'Withdrawn by the publisher.'],
    ['P-TEST01-10004Z', 'refusal', 'status', 'Retired by the publisher.'],
    ['SE-TEST01-400002-D', 'refusal', 'status', 'This code has expired. Ask the publisher for a new one.'],
    ['I-TEST01-200002-W', 'refusal', 'neutral', 'This code is addressed to someone else.'],
  ]

  it.each(cases)('%s', async (display, kind, tone, headline) => {
    const v = await viewFor(code(display))
    expect(v.kind).toBe(kind)
    if (v.kind !== 'refusal') return
    expect({ tone: v.tone, headline: v.headline }).toEqual({ tone, headline })
    expect(v.headline).not.toBe(v.reason)
  })

  it('superseded names its successor; compromised keeps its detail and the warning flag', async () => {
    const s = await viewFor(code('P-TEST05-10001R'))
    const c = await viewFor(code('P-TEST06-100016'))
    expect(s.kind === 'refusal' && s.successor_publisher_part).toBe('TEST01')
    expect(c.kind === 'refusal' && [c.unsuppressible_warning, c.details]).toEqual([
      true,
      ['This publisher identifier is marked compromised.'],
    ])
  })
})

describe('refusals the test registry does not produce', () => {
  const refusalOf = (reason: string, detail?: string): WrCodeGateRefusal =>
    ({ ok: false, gate: 2, gateName: 'namespace', reason, detail, captureError: false, gatesPassed: ['syntax'] }) as WrCodeGateRefusal

  it('an unconfigured deployment says so instead of a verification failure', () => {
    const v = buildWrcSubmissionView(
      refusalOf('namespace_unverified', 'directory_not_configured: no namespace directory trust anchor'),
    )
    expect(v).toMatchObject({ tone: 'neutral', headline: 'WR Code verification is not set up in this build.' })
  })

  it('an unmapped reason falls back to neutral copy and keeps the code for the detail line', () => {
    const v = buildWrcSubmissionView(refusalOf('admission_refused', 'nonce_unverifiable'))
    expect(v).toMatchObject({
      kind: 'refusal',
      tone: 'neutral',
      headline: 'This code could not be verified.',
      reason: 'admission_refused',
    })
  })
})
