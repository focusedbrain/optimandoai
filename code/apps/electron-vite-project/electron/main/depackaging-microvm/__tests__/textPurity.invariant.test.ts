/**
 * INVARIANT 1 — Text-purity (positive construction, not sanitization).
 *
 * Proves the depackaging worker emits safe-text that contains ONLY allowlisted
 * plain-text fields, and that active-content-bearing parts (HTML w/ handlers,
 * attachments) are ABSENT — discarded into opaque blobs, never "stripped".
 */

import { describe, test, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519'
import { depackage } from '../depackagingWorker'
import { SAFE_TEXT_SCHEMA } from '../safeText'

function sandboxPubB64(): string {
  const priv = x25519.utils.randomPrivateKey()
  return Buffer.from(x25519.getPublicKey(priv)).toString('base64')
}

const ACTIVE_HTML =
  '<html><body><img src=x onerror="fetch(\'//evil\')"><script>steal()</script>' +
  '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a></body></html>'

const BENIGN_TEXT = 'Hello, this is the legitimate plain-text body. Numbers: 12345.'

function craftMultipart(): Buffer {
  const boundary = 'BOUND123'
  const eml = [
    'From: stranger@example.com',
    // Subject with C0 control + bidi override + zero-width, plus markup-looking text.
    'Subject: Inv\u0007oice \u202Eevil\u202C \u200Bready <b>now</b>',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    BENIGN_TEXT,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    ACTIVE_HTML,
    `--${boundary}`,
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="payload.exe"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('MZ\x90\x00evil-binary').toString('base64'),
    `--${boundary}--`,
    '',
  ].join('\r\n')
  return Buffer.from(eml, 'utf8')
}

describe('Invariant 1 — text-purity by positive construction', () => {
  const out = depackage(craftMultipart(), sandboxPubB64())

  test('safe-text is the closed schema with EXACTLY the allowlisted keys', () => {
    expect(out.safeText.schema).toBe(SAFE_TEXT_SCHEMA)
    expect(Object.keys(out.safeText).sort()).toEqual(
      ['attachment_refs', 'body_text', 'schema', 'subject'].sort(),
    )
  })

  test('the legitimate plain-text body survives verbatim', () => {
    expect(out.safeText.body_text).toContain('legitimate plain-text body')
  })

  test('active HTML content is ABSENT from safe-text (not sanitized — discarded)', () => {
    const blob = JSON.stringify(out.safeText)
    expect(blob).not.toContain('<script>')
    expect(blob).not.toContain('onerror')
    expect(blob).not.toContain('steal()')
    expect(blob).not.toContain('data:text/html')
    // The whole HTML part never entered text — it became an artifact blob.
    expect(out.safeText.body_text).not.toContain('<b>')
  })

  test('subject is reduced to disciplined plain text (control/bidi/zero-width removed)', () => {
    expect(out.safeText.subject).not.toMatch(/[\u0000-\u001F\u202A-\u202E\u200B-\u200F]/)
    expect(out.safeText.subject).toContain('Invoice')
  })

  test('HTML + attachment leave only as opaque blobs referenced by id', () => {
    // text/html + application/octet-stream → 2 artifacts; text/plain → body.
    expect(out.artifacts.length).toBe(2)
    expect(out.safeText.attachment_refs.length).toBe(2)
    for (const ref of out.safeText.attachment_refs) {
      expect(out.artifacts.some((a) => a.blob_id === ref)).toBe(true)
    }
    // Ciphertext must not echo the plaintext markers.
    const cipherBlob = JSON.stringify(out.artifacts.map((a) => a.blob))
    expect(cipherBlob).not.toContain('<script>')
    expect(cipherBlob).not.toContain('evil-binary')
  })
})
