/**
 * Channel Provenance Record — type, producer, decode, ratchet [IX.3.1, IX.11].
 */
import { describe, test, expect } from 'vitest'
import {
  CHANNEL_PROVENANCE_SCHEME,
  evaluateChannelAuthentication,
  computeChannelPass,
  channelAlertRequired,
  createChannelProvenanceRecord,
  unverifiableChannelProvenanceRecord,
  decodeChannelProvenanceRecord,
  ratchetChannelProvenance,
  channelProvenanceMetadata,
  readChannelProvenanceMetadata,
} from '../src/channelProvenance.js'

const SHA = 'a'.repeat(64)
const AT = '2026-08-07T12:00:00.000Z'

const make = (
  authenticationResults: string[] | undefined,
  fromDomain: string | null = 'example.com',
) =>
  createChannelProvenanceRecord({
    contentSha256: SHA,
    material: { authenticationResults, fromDomain },
    evaluatedAt: AT,
  })

describe('record shape and content binding', () => {
  test('every record carries scheme, producer version, timestamp and content hash', () => {
    const record = make(['mx.example.net; dkim=pass header.d=example.com; dmarc=pass'])
    expect(record.marking_scheme).toBe(CHANNEL_PROVENANCE_SCHEME)
    expect(record.producer_version).toMatch(/^phase1-/)
    expect(record.evaluated_at).toBe(AT)
    expect(record.content_sha256).toBe(SHA)
  })

  test('a malformed content hash is emptied rather than persisted as a binding', () => {
    const record = createChannelProvenanceRecord({
      contentSha256: 'not-a-hash',
      material: {},
      evaluatedAt: AT,
    })
    expect(record.content_sha256).toBe('')
  })

  test('the record carries no raw header material', () => {
    const header =
      'mx.example.net; dkim=pass header.d=example.com header.b=SIGNATUREBYTES; spf=pass smtp.mailfrom=example.com'
    const record = make([header])
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('SIGNATUREBYTES')
    expect(serialized).not.toContain('header.b')
    expect(serialized).not.toContain('mx.example.net')
    expect(serialized).not.toContain('dkim=pass')
    expect(Object.keys(record).sort()).toEqual([
      'authenticated_sender_domain',
      'channel_pass',
      'content_sha256',
      'discovery_record',
      'dkim',
      'dmarc',
      'evaluated_at',
      'marking_scheme',
      'producer_version',
      'spf',
    ])
  })

  test('Discovery Record is not_evaluated until Phase 3, never fabricated', () => {
    expect(make(['mx; dmarc=pass']).discovery_record).toBe('not_evaluated')
    expect(unverifiableChannelProvenanceRecord(SHA, AT).discovery_record).toBe('not_evaluated')
  })
})

