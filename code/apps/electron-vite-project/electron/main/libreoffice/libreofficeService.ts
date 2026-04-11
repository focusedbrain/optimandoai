import { execFile, exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { app } from 'electron'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

const MANUAL_PATH_STORE = 'libreoffice-manual-path.json'

let cachedSofficePath: string | null = null
let detectionDone = false

function manualPathStoreFile(): string {
  return path.join(app.getPath('userData'), MANUAL_PATH_STORE)
}

function loadPersistedManualPath(): string | null {
  try {
    const f = manualPathStoreFile()
    if (!fs.existsSync(f)) return null
    const raw = JSON.parse(fs.readFileSync(f, 'utf8')) as { sofficePath?: unknown }
    const p = raw.sofficePath
    return typeof p === 'string' && p.length > 0 ? p : null
  } catch {
    return null
  }
}

function persistManualPath(absolutePath: string): void {
  try {
    fs.writeFileSync(manualPathStoreFile(), JSON.stringify({ sofficePath: absolutePath }, null, 0), 'utf8')
  } catch (e) {
    console.warn('[LibreOffice] Could not persist manual path:', e)
  }
}

function clearPersistedManualPath(): void {
  try {
    const f = manualPathStoreFile()
    if (fs.existsSync(f)) fs.unlinkSync(f)
  } catch {
    /* ignore */
  }
}

function dedupeCandidates(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of paths) {
    if (!p) continue
    const norm = process.platform === 'win32' ? p.toLowerCase() : p
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push(p)
  }
  return out
}

async function tryAcceptCandidate(candidate: string): Promise<boolean> {
  if (!fs.existsSync(candidate)) return false
  try {
    await execFileAsync(candidate, ['--version'], { timeout: 15_000, windowsHide: true })
  } catch (versionErr: unknown) {
    const msg = versionErr instanceof Error ? versionErr.message : String(versionErr)
    console.log(
      `[LibreOffice] ${candidate} exists but --version failed: ${msg}. Accepting anyway.`,
    )
  }
  return true
}

/**
 * Set soffice path from user choice (browse or API). Validates file exists, caches, persists.
 */
export function setManualSofficePath(manualPath: string): { ok: true; path: string } | { ok: false; error: string } {
  const resolved = path.resolve(manualPath)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: 'File not found at the specified path' }
  }
  cachedSofficePath = resolved
  detectionDone = true
  persistManualPath(resolved)
  console.log('[LibreOffice] Manual path set:', resolved)
  return { ok: true, path: resolved }
}

/**
 * Find soffice on the system. Checks persisted manual path, common install locations + PATH.
 * Returns the path to soffice or null if not found.
 */
