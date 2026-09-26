/**
 * The built-in WR Code test registry (`wrc-test` builds), driven through the
 * real client and all six gates: every listed test code yields its documented
 * outcome, the one-time code is spent exactly once, the data is deterministic,
 * the signed-in SSO domain acts for the own test publisher, and every trust
 * anchor and domain is marked as test material.
 */
import { describe, expect, it } from 'vitest'
import { claimantIdOf, runWrCodeGatePipeline, type WrCodeReceiverIdentity } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryUseLimitStore } from '../useLimitStore'
import { WRC_TEST_KID_PREFIX } from '../wrcTrustAnchors'
import {
  WRC_TEST_OWN_PUBLISHER,
  createWrcTestRegistry,
  type WrcTestCode,
} from '../wrcTestRegistry'

const NOW = 1_790_000_000
const SSO = 'tester@example.org'
const PARTS = ['TEST01', 'TEST02', 'TEST03', 'TEST04', 'TEST05', 'TEST06']

function setup(opts: { registrySso?: string | null; receiverSso?: string | null } = {}) {
  const registrySso = opts.registrySso === undefined ? SSO : opts.registrySso
  const receiverSso = opts.receiverSso === undefined ? registrySso : opts.receiverSso
  const registry = createWrcTestRegistry({ now: () => NOW, ssoEmail: () => registrySso })
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
  const deps = createWrcGateDeps(client, { now: () => NOW, directory, useLimits })
  const receiver: WrCodeReceiverIdentity = {
    ...registry.identity().receiver,
    ...(receiverSso ? { sso_email: receiverSso } : {}),
  }
  return { registry, deps, receiver, useLimits }
}

const CODES: readonly WrcTestCode[] = createWrcTestRegistry({ now: () => NOW }).codes

describe('every listed test code yields its documented outcome [six real gates]', () => {
  it.each(CODES.map((c) => [c.display, c] as const))('%s', async (_display, code) => {
    const { deps, receiver } = setup()
    const r = await runWrCodeGatePipeline({ raw: code.canonical, receiver }, deps)
    if (code.expect.ok) {
      expect(r.ok, r.ok ? '' : `gate ${r.gate}: ${r.reason} (${r.detail ?? ''})`).toBe(true)
      return
    }
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect({ gate: r.gate, reason: r.reason }).toEqual({ gate: code.expect.gate, reason: code.expect.reason })
  })

  it('covers every class and every namespace status', () => {
    const prefixes = new Set(CODES.map((c) => c.display.split('-')[0]))
    expect([...prefixes].sort()).toEqual(['C', 'I', 'P', 'SC', 'SE', 'SP'])
    const reasons = CODES.flatMap((c) => (c.expect.ok ? [] : [c.expect.reason]))
    for (const r of [
      'namespace_inactive',
      'namespace_revoked',
      'namespace_superseded',
      'namespace_compromised',
      'namespace_unknown_identifier',
      'check_failed',
    ]) {
      expect(reasons).toContain(r)
    }
  })

  it('a superseded publisher names its successor; a compromised one carries the warning', async () => {
    const { deps, receiver } = setup()
    const superseded = CODES.find((c) => c.canonical.startsWith('PTEST05'))!
    const compromised = CODES.find((c) => c.canonical.startsWith('PTEST06'))!
    const s = await runWrCodeGatePipeline({ raw: superseded.canonical, receiver }, deps)
    const c = await runWrCodeGatePipeline({ raw: compromised.canonical, receiver }, deps)
    expect(s.ok || s.successorPublisherPart).toBe('TEST01')
    expect(c.ok || c.unsuppressibleWarning).toBe(true)
  })
})