describe('evaluation of gateway authentication material', () => {
  test('no material at all is unverifiable, not none', () => {
    const evaluation = evaluateChannelAuthentication({})
    expect(evaluation.spf.verdict).toBe('unverifiable')
    expect(evaluation.dkim.verdict).toBe('unverifiable')
    expect(evaluation.dmarc.verdict).toBe('unverifiable')
    expect(evaluation.authenticated_sender_domain).toBeNull()
  })

  test('a mechanism the gateway did not report is none', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx.example.net; spf=pass smtp.mailfrom=example.com'],
      fromDomain: 'example.com',
    })
    expect(evaluation.spf.verdict).toBe('pass')
    expect(evaluation.dkim.verdict).toBe('none')
    expect(evaluation.dmarc.verdict).toBe('none')
  })

  test.each([
    ['fail', 'fail'],
    ['softfail', 'fail'],
    ['policy', 'fail'],
    ['none', 'none'],
    ['neutral', 'none'],
    ['temperror', 'unverifiable'],
    ['permerror', 'unverifiable'],
    ['something-new', 'unverifiable'],
  ])('dkim=%s maps to %s', (result, verdict) => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: [`mx; dkim=${result} header.d=example.com`],
      fromDomain: 'example.com',
    })
    expect(evaluation.dkim.verdict).toBe(verdict)
    expect(evaluation.dkim.aligned).toBe(false)
  })

  test('a comment cannot smuggle a method=result pair', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx; spf=fail (helpful note: dkim=pass header.d=example.com)'],
      fromDomain: 'example.com',
    })
    expect(evaluation.spf.verdict).toBe('fail')
    expect(evaluation.dkim.verdict).toBe('none')
  })

  test('alignment is strict in Phase 1: a subdomain d= does not align', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx; dkim=pass header.d=mail.example.com'],
      fromDomain: 'example.com',
    })
    expect(evaluation.dkim.verdict).toBe('pass')
    expect(evaluation.dkim.aligned).toBe(false)
    expect(evaluation.authenticated_sender_domain).toBeNull()
  })

  test('a look-alike authenticated domain does not align', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx; dkim=pass header.d=examp1e.com; spf=pass smtp.mailfrom=examp1e.com'],
      fromDomain: 'example.com',
    })
    expect(evaluation.dkim.aligned).toBe(false)
    expect(evaluation.spf.aligned).toBe(false)
    expect(computeChannelPass(evaluation)).toBe(false)
  })

  test('a gateway DMARC pass supplies alignment for the mechanism that passed', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: [
        'mx; dkim=pass header.d=mail.example.com; dmarc=pass header.from=example.com',
      ],
      fromDomain: 'example.com',
    })
    expect(evaluation.dkim.aligned).toBe(true)
    expect(evaluation.dmarc.aligned).toBe(true)
    expect(evaluation.authenticated_sender_domain).toBe('mail.example.com')
  })

  test('a DMARC pass does not rescue a mechanism that itself failed', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx; dkim=fail header.d=example.com; dmarc=pass header.from=example.com'],
      fromDomain: 'example.com',
    })
    expect(evaluation.dkim.aligned).toBe(false)
    expect(computeChannelPass(evaluation)).toBe(false)
  })

  test('the authenticated domain comes from the evaluation, not a display header', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: ['mx; spf=pass smtp.mailfrom=bounce@example.com'],
      fromDomain: 'example.com',
    })
    expect(evaluation.authenticated_sender_domain).toBe('example.com')
    const nothingAuthenticated = evaluateChannelAuthentication({
      authenticationResults: ['mx; spf=fail smtp.mailfrom=example.com'],
      fromDomain: 'example.com',
    })
    expect(nothingAuthenticated.authenticated_sender_domain).toBeNull()
  })

  test('multiple Authentication-Results headers are all read', () => {
    const evaluation = evaluateChannelAuthentication({
      authenticationResults: [
        'relay-a; spf=pass smtp.mailfrom=example.com',
        'relay-b; dkim=pass header.d=example.com',
      ],
      fromDomain: 'example.com',
    })
    expect(evaluation.spf.verdict).toBe('pass')
    expect(evaluation.dkim.verdict).toBe('pass')
  })
})

describe('D5 aggregate', () => {
  test('DKIM aligned-pass alone is enough (SPF-breaking forwarding)', () => {
    const record = make([
      'mx; dkim=pass header.d=example.com; spf=fail smtp.mailfrom=forwarder.example.net',
    ])
    expect(record.dkim).toEqual({ verdict: 'pass', aligned: true })
    expect(record.spf.verdict).toBe('fail')
    expect(record.channel_pass).toBe(true)
  })

  test('SPF aligned-pass alone is enough', () => {
    const record = make(['mx; spf=pass smtp.mailfrom=example.com'])
    expect(record.channel_pass).toBe(true)
  })

  test('an unaligned pass is not a pass', () => {
    const record = make(['mx; spf=pass smtp.mailfrom=elsewhere.example.net'])
    expect(record.spf).toEqual({ verdict: 'pass', aligned: false })
    expect(record.channel_pass).toBe(false)
  })

  test('full failure does not pass', () => {
    expect(make(['mx; dkim=fail; spf=fail; dmarc=fail']).channel_pass).toBe(false)
    expect(make(undefined).channel_pass).toBe(false)
  })

  test('a missing From domain cannot align anything', () => {
    const record = make(['mx; dkim=pass header.d=example.com'], null)
    expect(record.dkim.aligned).toBe(false)
    expect(record.channel_pass).toBe(false)
  })
})

describe('§IX.3.1 rule 8 alert trigger', () => {
  test('fires when DKIM and DMARC are both absent or unverifiable', () => {
    expect(channelAlertRequired(make(undefined))).toBe(true)
    expect(channelAlertRequired(make(['mx; spf=pass smtp.mailfrom=example.com']))).toBe(true)
    expect(channelAlertRequired(make(['mx; dkim=temperror; dmarc=permerror']))).toBe(true)
  })

  test('does not fire when either DKIM or DMARC produced a verdict', () => {
    expect(channelAlertRequired(make(['mx; dkim=fail header.d=example.com']))).toBe(false)
    expect(channelAlertRequired(make(['mx; dmarc=fail header.from=example.com']))).toBe(false)
  })
})

