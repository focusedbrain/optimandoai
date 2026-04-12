import { execFile, exec, execSync } from 'node:child_process'
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

/** Cache for {@link getSofficePath} before async {@link detectLibreOffice} completes. */
let cachedGetSofficePath: string | null | undefined = undefined

/**
 * Fast synchronous lookup of `soffice` (Program Files / PATH on Windows, common paths on macOS/Linux).
 * Does not replace full {@link detectLibreOffice} (registry, versioned dirs, etc.).
 */
function findLibreOfficeBinary(): string | null {
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const mainPath = path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe')
    if (fs.existsSync(mainPath)) return mainPath

    const x86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const x86Path = path.join(x86, 'LibreOffice', 'program', 'soffice.exe')
    if (fs.existsSync(x86Path)) return x86Path

    try {
      const result = execSync('where soffice.exe', {
        timeout: 3000,
        stdio: 'pipe',
        encoding: 'utf-8',
        windowsHide: true,
      })
      const found = result.trim().split(/\r?\n/)[0]?.trim()
      if (found && fs.existsSync(found)) return found
    } catch {
      /* not in PATH */
    }
    return null
  }

  if (process.platform === 'darwin') {
    const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    if (fs.existsSync(macPath)) return macPath
    return null
  }

  for (const p of ['/usr/bin/soffice', '/usr/local/bin/soffice', '/snap/bin/soffice']) {
    if (fs.existsSync(p)) return p
  }
  return null
}

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

