/**
 * gateway.extractAttachmentText — received PDFs must not parse on host (Case B).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { isPdfConsentRequiredError, PdfConsentRequiredError } from '../pdfConsentRequired.js'

const gatewayPath = join(dirname(fileURLToPath(import.meta.url)), '../gateway.ts')

describe('gateway PDF consent gate', () => {
  const src = readFileSync(gatewayPath, 'utf8')
  const fnStart = src.indexOf('async extractAttachmentText(')
  expect(fnStart).toBeGreaterThan(-1)
  const fnEnd = src.indexOf('async sendReply(', fnStart)
  const body = src.slice(fnStart, fnEnd)

  it('throws PdfConsentRequiredError on IMAP and connected-provider PDF paths', () => {
    expect((body.match(/throw new PdfConsentRequiredError\(\)/g) ?? []).length).toBe(2)
    expect(body).not.toMatch(/extractPdfText\(/)
    expect(body).toContain('docs/pdf-consent-rationale.md')
  })

  it('maps PdfConsentRequiredError to CONSENT_REQUIRED for IPC callers', () => {
    const err = new PdfConsentRequiredError()
    expect(isPdfConsentRequiredError(err)).toBe(true)
    expect(err.code).toBe('CONSENT_REQUIRED')
  })
})
