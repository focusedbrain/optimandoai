import { execFile, exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import * as fs from 'node:fs'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

let cachedSofficePath: string | null = null
let detectionDone = false

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

/**
 * Find soffice on the system. Checks common install locations + PATH.
 * Returns the path to soffice or null if not found.
 */
export async function detectLibreOffice(): Promise<string | null> {
  if (detectionDone) {
    return cachedSofficePath
  }

  const candidates: string[] = []

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('where soffice.exe', { windowsHide: true })
      const found = stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)[0]
      if (found) candidates.push(found)
    } catch {
      /* not on PATH */
    }
    candidates.push(
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
    )
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

  for (const candidate of dedupeCandidates(candidates)) {
    try {
      if (!fs.existsSync(candidate)) continue
      await execFileAsync(candidate, ['--version'], { timeout: 10_000, windowsHide: true })
      cachedSofficePath = candidate
      detectionDone = true
      console.log('[LibreOffice] Found at:', candidate)
      return candidate
    } catch {
      /* candidate doesn't work */
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
 * Reset the cached detection (e.g. after user installs LibreOffice).
 */
export function resetLibreOfficeDetection(): void {
  cachedSofficePath = null
  detectionDone = false
}