describe('the one-time offering is spent exactly once [XVI.8.4]', () => {
  it('first submission claims, acceptance consumes, a second submission is refused', async () => {
    const { deps, receiver, useLimits } = setup()
    const oneTime = CODES.find((c) => c.canonical.startsWith('PTEST0110005'))!
    const first = await runWrCodeGatePipeline({ raw: oneTime.canonical, receiver, requestInstanceId: 'r1' }, deps)
    expect(first.ok, first.ok ? '' : `${first.reason}`).toBe(true)

    const consumed = useLimits.consume('TEST01', '10005', claimantIdOf(receiver)!, 'r1', NOW)
    expect(consumed).toMatchObject({ ok: true, state: 'consumed' })

    const second = await runWrCodeGatePipeline({ raw: oneTime.canonical, receiver, requestInstanceId: 'r2' }, deps)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect({ gate: second.gate, reason: second.reason }).toEqual({ gate: 3, reason: 'CONSUMED' })
  })
})

describe('the signed-in SSO domain acts for the own test publisher [XVI.6.5]', () => {
  it('the own publisher registers the live SSO domain, with its own DNS proof', async () => {
    const { registry } = setup()
    const rec = await registry.transport.directoryRecord(WRC_TEST_OWN_PUBLISHER)
    expect(rec.ok && (rec.value as { domains: string[] }).domains).toEqual(['publisher-b.test', 'example.org'])
    const txt = await registry.transport.wrTxtRecords('example.org')
    expect(txt.ok && txt.records[0]).toMatch(/^v=wr1; part=TEST02; root=[0-9a-f]{64}$/)
  })

  it('an SSO email the registry did not register is refused at Gate 2', async () => {
    const { deps, receiver } = setup({ registrySso: SSO, receiverSso: 'someone@elsewhere.org' })
    const r = await runWrCodeGatePipeline({ raw: CODES[0]!.canonical, receiver }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect({ gate: r.gate, reason: r.reason }).toEqual({ gate: 2, reason: 'sso_principal_mismatch' })
  })

  it('without a session the C reference still reaches its receiver', async () => {
    const { deps, receiver } = setup({ registrySso: null })
    const c = CODES.find((x) => x.display.startsWith('C-'))!
    const r = await runWrCodeGatePipeline({ raw: c.canonical, receiver }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}`).toBe(true)
  })
})

describe('determinism and containment', () => {
  it('two registries issue identical keys, records and codes', async () => {
    const a = createWrcTestRegistry({ now: () => NOW })
    const b = createWrcTestRegistry({ now: () => NOW })
    expect(a.config).toEqual(b.config)
    expect(a.codes).toEqual(b.codes)
    for (const part of PARTS) {
      expect(await a.transport.directoryRecord(part)).toEqual(await b.transport.directoryRecord(part))
      expect(await a.transport.resolve(part)).toEqual(await b.transport.resolve(part))
    }
  })

  it('every key id is test-prefixed and every registered domain is under .test', async () => {
    const { registry } = setup({ registrySso: null })
    expect(registry.config.directoryOperatorKid.startsWith(WRC_TEST_KID_PREFIX)).toBe(true)
    for (const part of PARTS) {
      const rec = await registry.transport.directoryRecord(part)
      const claim = await registry.transport.resolve(part)
      if (!rec.ok || !claim.ok) throw new Error(`no answer for ${part}`)
      const r = rec.value as { keys: Array<{ kid: string }>; operator_kid: string; publisher_kid: string; domains: string[] }
      const head = (claim.value as { catalog_head: { kid: string } }).catalog_head
      for (const kid of [...r.keys.map((k) => k.kid), r.operator_kid, r.publisher_kid, head.kid]) {
        expect(kid.startsWith(WRC_TEST_KID_PREFIX), kid).toBe(true)
      }
      for (const d of r.domains) expect(d.endsWith('.test'), d).toBe(true)
    }
  })

  it('answers unknown identifiers with the uniform 404 and unknown domains with a DNS failure', async () => {
    const { registry } = setup()
    expect(await registry.transport.directoryRecord('TEST09')).toMatchObject({ ok: false, status: 404 })
    expect(await registry.transport.entry('TEST01', 'NOPE01')).toMatchObject({ ok: false, status: 404 })
    expect(await registry.transport.wrTxtRecords('real-company.com')).toMatchObject({ ok: false, code: 'dns_error' })
  })
})
