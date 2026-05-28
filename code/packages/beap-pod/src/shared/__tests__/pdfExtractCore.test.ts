/**
 * pdfExtractCore — unit tests (mock pdfjs).
 */

import { describe, test, expect, vi, afterEach } from 'vitest';

import {
  PDF_PARSER_LIMITS,
  computeStructuralHash,
  extractPdfFromBuffer,
  setDefaultPdfjsLoaderForTests,
  type PdfjsLoader,
  type PdfjsDocumentLike,
} from '../pdfExtractCore.js';

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'utf8',
);

function mockLoader(doc: PdfjsDocumentLike): PdfjsLoader {
  return async () => ({
    getDocument: () => ({ promise: Promise.resolve(doc) }),
  });
}

describe('pdfExtractCore', () => {
  afterEach(() => {
    setDefaultPdfjsLoaderForTests(null);
  });

  test('rejects missing PDF header', async () => {
    const result = await extractPdfFromBuffer(Buffer.from('not a pdf'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_malformed');
  });

  test('rejects oversized buffer', async () => {
    const big = Buffer.alloc(PDF_PARSER_LIMITS.MAX_PDF_BYTES + 1);
    big[0] = 0x25;
    big[1] = 0x50;
    big[2] = 0x44;
    big[3] = 0x46;
    const result = await extractPdfFromBuffer(big);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_too_large');
  });

  test('extracts text and structural_hash from mock pdfjs', async () => {
    const loader = mockLoader({
      numPages: 2,
      async getPage(n: number) {
        return {
          async getTextContent() {
            return {
              items: [{ str: n === 1 ? 'Hello' : 'World', transform: [10, 0, 0, 10, 0, 0] }],
            };
          },
        };
      },
    });

    const result = await extractPdfFromBuffer(MINIMAL_PDF, { pdfjsLoader: loader });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.page_count).toBe(2);
    expect(result.extracted_text).toContain('Hello');
    expect(result.extracted_text).toContain('World');
    expect(result.structural_hash).toBe(computeStructuralHash(['Hello', 'World']));
  });

  test('password-protected PDF returns pdf_encrypted', async () => {
    const loader: PdfjsLoader = async () => ({
      getDocument: () => ({
        promise: Promise.reject(
          Object.assign(new Error('password required'), { name: 'PasswordException' }),
        ),
      }),
    });
    const result = await extractPdfFromBuffer(MINIMAL_PDF, { pdfjsLoader: loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_encrypted');
  });

  test('too many pages returns pdf_too_large', async () => {
    const loader = mockLoader({
      numPages: PDF_PARSER_LIMITS.MAX_PAGES + 1,
      async getPage() {
        return { async getTextContent() { return { items: [] }; } };
      },
    });
    const result = await extractPdfFromBuffer(MINIMAL_PDF, { pdfjsLoader: loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_too_large');
  });

  test('timeout returns pdf_timeout', async () => {
    const loader: PdfjsLoader = async () => ({
      getDocument: () => ({
        promise: new Promise(() => {
          /* never resolves */
        }),
      }),
    });
    const result = await extractPdfFromBuffer(MINIMAL_PDF, {
      pdfjsLoader: loader,
      timeoutMs: 50,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_timeout');
  });

  test('empty text layer returns pdf_malformed', async () => {
    const loader = mockLoader({
      numPages: 1,
      async getPage() {
        return { async getTextContent() { return { items: [] }; } };
      },
    });
    const result = await extractPdfFromBuffer(MINIMAL_PDF, { pdfjsLoader: loader });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason_code).toBe('pdf_malformed');
  });
});
