/**
 * IPC core for inbox:requestPdfExtraction — wires consent token → pod extract → re-seal.
 * Handler in ipc.ts delegates to executeInboxRequestPdfExtraction (same contract as IPC).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { randomUUID, createHash, createHmac } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  issuePdfExtractionConsentToken,
  _setPdfConsentSessionSecretForTests,
} from '../email/pdfConsentToken.js'
import {
  executeInboxRequestPdfExtraction,
  issueInboxPdfExtractionConsent,
} from '../email/inboxPdfExtractionRequest.js'
import { computeStructuralHash } from '../email/pdfStructuralHash.js'
import { bindKeyProvider, unbindKeyProvider, sealedQuery } from '../sealed-storage/index.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))

vi.mock('../validatorReadiness.js', () => ({
  ensureValidatorAndSealedStorageReady: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../email/pdf-extractor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../email/pdf-extractor.js')>()
  return {
    ...actual,
    extractPdfTextViaPod: vi.fn(),
  }
})

vi.mock('../ingestion/ingestionModeService.js', () => ({
  getCurrentIngestionMode: vi.fn(async () => ({ mode: 'test_mode' })),
}))

vi.mock('../edge-tier/settings.js', () => ({
  loadEdgeTierSettings: vi.fn(() => ({})),
  isEdgeTierActiveForRouting: vi.fn(() => false),
}))

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')
const EXTRACTED_TEXT = 'Known extracted PDF text for IPC test.'
const STRUCTURAL_HASH = computeStructuralHash([EXTRACTED_TEXT])

function buildValidSealForRowId(canonicalJson: string, rowId: string): { seal: string; seal_input_json: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const sealInputJson = JSON.stringify({ content_sha256: contentSha256, row_id: rowId })
  const seal = createHmac('sha256', TEST_DEK).update(sealInputJson, 'utf8').digest('base64')
  return { seal, seal_input_json: sealInputJson }
}

function makeDb() {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      handshake_id TEXT,
      depackaged_json TEXT,
      ai_analysis_json TEXT,
      embedding_status TEXT DEFAULT 'pending',
      validated_at TEXT,
      validator_version TEXT,
      validation_reason TEXT,
      seal TEXT,
      seal_input_json TEXT,
      seal_key_source TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      filename TEXT,
      content_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      storage_path TEXT,
      storage_encrypted INTEGER DEFAULT 0,
      encryption_key TEXT,
      encryption_iv TEXT,
      encryption_tag TEXT,
      extracted_text TEXT,
      text_extraction_status TEXT,
      text_extraction_error TEXT,
      content_sha256 TEXT,
      extracted_text_sha256 TEXT,
      page_count INTEGER
    );
  `)
  return db
}

function writeMinimalPdfFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-pdf-ipc-'))
  const filePath = path.join(dir, 'sample.pdf')
  fs.writeFileSync(filePath, Buffer.from('%PDF-1.4\n%EOF\n'))
  return filePath
}

describe.skipIf(!Database)('inbox:requestPdfExtraction IPC core', () => {
  let db: any
  let validateMock: ReturnType<typeof vi.fn>
  let extractMock: ReturnType<typeof vi.fn>
  let auditLines: string[]
  let pdfPath: string
  const msgId = 'msg-ipc-pdf'
  const attId = 'att-ipc-pdf'

  const canonicalBase = {
    content_type: 'plain_email',
    transport_sender: 'sender@example.com',
    transport_received_at: '2026-05-25T12:00:00.000Z',
    attachments_canonical: [{ attachment_id: attId, filename: 'doc.pdf' }],
  }

  beforeEach(async () => {
    _setPdfConsentSessionSecretForTests(Buffer.alloc(32, 0xcd))
    db = makeDb()
    bindKeyProvider(() => TEST_DEK)
    pdfPath = writeMinimalPdfFile()
    auditLines = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(' ')
      if (line.includes('pdf_consent_extraction')) auditLines.push(line)
    })

    const canonical = JSON.stringify(canonicalBase)
    db.prepare(
      `INSERT INTO inbox_messages (id, handshake_id, depackaged_json, seal_key_source) VALUES (?, ?, ?, ?)`,
    ).run(msgId, 'hs-1', canonical, 'outer')

    db.prepare(
      `INSERT INTO inbox_attachments (
        id, message_id, filename, content_type, storage_path, storage_encrypted,
        text_extraction_status
      ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
    ).run(attId, msgId, 'doc.pdf', 'application/pdf', pdfPath, 'consent_required')

    const orchMod = await import('../validation/inProcessValidator.js')
    validateMock = vi.spyOn(orchMod.validatorOrchestrator, 'validate') as any

    const pdfMod = await import('../email/pdf-extractor.js')
    extractMock = pdfMod.extractPdfTextViaPod as ReturnType<typeof vi.fn>
    extractMock.mockResolvedValue({
      attachmentId: attId,
      text: EXTRACTED_TEXT,
      pages: [EXTRACTED_TEXT],
      pageCount: 1,
      warnings: [],
      success: true,
      structural_hash: STRUCTURAL_HASH,
      extractor_version: 'beap-pdf-extract-v1',
    })
  })

  afterEach(() => {
    unbindKeyProvider()
    vi.restoreAllMocks()
    db?.close()
    if (pdfPath && fs.existsSync(pdfPath)) {
      try {
        fs.unlinkSync(pdfPath)
        fs.rmdirSync(path.dirname(pdfPath))
      } catch {
        /* ignore */
      }
    }
  })

  function mockValidatorSuccess() {
    validateMock.mockImplementation(async (req: { plaintext_or_encrypted: { content: string } }) => {
      const canonicalJson = req.plaintext_or_encrypted.content
      const { seal, seal_input_json } = buildValidSealForRowId(canonicalJson, msgId)
      return {
        outcome: {
          ok: true,
          sealed: {
            seal,
            seal_input_json,
            canonical_json: canonicalJson,
            validated_at: new Date().toISOString(),
            validator_version: '1.1.0',
          },
        },
      }
    })
  }

  it('happy path: valid consent → extract → re-seal → audit', async () => {
    mockValidatorSuccess()
    const issued = issueInboxPdfExtractionConsent(msgId, attId)
    expect(issued.ok).toBe(true)
    if (!issued.ok) return
    const { token } = issued.data

    const res = await executeInboxRequestPdfExtraction(db, {
      messageId: msgId,
      attachmentId: attId,
      consentSignature: token,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.status).toBe('host_extracted_with_consent')
    expect(res.data.text).toBe(EXTRACTED_TEXT)
    expect(extractMock).toHaveBeenCalledOnce()

    const att = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attId) as Record<string, unknown>
    expect(att.text_extraction_status).toBe('host_extracted_with_consent')
    expect(att.extracted_text).toBe(EXTRACTED_TEXT)
    expect(att.content_sha256).toMatch(/^[0-9a-f]{64}$/)

    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages WHERE id = ?', [msgId], 'depackaged_json')
    expect(rows.length).toBe(1)
    const parent = rows[0] as { seal?: string; depackaged_json?: string }
    expect(parent.seal).toBeTruthy()
    const parsed = JSON.parse(String(parent.depackaged_json))
    const entry = parsed.attachments_canonical.find((a: { attachment_id: string }) => a.attachment_id === attId)
    expect(entry.text_extraction_status).toBe('host_extracted_with_consent')
    expect(entry.pdf_extraction_consent_token_hash).toMatch(/^[0-9a-f]{64}$/)

    expect(auditLines.length).toBeGreaterThan(0)
    const audit = JSON.parse(auditLines.find((l) => l.includes('pdf_consent_extraction')) ?? '{}')
    expect(audit.type).toBe('pdf_consent_extraction')
    expect(audit.result).toBe('success')
    expect(audit.consentTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(audit.ingestionMode).toBe('test_mode')
    expect(audit.edgeTierActive).toBe(false)
    expect(audit.textExtractionStatus).toBe('host_extracted_with_consent')
  })

  it('invalid consent token: rejects without parse or DB change', async () => {
    mockValidatorSuccess()
    const before = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attId) as Record<string, unknown>

    const res = await executeInboxRequestPdfExtraction(db, {
      messageId: msgId,
      attachmentId: attId,
      consentSignature: 'not-a-valid-token',
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('CONSENT_INVALID')
    expect(extractMock).not.toHaveBeenCalled()

    const after = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attId) as Record<string, unknown>
    expect(after.text_extraction_status).toBe(before.text_extraction_status)
    expect(after.extracted_text).toBe(before.extracted_text)
    expect(auditLines.filter((l) => l.includes('"result":"success"'))).toHaveLength(0)
  })

  it('pod 422 / malformed PDF: failed status, no extracted text, seal remains valid', async () => {
    mockValidatorSuccess()
    extractMock.mockResolvedValue({
      attachmentId: attId,
      text: '',
      pages: [],
      pageCount: 0,
      warnings: [],
      success: false,
      error: 'PDF malformed (422)',
    })

    const { token } = issuePdfExtractionConsentToken(msgId, attId)
    const res = await executeInboxRequestPdfExtraction(db, {
      messageId: msgId,
      attachmentId: attId,
      consentSignature: token,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.status).toBe('failed')
    expect(res.data.text).toBe('')

    const att = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attId) as Record<string, unknown>
    expect(att.text_extraction_status).toBe('failed')
    expect(att.extracted_text).toBe('')
    expect(att.text_extraction_error).toContain('422')

    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages WHERE id = ?', [msgId], 'depackaged_json')
    expect(rows.length).toBe(1)
    expect((rows[0] as { seal?: string }).seal).toBeTruthy()
  })
})
