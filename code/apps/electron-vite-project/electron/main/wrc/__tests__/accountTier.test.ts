/**
 * Contract v2.0 §6 account tier, client side (C7).
 *
 * The bearer travels on entry and object reads only — never on the public
 * reads (resolve, directory, head, delegations, rollovers) and never to a
 * publisher-served channel. A `401 account_required` on an entry or its EVP is
 * its own Gate-3 reason with its own copy, not the "not registered" capture
 * error: the code may be perfectly valid.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ url: string; bearer: string | undefined }> = []
vi.mock('../httpsClient', async (importOriginal) => {
  const real = await importOriginal<typeof import('../httpsClient')>()
  return {
    ...real,
    wrcHttpsGet: async (url: string, options: { bearer?: string } = {}) => {
      calls.push({ url, bearer: options.bearer })
      return { ok: true, status: 200, bytes: Buffer.from('{}'), json: {} }
    },
  }
})

import { runWrCodeGatePipeline } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { buildWrcSubmissionView } from '../wrcSubmissionView'
import { createWrcHttpTransport, type WrcTransportResult } from '../wrcTransport'
import { buildPublisherFixture, createFixtureTransport, type FixtureTransportOverrides } from './wrcFixtures'

const NOW = 1_754_650_100
const P_REF = 'PWR7X4K9B2M3C'

beforeEach(() => {
  calls.length = 0
})

describe('the account credential reaches entry and object reads only', () => {
  async function everyRead(accountCredential?: () => Promise<string | null>) {
    const t = createWrcHttpTransport({ registryBaseUrl: 'https://wrc.example', accountCredential })
    await t.resolve('WR7X4K')
    await t.catalogHead('WR7X4K')
    await t.delegations('WR7X4K')
    await t.directoryRecord('WR7X4K')
    await t.operatorRollovers()
    await t.publisherManifest('publisher.example')
    await t.entry('WR7X4K', '9B2M3')
    await t.object('sha256:abc')
    return Object.fromEntries(calls.map((c) => [c.url, c.bearer]))
  }

  it('attaches the bearer to entry and object reads and nowhere else', async () => {
    const sent = await everyRead(async () => 'token-1')
    expect(sent).toEqual({
      'https://wrc.example/v1/resolve/WR7X4K': undefined,
      'https://wrc.example/v1/publishers/WR7X4K/catalog/head': undefined,
      'https://wrc.example/v1/publishers/WR7X4K/delegations': undefined,
      'https://wrc.example/v1/directory/WR7X4K': undefined,
      'https://wrc.example/v1/directory/operator-rollovers': undefined,
      'https://publisher.example/.well-known/wr/manifest': undefined,
      'https://wrc.example/v1/publishers/WR7X4K/entries/9B2M3': 'token-1',
      'https://wrc.example/v1/objects/sha256%3Aabc': 'token-1',
    })
  })

  it.each([
    ['no provider', undefined],
    ['a provider without a token', async () => null],
    ['a provider that throws', async () => {
      throw new Error('token refresh failed')
    }],
  ])('sends no bearer with %s', async (_label, provider) => {
    const sent = await everyRead(provider as (() => Promise<string | null>) | undefined)
    expect(Object.values(sent).every((b) => b === undefined)).toBe(true)
  })
})

describe('a malformed bearer is refused before any request', () => {
  it.each(['', 'two words', 'line\r\nX-Injected: 1', 'ünïcode'])('%j', async (bearer) => {
    const { wrcHttpsGet } = await vi.importActual<typeof import('../httpsClient')>('../httpsClient')
    const r = await wrcHttpsGet('https://wrc.example/v1/objects/x', { bearer })
    expect(r).toMatchObject({ ok: false, code: 'url_rejected', message: 'Malformed bearer credential' })
  })
})

describe('401 account_required is its own Gate-3 reason [contract v2.0 §6]', () => {
  const accountRequired: WrcTransportResult = {
    ok: false,
    code: 'http_status',
    message: 'HTTP 401',
    status: 401,
  }

  async function outcomeWith(overrides: FixtureTransportOverrides) {
    const fx = buildPublisherFixture()
    const transport = createFixtureTransport(fx, overrides)
    const client = new WrcResolutionClient({
      transport,
      store: new WrcResolvedRecordStore(createMemoryPersistence()),
      ingestPublicKey: fx.ingest.pub,
      now: () => NOW,
    })
    const directory = new WrcDirectoryClient({
      transport,
      operator: { kid: fx.operator.kid, pub: fx.operator.pub },
      now: () => NOW,
    })
    return runWrCodeGatePipeline({ raw: P_REF, receiver: { party_id: 'party-1' } }, createWrcGateDeps(client, { directory }))
  }

  it.each([
    ['the entry', { entry: accountRequired }],
    ['its EVP', { object: accountRequired }],
  ] as Array<[string, FixtureTransportOverrides]>)('a 401 on %s refuses with entry_account_required', async (_label, overrides) => {
    const r = await outcomeWith(overrides)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect({ gate: r.gate, reason: r.reason, captureError: r.captureError === true }).toEqual({
      gate: 3,
      reason: 'entry_account_required',
      captureError: false,
    })
    const view = buildWrcSubmissionView(r)
    expect(view).toMatchObject({ kind: 'refusal', tone: 'neutral' })
    expect(view.kind === 'refusal' && view.headline).toMatch(/needs your WR Desk sign-in/)
  })

  it('a 404 on the entry stays the capture error', async () => {
    const r = await outcomeWith({ entry: { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 } })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect({ reason: r.reason, captureError: r.captureError }).toEqual({ reason: 'entry_unknown', captureError: true })
  })
})
