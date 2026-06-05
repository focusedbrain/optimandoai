/**
 * B2.2 (spec 0013 §1, §3.3) — in-guest display-envelope derivation:
 * RFC 2047 encoded-word decode (B/Q, multiple charsets, adjacent-word whitespace
 * collapse), address-list parsing, C4 caps, and degradation-not-quarantine.
 */

import { describe, test, expect } from 'vitest'
import {
  decodeHeaderText,
  buildEnvelopeFromHeaders,
  buildEnvelopeFromFields,
  threadingFromHeaders,
  threadingFromProvider,
  ENVELOPE_CAPS,
} from '../displayEnvelope'

const ewB = (s: string, cs = 'utf-8') => `=?${cs}?B?${Buffer.from(s, 'utf8').toString('base64')}?=`

function headers(map: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]))
}

describe('decodeHeaderText — RFC 2047', () => {
  test('plain text passes through (not degraded)', () => {
    expect(decodeHeaderText('Hello world')).toEqual({ value: 'Hello world', degraded: false })
  })

  test('B (base64) UTF-8 encoded word', () => {
    expect(decodeHeaderText(ewB('Héllo wörld')).value).toBe('Héllo wörld')
  })

  test('Q (quoted-printable) encoded word with _ as space', () => {
    expect(decodeHeaderText('=?utf-8?Q?H=C3=A9llo_world?=').value).toBe('Héllo world')
  })

  test('iso-8859-1 Q decodes high bytes', () => {
    expect(decodeHeaderText('=?iso-8859-1?Q?caf=E9?=').value).toBe('café')
  })

  test('adjacent encoded words: whitespace between them is dropped', () => {
    const raw = `${ewB('Hé')} ${ewB('llo')}`
    expect(decodeHeaderText(raw).value).toBe('Héllo')
  })

  test('mixed literal + encoded word keeps the literal', () => {
    expect(decodeHeaderText(`Re: ${ewB('café')}`).value).toBe('Re: café')
  })

  test('unknown charset → degraded, raw returned (no quarantine)', () => {
    const raw = '=?bogus-charset-xyz?B?AAAA?='
    expect(decodeHeaderText(raw)).toEqual({ value: raw, degraded: true })
  })
})

describe('buildEnvelopeFromHeaders', () => {
  test('decodes subject + parses from/to/cc/date', () => {
    const env = buildEnvelopeFromHeaders(headers({
      Subject: ewB('Tschüss'),
      From: `${ewB('Renée')} <renee@example.com>`,
      To: 'a@x.com, "Bob, Jr" <bob@y.com>',
      Cc: 'c@z.com',
      Date: 'Wed, 03 Jun 2026 10:00:00 +0000',
    }))
    expect(env.subject).toBe('Tschüss')
    expect(env.from).toEqual({ email: 'renee@example.com', name: 'Renée' })
    expect(env.to).toEqual([{ email: 'a@x.com' }, { email: 'bob@y.com', name: 'Bob, Jr' }])
    expect(env.cc).toEqual([{ email: 'c@z.com' }])
    expect(env.date).toBe('2026-06-03T10:00:00.000Z')
    expect(env.degradedFields).toEqual([])
  })

  test('comma inside a quoted display name does not split the address', () => {
    const env = buildEnvelopeFromHeaders(headers({ To: '"Last, First" <lf@x.com>' }))
    expect(env.to).toEqual([{ email: 'lf@x.com', name: 'Last, First' }])
  })

  test('invalid date → degraded, raw kept (message still processed)', () => {
    const env = buildEnvelopeFromHeaders(headers({ Subject: 'x', Date: 'not a date' }))
    expect(env.date).toBe('not a date')
    expect(env.degradedFields).toContain('date')
  })

  test('oversized subject → truncated + degraded', () => {
    const big = 'A'.repeat(ENVELOPE_CAPS.MAX_SUBJECT_LEN + 100)
    const env = buildEnvelopeFromHeaders(headers({ Subject: big }))
    expect(env.subject.length).toBe(ENVELOPE_CAPS.MAX_SUBJECT_LEN)
    expect(env.degradedFields).toContain('subject')
  })

  test('too many recipients → capped + degraded', () => {
    const many = Array.from({ length: ENVELOPE_CAPS.MAX_RECIPIENTS + 5 }, (_, i) => `u${i}@x.com`).join(', ')
    const env = buildEnvelopeFromHeaders(headers({ To: many }))
    expect(env.to.length).toBe(ENVELOPE_CAPS.MAX_RECIPIENTS)
    expect(env.degradedFields).toContain('to')
  })

  test('undecodable subject → degraded, raw kept (not quarantined)', () => {
    const raw = '=?bogus?B?AAAA?='
    const env = buildEnvelopeFromHeaders(headers({ Subject: raw }))
    expect(env.subject).toBe(raw)
    expect(env.degradedFields).toContain('subject')
  })
})

describe('threading hints (in-guest, never RFC 2047 decoded)', () => {
  test('headers: message-id + in-reply-to capped, references split + capped', () => {
    const refs = Array.from({ length: ENVELOPE_CAPS.MAX_REFERENCES + 10 }, (_, i) => `<r${i}@x>`).join(' ')
    const th = threadingFromHeaders(headers({
      'Message-ID': '  <abc@x.com> ',
      'In-Reply-To': '<parent@x.com>',
      References: refs,
    }))
    expect(th.messageId).toBe('<abc@x.com>')
    expect(th.inReplyTo).toBe('<parent@x.com>')
    expect(th.references?.length).toBe(ENVELOPE_CAPS.MAX_REFERENCES)
  })

  test('provider: equals header form for the same Message-ID', () => {
    expect(threadingFromProvider({ messageId: '<abc@x.com>' }).messageId)
      .toBe(threadingFromHeaders(headers({ 'Message-ID': '<abc@x.com>' })).messageId)
  })

  test('absent headers → empty hints (IMAP threads post-depackage on result)', () => {
    expect(threadingFromHeaders(headers({ Subject: 'x' }))).toEqual({ messageId: undefined, inReplyTo: undefined, references: undefined })
  })
})

describe('buildEnvelopeFromFields (provider/Graph)', () => {
  test('already-decoded provider strings normalize identically', () => {
    const env = buildEnvelopeFromFields({
      subject: 'Tschüss',
      from: { name: 'Renée', email: 'renee@example.com' },
      to: [{ email: 'a@x.com' }, { name: 'Bob, Jr', email: 'bob@y.com' }],
      date: '2026-06-03T10:00:00Z',
    })
    expect(env.subject).toBe('Tschüss')
    expect(env.from).toEqual({ email: 'renee@example.com', name: 'Renée' })
    expect(env.to).toEqual([{ email: 'a@x.com' }, { email: 'bob@y.com', name: 'Bob, Jr' }])
    expect(env.date).toBe('2026-06-03T10:00:00.000Z')
    expect(env.degradedFields).toEqual([])
  })
})
