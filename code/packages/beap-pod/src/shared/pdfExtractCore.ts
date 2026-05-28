/**
 * PDF text extraction core — shared by the pdf-parser pod role (and host callers in later workstreams).
 *
 * Uses pdfjs-dist + positioned text reconstruction (aligned with host pdf-extractor.ts).
 */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PDF_PARSER_LIMITS = {
  MAX_PDF_BYTES: 50 * 1024 * 1024,
  MAX_PAGES: 500,
  TIMEOUT_MS: 30_000,
} as const;

/** Version tag bound into extracted_text_v1 and pdf-parser HTTP responses. */
export const PDF_EXTRACTOR_VERSION = 'beap-pdf-extract-v1';

export type PdfExtractReasonCode =
  | 'pdf_malformed'
  | 'pdf_encrypted'
  | 'pdf_too_large'
  | 'pdf_timeout';

export type PdfExtractSuccess = {
  ok: true;
  extracted_text: string;
  page_count: number;
  structural_hash: string;
  pages: string[];
};

export type PdfExtractFailure = {
  ok: false;
  reason_code: PdfExtractReasonCode;
  message: string;
};

export type PdfExtractResult = PdfExtractSuccess | PdfExtractFailure;

export interface PdfjsPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
}

export interface PdfjsDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPageLike>;
}

export interface PdfjsLoadingTaskLike {
  promise: Promise<PdfjsDocumentLike>;
}

export interface PdfjsModuleLike {
  getDocument(src: { data: Uint8Array }): PdfjsLoadingTaskLike;
  GlobalWorkerOptions?: { workerSrc: string };
}

export type PdfjsLoader = () => Promise<PdfjsModuleLike>;

let defaultLoader: PdfjsLoader | null = null;

export function resolvePdfjsWorkerSrc(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = join(here, '..', '..', 'node_modules', 'pdfjs-dist');
    return `file://${join(pkgRoot, 'legacy', 'build', 'pdf.worker.mjs')}`;
  } catch {
    return 'pdfjs-dist/legacy/build/pdf.worker.mjs';
  }
}

export async function defaultPdfjsLoader(): Promise<PdfjsModuleLike> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs' as string).catch(() =>
    import('pdfjs-dist' as string),
  )) as PdfjsModuleLike;
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfjsWorkerSrc();
  }
  return pdfjs;
}

export function getDefaultPdfjsLoader(): PdfjsLoader {
  if (!defaultLoader) {
    defaultLoader = defaultPdfjsLoader;
  }
  return defaultLoader;
}

export function setDefaultPdfjsLoaderForTests(loader: PdfjsLoader | null): void {
  defaultLoader = loader;
}

/** Canonical page-joined text for structural_hash (deterministic across host/edge). */
export function canonicalizePagesForHash(pages: string[]): string {
  return pages.map((p) => p.replace(/\r\n?/g, '\n').trim()).join('\n\n');
}

export function computeStructuralHash(pages: string[]): string {
  return createHash('sha256').update(canonicalizePagesForHash(pages), 'utf8').digest('hex');
}

function reconstructPageText(items: unknown[]): string {
  if (items.length === 0) return '';

  let result = '';
  let prevEndX = 0;
  let prevY: number | null = null;

  for (const raw of items) {
    const item = raw as {
      str?: string;
      transform?: number[];
      width?: number;
      hasEOL?: boolean;
    };
    const str = item.str ?? '';
    const transform = item.transform ?? [10, 0, 0, 10, 0, 0];
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const fontSize = Math.abs(transform[3] ?? 0) || Math.abs(transform[0] ?? 0) || 10;
    const itemWidth = item.width ?? 0;

    if (prevY !== null) {
      const dy = Math.abs(y - prevY);
      const gap = x - prevEndX;
      if (item.hasEOL || dy > fontSize * 0.5) {
        result += '\n';
      } else if (gap > fontSize * 0.25) {
        result += ' ';
      }
    }

    result += str;
    prevEndX = x + itemWidth;
    prevY = y;
  }

  return result
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function isPdfHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  );
}

function classifyLoadError(err: unknown): PdfExtractFailure | null {
  const e = err as { name?: string; message?: string };
  const msg = (e?.message ?? String(err)).toLowerCase();
  if (e?.name === 'PasswordException' || msg.includes('password')) {
    return {
      ok: false,
      reason_code: 'pdf_encrypted',
      message: 'PDF is password-protected',
    };
  }
  return null;
}

export interface ExtractPdfFromBufferOptions {
  readonly pdfjsLoader?: PdfjsLoader;
  readonly timeoutMs?: number;
}

/**
 * Extract text from a PDF buffer. Failures return structured reason codes (no throw).
 */
export async function extractPdfFromBuffer(
  buffer: Buffer,
  options?: ExtractPdfFromBufferOptions,
): Promise<PdfExtractResult> {
  if (buffer.length > PDF_PARSER_LIMITS.MAX_PDF_BYTES) {
    return {
      ok: false,
      reason_code: 'pdf_too_large',
      message: `PDF exceeds ${PDF_PARSER_LIMITS.MAX_PDF_BYTES} byte limit`,
    };
  }

  if (!isPdfHeader(buffer)) {
    return {
      ok: false,
      reason_code: 'pdf_malformed',
      message: 'Invalid PDF: missing %PDF header',
    };
  }

  const loader = options?.pdfjsLoader ?? getDefaultPdfjsLoader();
  const timeoutMs = options?.timeoutMs ?? PDF_PARSER_LIMITS.TIMEOUT_MS;

  const work = async (): Promise<PdfExtractResult> => {
    try {
      const pdfjs = await loader();
      let pdf: PdfjsDocumentLike;
      try {
        pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
      } catch (err: unknown) {
        const classified = classifyLoadError(err);
        if (classified) return classified;
        return {
          ok: false,
          reason_code: 'pdf_malformed',
          message: err instanceof Error ? err.message : 'PDF load failed',
        };
      }

      const pageCount = pdf.numPages;
      if (pageCount > PDF_PARSER_LIMITS.MAX_PAGES) {
        return {
          ok: false,
          reason_code: 'pdf_too_large',
          message: `PDF has ${pageCount} pages; limit is ${PDF_PARSER_LIMITS.MAX_PAGES}`,
        };
      }

      const pages: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        try {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(reconstructPageText(content.items));
        } catch {
          pages.push('');
        }
      }

      const extracted_text = pages.join('\n\n');
      if (!extracted_text.trim()) {
        return {
          ok: false,
          reason_code: 'pdf_malformed',
          message: 'No text extracted from PDF text layer',
        };
      }

      return {
        ok: true,
        extracted_text,
        page_count: pageCount,
        structural_hash: computeStructuralHash(pages),
        pages,
      };
    } catch (err: unknown) {
      const classified = classifyLoadError(err);
      if (classified) return classified;
      return {
        ok: false,
        reason_code: 'pdf_malformed',
        message: err instanceof Error ? err.message : 'PDF extraction failed',
      };
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<PdfExtractFailure>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          reason_code: 'pdf_timeout',
          message: `PDF extraction exceeded ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([work(), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