export async function detectLibreOffice(): Promise<string | null> {
  if (detectionDone) {
    return cachedSofficePath
  }

  const persisted = loadPersistedManualPath()
  if (persisted) {
    if (fs.existsSync(persisted) && (await tryAcceptCandidate(persisted))) {
      cachedSofficePath = persisted
      detectionDone = true
      console.log('[LibreOffice] Using manually configured path:', persisted)
      return persisted
    }
    clearPersistedManualPath()
  }

  const candidates: string[] = []

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('where soffice.exe', { windowsHide: true })
      console.log('[LibreOffice] where soffice.exe →', stdout.trim())
      const lines = stdout.trim().split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) candidates.unshift(trimmed)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log('[LibreOffice] where soffice.exe → not on PATH:', msg)
    }

    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const localAppData = process.env.LOCALAPPDATA || ''
    const userProfile = process.env.USERPROFILE || ''

    for (const base of [programFiles, programFilesX86]) {
      candidates.push(
        path.join(base, 'LibreOffice', 'program', 'soffice.exe'),
        path.join(base, 'LibreOffice 7', 'program', 'soffice.exe'),
        path.join(base, 'LibreOffice 24', 'program', 'soffice.exe'),
        path.join(base, 'LibreOffice 25', 'program', 'soffice.exe'),
      )
      for (let v = 4; v <= 30; v++) {
        candidates.push(path.join(base, `LibreOffice ${v}`, 'program', 'soffice.exe'))
      }
    }

    if (localAppData) {
      candidates.push(
        path.join(localAppData, 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
        path.join(localAppData, 'LibreOffice', 'program', 'soffice.exe'),
      )
    }

    if (userProfile) {
      candidates.push(
        path.join(userProfile, 'scoop', 'apps', 'libreoffice', 'current', 'program', 'soffice.exe'),
      )
    }

    try {
      for (const base of [programFiles, programFilesX86]) {
        if (!fs.existsSync(base)) continue
        const dirs = fs.readdirSync(base).filter((d) => d.toLowerCase().includes('libreoffice'))
        for (const dir of dirs) {
          candidates.push(path.join(base, dir, 'program', 'soffice.exe'))
        }
      }
    } catch {
      /* permission denied or similar */
    }
  } else if (process.platform === 'darwin') {
    try {
      const { stdout } = await execAsync('which soffice')
      const found = stdout.trim()
      if (found) candidates.push(found)
    } catch {
      /* not on PATH */
    }
    candidates.push(
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/usr/local/bin/soffice',
    )
  } else {
    try {
      const { stdout } = await execAsync('which soffice')
      const found = stdout.trim()
      if (found) candidates.push(found)
    } catch {
      /* not on PATH */
    }
    candidates.push('/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/soffice')
  }

  const uniqueCandidates = dedupeCandidates(candidates)

  for (const candidate of uniqueCandidates) {
    const exists = fs.existsSync(candidate)
    console.log(`[LibreOffice] Checking: ${candidate} → ${exists ? 'EXISTS' : 'not found'}`)
  }

  for (const candidate of uniqueCandidates) {
    try {
      if (!(await tryAcceptCandidate(candidate))) continue
      cachedSofficePath = candidate
      detectionDone = true
      console.log('[LibreOffice] Found at:', candidate)
      return candidate
    } catch {
      /* next candidate */
    }
  }

  detectionDone = true
  cachedSofficePath = null
  console.log('[LibreOffice] Not found on this system')
  return null
}

/**
 * Convert a document to PDF using LibreOffice headless.
 * Returns the path to the generated PDF.
 */
export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  const sofficePath = await detectLibreOffice()
  if (!sofficePath) {
    throw new Error('LIBREOFFICE_NOT_FOUND')
  }

  const resolvedIn = path.resolve(inputPath)
  const resolvedOut = path.resolve(outputDir)
  if (!fs.existsSync(resolvedIn)) {
    throw new Error('Input file not found')
  }
  fs.mkdirSync(resolvedOut, { recursive: true })

  await execFileAsync(
    sofficePath,
    ['--headless', '--convert-to', 'pdf', '--outdir', resolvedOut, resolvedIn],
    { timeout: 120_000, windowsHide: true },
  )

  const baseName = path.basename(resolvedIn, path.extname(resolvedIn))
  const pdfPath = path.join(resolvedOut, `${baseName}.pdf`)

  if (!fs.existsSync(pdfPath)) {
    throw new Error('PDF conversion produced no output file')
  }

  return pdfPath
}

/**
 * Convert a document to DOCX via headless LibreOffice. Output lives in a new temp directory.
 * Caller should delete the file or entire directory when done.
 */
export async function convertToDocx(inputPath: string): Promise<string> {
  const sofficePath = await detectLibreOffice()
  if (!sofficePath) {
    throw new Error('LIBREOFFICE_NOT_FOUND')
  }

  const resolvedIn = path.resolve(inputPath)
  if (!fs.existsSync(resolvedIn)) {
    throw new Error('Input file not found')
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-docx-'))

  await execFileAsync(
    sofficePath,
    ['--headless', '--convert-to', 'docx', '--outdir', outputDir, resolvedIn],
    { timeout: 120_000, windowsHide: true },
  )

  const baseName = path.basename(resolvedIn, path.extname(resolvedIn))
  const docxPath = path.join(outputDir, `${baseName}.docx`)

  if (!fs.existsSync(docxPath)) {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    throw new Error('DOCX conversion produced no output')
  }

  return docxPath
}

/**
 * Reset the cached detection (e.g. after user installs LibreOffice). Does not clear saved manual path.
 */
export function resetLibreOfficeDetection(): void {
  cachedSofficePath = null
  detectionDone = false
}