/** Windows: parse `reg query` output for LibreOffice install dirs and derive `program\\soffice.exe`. */
function collectWindowsRegistrySofficeCandidates(): string[] {
  const out: string[] = []
  if (process.platform !== 'win32') return out
  const queries = [
    'reg query "HKLM\\SOFTWARE\\LibreOffice" /s',
    'reg query "HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice" /s',
  ]
  for (const q of queries) {
    try {
      const buf = execSync(`cmd /c ${q} 2>nul`, {
        encoding: 'utf8',
        timeout: 12_000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
      })
      for (const line of buf.split(/\r?\n/)) {
        const m = line.match(/REG_SZ\s+(.+)/i)
        if (!m) continue
        const val = m[1].trim().replace(/^"+|"+$/g, '')
        if (!/libreoffice/i.test(val)) continue
        const low = val.toLowerCase()
        if (low.endsWith('soffice.exe') && fs.existsSync(val)) {
          out.push(val)
          continue
        }
        const candidate = path.join(val, 'program', 'soffice.exe')
        if (fs.existsSync(candidate)) out.push(candidate)
      }
    } catch {
      /* registry unavailable or query failed */
    }
  }
  return dedupeCandidates(out)
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
  cachedGetSofficePath = resolved
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
      cachedGetSofficePath = persisted
      console.log('[LibreOffice] Using manually configured path:', persisted)
      return persisted
    }
    clearPersistedManualPath()
  }

  const quickBinary = findLibreOfficeBinary()
  if (quickBinary && (await tryAcceptCandidate(quickBinary))) {
    cachedSofficePath = quickBinary
    detectionDone = true
    cachedGetSofficePath = quickBinary
    console.log('[LibreOffice] Found via quick path:', quickBinary)
    return quickBinary
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

    for (const regPath of collectWindowsRegistrySofficeCandidates()) {
      candidates.unshift(regPath)
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
    const home = process.env.HOME || os.homedir()
    if (home) {
      candidates.push(path.join(home, 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'))
    }
  } else {
    try {
      const { stdout } = await execAsync('which soffice')
      const found = stdout.trim()
      if (found) candidates.push(found)
    } catch {
      /* not on PATH */
    }
    candidates.push(
      '/usr/bin/soffice',
      '/usr/local/bin/soffice',
      '/snap/bin/soffice',
      '/usr/lib/libreoffice/program/soffice',
      '/opt/libreoffice/program/soffice',
    )
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
      cachedGetSofficePath = candidate
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
 * Resolves the `soffice` binary synchronously (persisted manual path, then common install locations).
 * After {@link detectLibreOffice} runs, returns the same cached result.
 */
export function getSofficePath(): string | null {
  if (detectionDone) return cachedSofficePath
  if (typeof cachedGetSofficePath === 'string') return cachedGetSofficePath

  const persisted = loadPersistedManualPath()
  if (persisted && fs.existsSync(persisted)) {
    cachedGetSofficePath = persisted
    console.log('[PDF] LibreOffice path:', persisted)
    return persisted
  }

  const q = findLibreOfficeBinary()
  if (q) {
    cachedGetSofficePath = q
    console.log('[PDF] LibreOffice path:', q)
    return q
  }

  console.log('[PDF] LibreOffice path (quick lookup): not found')
  return null
}

/** Shown when `detectLibreOffice()` finds no `soffice` (also thrown from `convertToPdf` / `convertToDocx`). */
export const LIBREOFFICE_MISSING_USER_MESSAGE =
  'LibreOffice is not installed or not found. Install LibreOffice to enable PDF export: https://www.libreoffice.org/download/'

/** Minimum size (bytes) for a plausible PDF; below this is treated as corrupt/empty. */
const MIN_VALID_PDF_BYTES = 200

// Future: optional fallback when LibreOffice is missing — render HTML in a hidden BrowserWindow and
// webContents.printToPDF() (larger change; keep LibreOffice as primary path).

const LIBREOFFICE_CONVERT_TIMEOUT_MS = 30_000

/**
 * Run headless LibreOffice with an isolated user profile so conversion does not block on a
 * running GUI instance or the default profile lock (common on Windows).
 */
async function execLibreOfficeConvert(
  sofficePath: string,
  convertTo: 'pdf' | 'docx',
  inputPath: string,
  outDir: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-lo-'))
  try {
    const profileUrl = 'file:///' + tempProfile.replace(/\\/g, '/')
    const args = [
      `-env:UserInstallation=${profileUrl}`,
      '--headless',
      '--norestore',
      '--nologo',
      '--nofirststartwizard',
      '--convert-to',
      convertTo,
      '--outdir',
      outDir,
      inputPath,
    ]
    const result = await execFileAsync(sofficePath, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8')
    const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr.toString('utf8')
    return { stdout, stderr }
  } finally {
    try {
      fs.rmSync(tempProfile, { recursive: true, force: true })
    } catch {
      /* non-critical */
    }
  }
}

function readPdfHeaderSnippet(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(8)
      const n = fs.readSync(fd, buf, 0, 8, 0)
      return buf.subarray(0, n).toString('latin1')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

/**
 * Convert a document to PDF using LibreOffice headless.
 * Returns the path to the generated PDF.
 */
export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  console.log('[PDF] convertToPdf called:', { inputPath })
  const sofficePath = await detectLibreOffice()
  if (!sofficePath) {
    console.error('[PDF] LibreOffice not detected:', LIBREOFFICE_MISSING_USER_MESSAGE)
    throw new Error(LIBREOFFICE_MISSING_USER_MESSAGE)
  }
  console.log('[PDF] Using soffice:', sofficePath)

  const resolvedIn = path.resolve(inputPath)
  const resolvedOut = path.resolve(outputDir)
  if (!fs.existsSync(resolvedIn)) {
    console.error('[PDF] Input file not found:', resolvedIn)
    throw new Error('Input file not found')
  }
  fs.mkdirSync(resolvedOut, { recursive: true })
  console.log('[PDF] Output dir:', resolvedOut)

  const startTime = Date.now()
  let stdout = ''
  let stderr = ''
  try {
    const result = await execLibreOfficeConvert(
      sofficePath,
      'pdf',
      resolvedIn,
      resolvedOut,
      LIBREOFFICE_CONVERT_TIMEOUT_MS,
    )
    stdout = result.stdout
    stderr = result.stderr
    const elapsed = Date.now() - startTime
    console.log(`[PDF] Conversion took ${elapsed}ms`)
    console.log('[PDF] soffice exit code: 0')
    console.log('[PDF] soffice stdout:', stdout)
    console.log('[PDF] soffice stderr:', stderr)
  } catch (err: unknown) {
    const e = err as Error & { code?: string | number; stdout?: string | Buffer; stderr?: string | Buffer }
    const out = e.stdout != null ? (typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8')) : ''
    const errOut = e.stderr != null ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8')) : ''
    console.error('[PDF] soffice failed:', e.message, 'code:', e.code)
    console.error('[PDF] soffice stdout:', out)
    console.error('[PDF] soffice stderr:', errOut)
    const detail = errOut.trim() || out.trim() || e.message
    throw new Error(`LibreOffice PDF conversion failed: ${detail}`)
  }

  const baseName = path.basename(resolvedIn, path.extname(resolvedIn))
  const expectedPdfPath = path.join(resolvedOut, `${baseName}.pdf`)
  console.log('[PDF] Expected output path:', expectedPdfPath)
  console.log('[PDF] Output file exists:', fs.existsSync(expectedPdfPath))

  if (!fs.existsSync(expectedPdfPath)) {
    console.error('[PDF] Output file not found at:', expectedPdfPath)
    throw new Error(
      `PDF conversion failed — output file not created. Expected: ${expectedPdfPath}. Check LibreOffice installation.`,
    )
  }

  const stats = fs.statSync(expectedPdfPath)
  console.log('[PDF] Output file size:', stats.size, 'bytes')
  if (stats.size < MIN_VALID_PDF_BYTES) {
    console.error('[PDF] Output file is suspiciously small:', stats.size, 'bytes')
    throw new Error(
      `PDF conversion produced an empty file (${stats.size} bytes). The DOCX may be invalid or LibreOffice encountered an error.`,
    )
  }

  const header = readPdfHeaderSnippet(expectedPdfPath)
  if (!header.startsWith('%PDF')) {
    console.error('[PDF] Output file does not start with %PDF header:', JSON.stringify(header))
    throw new Error('PDF conversion produced an empty or corrupt file')
  }

  console.log('[PDF] Conversion successful:', expectedPdfPath, `(${stats.size} bytes)`)
  return expectedPdfPath
}

/**
 * Convert a document to DOCX via headless LibreOffice. Output lives in a new temp directory.
 * Caller should delete the file or entire directory when done.
 */
export async function convertToDocx(inputPath: string): Promise<string> {
  const sofficePath = await detectLibreOffice()
  if (!sofficePath) {
    throw new Error(LIBREOFFICE_MISSING_USER_MESSAGE)
  }

  const resolvedIn = path.resolve(inputPath)
  if (!fs.existsSync(resolvedIn)) {
    throw new Error('Input file not found')
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrdesk-docx-'))

  await execLibreOfficeConvert(
    sofficePath,
    'docx',
    resolvedIn,
    outputDir,
    LIBREOFFICE_CONVERT_TIMEOUT_MS,
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
  cachedGetSofficePath = undefined
}
