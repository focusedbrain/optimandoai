/**
 * Thrown when host-side PDF parsing is requested for received (untrusted) content
 * without prior user consent. See docs/pdf-consent-rationale.md (Case B).
 */

export const PDF_CONSENT_REQUIRED_CODE = 'CONSENT_REQUIRED' as const

export class PdfConsentRequiredError extends Error {
  readonly code = PDF_CONSENT_REQUIRED_CODE

  constructor(
    message = 'PDF text extraction requires explicit user consent. Use inbox PDF consent flow or wait for edge-verified text.',
  ) {
    super(message)
    this.name = 'PdfConsentRequiredError'
  }
}

export function isPdfConsentRequiredError(err: unknown): err is PdfConsentRequiredError {
  return err instanceof PdfConsentRequiredError || (err as { code?: string })?.code === PDF_CONSENT_REQUIRED_CODE
}
