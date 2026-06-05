/**
 * B2.1 (D4.4 / D4.5) — provider-structured-json walker.
 *
 * Equivalence corpus: the SAME logical message expressed as RFC822 and as Outlook
 * Graph JSON must yield equivalent depackage results — same derived text, same
 * extracted packages BYTE-IDENTICAL, same artifact count/types, same failure
 * codes. (Artifact ciphertext + blob_id are intentionally nondeterministic — seal
 * uses a fresh nonce — so we compare structure, not sealed bytes.)
 *
 * Plus D4.5 ambiguous-structure failures (walker-only, no RFC822 analogue).
 *
 * This corpus is also a V4/V5 instrument: live Outlook messages fetched both ways
 * (RFC822 via /$value, structured via Graph JSON) must match here.
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { depackageEmail, depackageEmailStructured, type DepackageEmailResult } from '../emailDepackage'

const PUB = Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')

function eml(headers: string[], parts: string): Buffer {
  return Buffer.from([...headers, '', parts].join('\r\n'), 'utf8')
}
const OUTLOOK = { provider: 'outlook' as const }

const QBEAP_PKG = JSON.stringify({
  header: { encoding: 'qBEAP', handshake_id: 'hs-1' },
  metadata: { created_at: '2026-01-01T00:00:00Z' },
  envelope: { kem_ct: 'AAAA' },
})
const PBEAP_PKG = JSON.stringify({
  header: { encoding: 'pBEAP' },
  metadata: { created_at: '2026-01-01T00:00:00Z' },
  payload: 'eyJzdWJqZWN0IjoiaGkifQ==',
})

/**
 * Salient, deterministic projection used to compare the two input forms.
 * Body text is compared modulo trailing whitespace: MIME multipart segmentation
 * leaves a trailing CRLF on the RFC822 plain part that the Graph `body.content`
 * string lacks; both the renderer and SafeText treat trailing whitespace as
 * insignificant (spec parity is "renderer output unchanged"). Packages, types,
 * and artifact counts are compared exactly.
 */
function project(r: DepackageEmailResult) {
  if (!r.ok) return { ok: false as const, code: r.code }
  // B2.2: the decoded display envelope must be equal across input forms too.
  const base = { ok: true as const, type: r.type, artifactCount: r.artifacts.length, artifactTypes: r.artifacts.map((a) => a.content_type), env: r.displayEnvelope, threading: r.threadingHints }
  const norm = (s: string) => s.replace(/\s+$/, '')
  if (r.type === 'plain') return { ...base, subject: r.safeText.subject, body: norm(r.safeText.body_text), packages: [] as string[] }
  if (r.type === 'mixed') return { ...base, subject: r.safeText.subject, body: norm(r.safeText.body_text), packages: r.packages.map((p) => p.bytesB64) }
  return { ...base, subject: r.carrierSafeText?.subject ?? '', body: norm(r.carrierSafeText?.body_text ?? ''), packages: r.packages.map((p) => p.bytesB64) }
}

function graphJson(obj: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8')
}

interface Pair {
  name: string
  rfc822: Buffer
  graph: Buffer
}

const ewB = (s: string) => `=?utf-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`