describe('fail-closed decode', () => {
  test('round-trips a well-formed record through JSON', () => {
    const record = make(['mx; dkim=pass header.d=example.com'])
    expect(decodeChannelProvenanceRecord(JSON.stringify(record))).toEqual(record)
    expect(readChannelProvenanceMetadata(JSON.stringify(channelProvenanceMetadata(record)))).toEqual(
      record,
    )
  })

  test.each([
    ['unknown scheme', { ...make(undefined), marking_scheme: 'optirando-cpr/2' }],
    ['missing producer version', { ...make(undefined), producer_version: '' }],
    ['missing timestamp', { ...make(undefined), evaluated_at: '' }],
    ['unknown verdict', { ...make(undefined), dkim: { verdict: 'maybe', aligned: false } }],
    ['non-boolean alignment', { ...make(undefined), dkim: { verdict: 'pass', aligned: 'yes' } }],
    ['unknown discovery state', { ...make(undefined), discovery_record: 'looks_fine' }],
    ['missing mechanism', { ...make(undefined), dmarc: undefined }],
  ])('refuses %s', (_label, malformed) => {
    expect(decodeChannelProvenanceRecord(malformed)).toBeNull()
  })

  test('refuses a forged channel_pass that its own verdicts do not support', () => {
    const forged = { ...make(['mx; dkim=fail; spf=fail']), channel_pass: true }
    expect(decodeChannelProvenanceRecord(forged)).toBeNull()
  })

  test('refuses non-JSON, non-objects, and absent metadata', () => {
    expect(decodeChannelProvenanceRecord('{not json')).toBeNull()
    expect(decodeChannelProvenanceRecord(null)).toBeNull()
    expect(decodeChannelProvenanceRecord(42)).toBeNull()
    expect(readChannelProvenanceMetadata('{}')).toBeNull()
    expect(readChannelProvenanceMetadata(null)).toBeNull()
  })
})

describe('ratchet discipline — friction only increases', () => {
  const passing = make(['mx; dkim=pass header.d=example.com'])
  const failing = make(['mx; dkim=fail header.d=example.com; spf=fail'])

  test('a later failure demotes an earlier pass', () => {
    const merged = ratchetChannelProvenance(passing, failing)
    expect(merged.channel_pass).toBe(false)
    expect(merged.dkim.verdict).toBe('fail')
  })

  test('a later pass never upgrades an earlier failure', () => {
    const merged = ratchetChannelProvenance(failing, passing)
    expect(merged.channel_pass).toBe(false)
    expect(merged.dkim.verdict).toBe('fail')
  })

  test('the content binding of the original record is preserved', () => {
    const other = createChannelProvenanceRecord({
      contentSha256: 'b'.repeat(64),
      material: {},
      evaluatedAt: AT,
    })
    expect(ratchetChannelProvenance(passing, other).content_sha256).toBe(SHA)
  })

  test('a disagreeing authenticated domain collapses to null', () => {
    const otherDomain = createChannelProvenanceRecord({
      contentSha256: SHA,
      material: {
        authenticationResults: ['mx; dkim=pass header.d=other.example'],
        fromDomain: 'other.example',
      },
      evaluatedAt: AT,
    })
    expect(ratchetChannelProvenance(passing, otherDomain).authenticated_sender_domain).toBeNull()
  })

  test('an observed Discovery inconsistency is never argued away', () => {
    const inconsistent = createChannelProvenanceRecord({
      contentSha256: SHA,
      material: {},
      evaluatedAt: AT,
      discoveryRecord: 'present_and_inconsistent',
    })
    const consistent = createChannelProvenanceRecord({
      contentSha256: SHA,
      material: {},
      evaluatedAt: AT,
      discoveryRecord: 'present_and_consistent',
    })
    expect(ratchetChannelProvenance(inconsistent, consistent).discovery_record).toBe(
      'present_and_inconsistent',
    )
    expect(ratchetChannelProvenance(consistent, inconsistent).discovery_record).toBe(
      'present_and_inconsistent',
    )
  })

  test('a first evaluation may fill in not_evaluated', () => {
    const unevaluated = make(undefined)
    const evaluated = createChannelProvenanceRecord({
      contentSha256: SHA,
      material: {},
      evaluatedAt: AT,
      discoveryRecord: 'present_and_consistent',
    })
    expect(ratchetChannelProvenance(unevaluated, evaluated).discovery_record).toBe(
      'present_and_consistent',
    )
  })
})
