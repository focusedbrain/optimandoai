/**
 * Unit tests for Document Vault service and policy enforcement.
 *
 * Acceptance criteria:
 *   1.  Pro+ can import, list, retrieve, and delete documents.
 *   2.  Free tier is blocked from all document operations (fail-closed).
 *   3.  Blocked file extensions are rejected at import.
 *   4.  Filename sanitisation removes path components.
 *   5.  Content addressing: duplicate SHA-256 is deduplicated.
 *   6.  MIME detection works for known extensions.
 *   7.  Unknown extensions → application/octet-stream.
 *   8.  Size limit is enforced.
 */

import { describe, it, expect } from 'vitest'
import {
  sanitiseFilename,
  isBlockedExtension,
  detectMimeType,
} from './documentService'
import {
  canAccessRecordType,
  BLOCKED_EXTENSIONS,
  MAX_DOCUMENT_SIZE,
  SAFE_PREVIEW_MIMES,
} from './types'

// ---------------------------------------------------------------------------
// 1. Filename Sanitisation
// ---------------------------------------------------------------------------
describe('sanitiseFilename', () => {
  it('strips path separators', () => {
    expect(sanitiseFilename('/etc/passwd')).toBe('passwd')
    expect(sanitiseFilename('C:\\Windows\\System32\\evil.bat')).toBe('evil.bat')
    expect(sanitiseFilename('../../../etc/shadow')).toBe('shadow')
  })

  it('collapses whitespace', () => {
    expect(sanitiseFilename('my   document.pdf')).toBe('my document.pdf')
  })

  it('returns generic name for empty strings', () => {
    expect(sanitiseFilename('')).toBe('document')
    expect(sanitiseFilename('.')).toBe('document')
  })

  it('preserves normal filenames', () => {
    expect(sanitiseFilename('report-2025.pdf')).toBe('report-2025.pdf')
    expect(sanitiseFilename('photo.jpg')).toBe('photo.jpg')
  })
})

// ---------------------------------------------------------------------------
// 2. Blocked Extensions
// ---------------------------------------------------------------------------
describe('isBlockedExtension', () => {
  it('blocks executable extensions', () => {
    expect(isBlockedExtension('malware.exe')).toBe(true)
    expect(isBlockedExtension('script.bat')).toBe(true)
    expect(isBlockedExtension('test.sh')).toBe(true)
    expect(isBlockedExtension('code.js')).toBe(true)
    expect(isBlockedExtension('hack.py')).toBe(true)
    expect(isBlockedExtension('payload.ps1')).toBe(true)
  })

  it('blocks case-insensitively', () => {
    expect(isBlockedExtension('Malware.EXE')).toBe(true)
    expect(isBlockedExtension('SCRIPT.BAT')).toBe(true)
  })

  it('allows safe document types', () => {
    expect(isBlockedExtension('report.pdf')).toBe(false)
    expect(isBlockedExtension('photo.jpg')).toBe(false)
    expect(isBlockedExtension('notes.txt')).toBe(false)
    expect(isBlockedExtension('spreadsheet.xlsx')).toBe(false)
    expect(isBlockedExtension('archive.zip')).toBe(false)
  })

  it('allows files with no extension', () => {
    expect(isBlockedExtension('README')).toBe(false)
    expect(isBlockedExtension('Makefile')).toBe(false)
  })

  it('BLOCKED_EXTENSIONS set contains core dangerous types', () => {
    const critical = ['.exe', '.dll', '.bat', '.cmd', '.sh', '.ps1', '.js', '.py', '.rb']
    for (const ext of critical) {
      expect(BLOCKED_EXTENSIONS.has(ext)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. MIME Type Detection
// ---------------------------------------------------------------------------
describe('detectMimeType', () => {
  it('detects common document types', () => {
    expect(detectMimeType('doc.pdf')).toBe('application/pdf')
    expect(detectMimeType('photo.png')).toBe('image/png')
    expect(detectMimeType('image.jpg')).toBe('image/jpeg')
    expect(detectMimeType('file.txt')).toBe('text/plain')
    expect(detectMimeType('data.csv')).toBe('text/csv')
    expect(detectMimeType('archive.zip')).toBe('application/zip')
  })

  it('returns octet-stream for unknown extensions', () => {
    expect(detectMimeType('file.xyz')).toBe('application/octet-stream')
    expect(detectMimeType('data.foo')).toBe('application/octet-stream')
    expect(detectMimeType('noext')).toBe('application/octet-stream')
  })
})

// ---------------------------------------------------------------------------
// 4. Capability Gating (document record type)
// ---------------------------------------------------------------------------
describe('document capability gating', () => {
  it('free tier CANNOT access document type', () => {
    expect(canAccessRecordType('free', 'document', 'read')).toBe(false)
    expect(canAccessRecordType('free', 'document', 'write')).toBe(false)
    expect(canAccessRecordType('free', 'document', 'delete')).toBe(false)
  })

  it('private tier CANNOT access document type', () => {
    expect(canAccessRecordType('private', 'document', 'read')).toBe(false)
    expect(canAccessRecordType('private_lifetime', 'document', 'read')).toBe(false)
  })

  it('pro tier CAN access document type', () => {
    expect(canAccessRecordType('pro', 'document', 'read')).toBe(true)
    expect(canAccessRecordType('pro', 'document', 'write')).toBe(true)
    expect(canAccessRecordType('pro', 'document', 'delete')).toBe(true)
  })

  it('publisher tier CAN access document type', () => {
    expect(canAccessRecordType('publisher', 'document', 'read')).toBe(true)
    expect(canAccessRecordType('publisher', 'document', 'write')).toBe(true)
  })

  it('enterprise tier CAN access document type', () => {
    expect(canAccessRecordType('enterprise', 'document', 'read')).toBe(true)
    expect(canAccessRecordType('enterprise', 'document', 'write')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Size Limit Constant
// ---------------------------------------------------------------------------
describe('MAX_DOCUMENT_SIZE', () => {
  it('is 50 MB', () => {
    expect(MAX_DOCUMENT_SIZE).toBe(50 * 1024 * 1024)
  })
})

// ---------------------------------------------------------------------------
// 6. Policy Invariants (static checks)
// ---------------------------------------------------------------------------
describe('policy invariants', () => {
  it('no executable MIME types in SAFE_PREVIEW_MIMES', () => {
    const dangerousMimes = [
      'application/x-msdownload',
      'application/javascript',
      'text/javascript',
      'application/x-sh',
      'application/x-executable',
      'application/vnd.microsoft.portable-executable',
    ]
    for (const mime of dangerousMimes) {
      expect(SAFE_PREVIEW_MIMES.has(mime)).toBe(false)
    }
  })

  it('BLOCKED_EXTENSIONS includes all common script/exec types', () => {
    const mustBlock = [
      '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.scr',
      '.sh', '.bash', '.ps1',
      '.js', '.mjs', '.ts', '.jsx', '.tsx',
      '.py', '.pyc', '.rb', '.pl', '.php',
      '.jar', '.class',
      '.vbs', '.vbe', '.hta', '.wsf',
      '.lnk', '.reg', '.cpl',
    ]
    for (const ext of mustBlock) {
      expect(BLOCKED_EXTENSIONS.has(ext)).toBe(true)
    }
  })
})