const CORPUS: ReadonlyArray<Pair> = [
  {
    name: 'plain text/plain',
    rfc822: eml(['Subject: Hi', 'Content-Type: text/plain; charset=utf-8'], 'Hello plain world'),
    graph: graphJson({ subject: 'Hi', body: { contentType: 'text', content: 'Hello plain world' } }),
  },
  {
    name: 'rich envelope: encoded-word subject + addresses + date (RFC822) vs decoded Graph fields',
    rfc822: eml(
      [
        `Subject: ${ewB('Tschüss café')}`,
        `From: ${ewB('Renée')} <renee@example.com>`,
        'To: a@x.com, "Last, First" <lf@y.com>',
        'Cc: c@z.com',
        'Date: Wed, 03 Jun 2026 10:00:00 +0000',
        'Message-ID: <abc123@example.com>',
        'Content-Type: text/plain; charset=utf-8',
      ],
      'body',
    ),
    graph: graphJson({
      subject: 'Tschüss café',
      from: { emailAddress: { name: 'Renée', address: 'renee@example.com' } },
      toRecipients: [
        { emailAddress: { address: 'a@x.com' } },
        { emailAddress: { name: 'Last, First', address: 'lf@y.com' } },
      ],
      ccRecipients: [{ emailAddress: { address: 'c@z.com' } }],
      receivedDateTime: '2026-06-03T10:00:00Z',
      internetMessageId: '<abc123@example.com>',
      body: { contentType: 'text', content: 'body' },
    }),
  },
  {
    name: 'HTML-only (R1 derivation + sealed HTML artifact)',
    rfc822: eml(['Subject: H', 'Content-Type: text/html; charset=utf-8'], '<h1>Title</h1><p>Hello <a href="https://example.com/x">link</a></p>'),
    graph: graphJson({ subject: 'H', body: { contentType: 'html', content: '<h1>Title</h1><p>Hello <a href="https://example.com/x">link</a></p>' } }),
  },
  {
    name: 'pure carrier (qBEAP as the whole body)',
    rfc822: eml(['Subject: pkg', 'Content-Type: text/plain; charset=utf-8'], QBEAP_PKG),
    graph: graphJson({ subject: 'pkg', body: { contentType: 'text', content: QBEAP_PKG } }),
  },
  {
    name: 'mixed: text body + .beap (pBEAP) attachment',
    rfc822: eml(
      ['Subject: c', 'Content-Type: multipart/mixed; boundary="B2"'],
      [
        '--B2', 'Content-Type: text/plain', '', 'see attached',
        '--B2', 'Content-Type: application/vnd.beap+json; name="msg.beap"', 'Content-Disposition: attachment; filename="msg.beap"', '', PBEAP_PKG,
        '--B2--', '',
      ].join('\r\n'),
    ),
    graph: graphJson({
      subject: 'c',
      body: { contentType: 'text', content: 'see attached' },
      attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'msg.beap', contentType: 'application/vnd.beap+json', contentBytes: Buffer.from(PBEAP_PKG, 'utf8').toString('base64') }],
    }),
  },
  {
    name: 'ambiguous: .beap attachment that is not a valid package',
    rfc822: eml(
      ['Subject: a', 'Content-Type: multipart/mixed; boundary="B4"'],
      [
        '--B4', 'Content-Type: text/plain', '', 'hi',
        '--B4', 'Content-Type: application/x-beap; name="weird.beap"', 'Content-Disposition: attachment; filename="weird.beap"', '', 'not-a-json-package',
        '--B4--', '',
      ].join('\r\n'),
    ),
    graph: graphJson({
      subject: 'a',
      body: { contentType: 'text', content: 'hi' },
      attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'weird.beap', contentType: 'application/x-beap', contentBytes: Buffer.from('not-a-json-package', 'utf8').toString('base64') }],
    }),
  },
]

describe('D4.4 — RFC822 vs Graph-JSON equivalence corpus', () => {
  for (const { name, rfc822, graph } of CORPUS) {
    test(`equivalent results: ${name}`, () => {
      const a = project(depackageEmail(rfc822, PUB))
      const b = project(depackageEmailStructured(graph, PUB, OUTLOOK))
      expect(b).toEqual(a)
    })
  }

  test('corpus covers plain, HTML, pure-carrier, mixed, and a failure', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(5)
  })

  test('mixed packages are byte-identical across forms', () => {
    const pair = CORPUS.find((c) => c.name.startsWith('mixed'))!
    const a = depackageEmail(pair.rfc822, PUB)
    const b = depackageEmailStructured(pair.graph, PUB, OUTLOOK)
    if (!a.ok || a.type !== 'mixed' || !b.ok || b.type !== 'mixed') throw new Error('expected mixed')
    expect(b.packages[0].bytesB64).toBe(a.packages[0].bytesB64)
    expect(Buffer.from(b.packages[0].bytesB64, 'base64').toString('utf8')).toBe(PBEAP_PKG)
  })
})

describe('D4.5 — ambiguous-structure failures (INV-7, fail closed)', () => {
  const cases: ReadonlyArray<{ name: string; input: Buffer | string; code: string; provider?: string }> = [
    { name: 'top-level JSON array', input: '[]', code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'top-level JSON string', input: '"hi"', code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'invalid JSON', input: '{not json', code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'body.content non-string', input: JSON.stringify({ body: { contentType: 'text', content: 123 } }), code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'body.contentType unrecognized', input: JSON.stringify({ body: { contentType: 'rtf', content: 'x' } }), code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'attachments not array', input: JSON.stringify({ attachments: { not: 'array' } }), code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'attachment.contentBytes non-string', input: JSON.stringify({ attachments: [{ contentBytes: 5 }] }), code: 'E_AMBIGUOUS_STRUCTURE' },
    { name: 'unknown provider', input: JSON.stringify({ subject: 'x' }), code: 'E_AMBIGUOUS_STRUCTURE', provider: 'mystery' },
  ]
  for (const { name, input, code, provider } of cases) {
    test(`${name} → ${code}`, () => {
      const r = depackageEmailStructured(input, PUB, { provider: provider ?? 'outlook' })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.code).toBe(code)
    })
  }

  test('oversized structured input fails closed (E_LIMITS_EXCEEDED)', () => {
    const big = JSON.stringify({ subject: 'x', body: { contentType: 'text', content: 'A'.repeat(5000) } })
    const r = depackageEmailStructured(big, PUB, OUTLOOK, { maxInputBytes: 100 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_LIMITS_EXCEEDED')
  })

  test('deeply nested JSON fails closed (E_LIMITS_EXCEEDED)', () => {
    let nested = '{}'
    for (let i = 0; i < 20; i++) nested = `{"a":${nested}}`
    const r = depackageEmailStructured(nested, PUB, OUTLOOK)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('E_LIMITS_EXCEEDED')
  })
})
