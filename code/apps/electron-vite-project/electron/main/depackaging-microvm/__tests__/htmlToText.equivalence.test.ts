/**
 * R1 output-equivalence corpus: the guest HTML→text derivation
 * (`htmlToText.ts:htmlToSafeText`) must be byte-identical to the LIVE path
 * (`email/sanitizer.ts:sanitizeHtmlToText`). This is the drift guard that lets
 * the algorithm be copied into the self-contained guest payload while proving
 * "same derived text as today" (B2 ruling R1).
 *
 * The corpus mirrors the mail kinds named in the build spec Phase 1.1:
 * text-only, HTML-only, multipart-alternative (HTML leg), inline images,
 * nested .eml (the HTML body of an embedded message), plus adversarial cases
 * (scripts, tracking pixels, event handlers, javascript: URLs).
 */

import { describe, test, expect } from 'vitest'
import { htmlToSafeText } from '../htmlToText'
import { sanitizeHtmlToText } from '../../email/sanitizer'

const CORPUS: ReadonlyArray<{ name: string; html: string }> = [
  { name: 'empty', html: '' },
  { name: 'plain wrapped in body', html: '<html><body>Hello world</body></html>' },
  {
    name: 'html-only with headings and paragraphs',
    html: '<h1>Title</h1><p>First paragraph.</p><p>Second &amp; third.</p>',
  },
  {
    name: 'multipart-alternative html leg',
    html: '<div>Dear customer,</div><div>Your order <b>#1234</b> shipped.</div>',
  },
  {
    name: 'links - keep real, drop logo/unsubscribe',
    html: '<a href="https://example.com/order">Track order</a> ' +
      '<a href="https://cdn.example.com/logo.png">logo</a> ' +
      '<a href="https://example.com/unsubscribe">unsubscribe here</a>',
  },
  {
    name: 'inline images + tracking pixel',
    html: '<p>See photo:</p><img src="https://example.com/photo.jpg" width="600">' +
      '<img src="https://track.example.com/open.gif" width="1" height="1">',
  },
  {
    name: 'adversarial - script, style, event handlers, js url',
    html: '<script>alert(1)</script><style>body{color:red}</style>' +
      '<div onclick="steal()">Click</div>' +
      '<a href="javascript:evil()">do not</a>' +
      '<a href="https://ok.example.com">ok link</a>',
  },
  {
    name: 'lists and breaks',
    html: '<ul><li>one</li><li>two</li></ul><br><hr><blockquote>quoted</blockquote>',
  },
  {
    name: 'entities and numeric refs',
    html: '<p>&copy; 2026 &mdash; caf&#233; &#x2764;</p>',
  },
  {
    name: 'nested .eml html body (forwarded message body)',
    html: '<div>---------- Forwarded message ----------</div>' +
      '<div>From: a@example.com</div><p>Original <i>body</i> text with ' +
      '<a href="https://example.com/x">a link</a>.</p>',
  },
  {
    name: 'whitespace collapsing',
    html: '<p>line   with     spaces</p>\n\n\n<p>after blanks</p>',
  },
  {
    name: 'non-string-ish empty after strip',
    html: '<style>x</style>',
  },
]

describe('R1 HTML→text guest/live output equivalence', () => {
  for (const { name, html } of CORPUS) {
    test(`byte-identical: ${name}`, () => {
      expect(htmlToSafeText(html)).toBe(sanitizeHtmlToText(html))
    })
  }

  test('every corpus case is exercised', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10)
  })
})
