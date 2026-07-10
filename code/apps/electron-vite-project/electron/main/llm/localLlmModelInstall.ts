import fs from 'fs'
import path from 'path'
import { getLocalLlmModelsDirectory } from './localLlmPaths'
import type { DownloadProgress } from './types'
import { assertHttpsHuggingFaceDownloadUrl } from './huggingFaceModelDownloadAllowlist'
import {
  assertGgufMagicHeader,
  computeFileSha256Hex,
  readSha256Sidecar,
  removeSha256Sidecar,
  writeSha256Sidecar,
} from './ggufFileUtils'

export type ModelInstallResult = {
  modelId: string
  fileName: string
  destPath: string
  sha256: string
  sizeBytes: number
}

function modelIdFromGgufFilename(fileName: string): string {
  return fileName.replace(/\.gguf$/i, '')
}

function destPathForFileName(fileName: string): string {
  const safe = path.basename(fileName)
  if (!safe.toLowerCase().endsWith('.gguf')) {
    throw new Error('Destination file must have a .gguf extension')
  }
  return path.join(getLocalLlmModelsDirectory(), safe)
}

function ensureModelsDir(): string {
  const dir = getLocalLlmModelsDirectory()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function finalizeGgufImport(
  sourcePath: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<ModelInstallResult> {
  assertGgufMagicHeader(sourcePath)
  onProgress?.({
    modelId: modelIdFromGgufFilename(path.basename(destPath)),
    status: 'computing_sha256',
    progress: 95,
  })
  const sha256 = await computeFileSha256Hex(sourcePath)
  fs.copyFileSync(sourcePath, destPath)
  await writeSha256Sidecar(destPath, sha256)
  const st = fs.statSync(destPath)
  const fileName = path.basename(destPath)
  const modelId = modelIdFromGgufFilename(fileName)
  onProgress?.({ modelId, status: 'complete', progress: 100, digest: sha256 })
  return { modelId, fileName, destPath, sha256, sizeBytes: st.size }
}

export async function importGgufFromUserPath(
  sourcePath: string,
  opts?: { overwrite?: boolean; onProgress?: (p: DownloadProgress) => void },
): Promise<ModelInstallResult> {
  const src = path.resolve(sourcePath.trim())
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error('Selected file does not exist')
  }
  ensureModelsDir()
  const fileName = path.basename(src)
  const destPath = destPathForFileName(fileName)
  const modelId = modelIdFromGgufFilename(fileName)
  opts?.onProgress?.({ modelId, status: 'validating', progress: 10 })
  assertGgufMagicHeader(src)
  if (fs.existsSync(destPath) && !opts?.overwrite) {
    const err = new Error('MODEL_EXISTS') as Error & { code?: string; destPath?: string; modelId?: string }
    err.code = 'MODEL_EXISTS'
    err.destPath = destPath
    err.modelId = modelId
    throw err
  }
  opts?.onProgress?.({ modelId, status: 'copying', progress: 40 })
  return finalizeGgufImport(src, destPath, opts?.onProgress)
}

/**
 * Download hardening (stall detection + Range resume + auto-retry).
 *
 * The partial download is written to `<name>.gguf.part` inside the models directory — never as
 * `.gguf`, so `scanGgufModelsOnDisk` (which only matches `*.gguf`) can never see a partial file
 * as an installed model. A `<name>.gguf.part.meta` sidecar records the ORIGINAL allowlisted URL
 * and the expected total size so a later resume can validate it is continuing the same download.
 * Redirect targets (HF `/resolve/` → signed, expiring CDN URLs) are never persisted; every
 * attempt re-fetches from the original allowlisted URL.
 */

/** Abort the attempt if no bytes arrive for this long. No total-duration timeout (huge files on slow links are legitimate). */
const DOWNLOAD_STALL_TIMEOUT_MS = 45_000
/** Automatic retry backoff after a stall/network error — 3 retries, 4 attempts total. */
const DOWNLOAD_RETRY_BACKOFF_MS = [5_000, 15_000, 45_000] as const

type PartMeta = { url: string; totalBytes: number }

function partPathFor(destPath: string): string {
  return `${destPath}.part`
}

function partMetaPathFor(destPath: string): string {
  return `${partPathFor(destPath)}.meta`
}

function readPartMeta(metaPath: string): PartMeta | null {
  try {
    if (!fs.existsSync(metaPath)) return null
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<PartMeta>
    if (typeof raw.url !== 'string' || typeof raw.totalBytes !== 'number') return null
    return { url: raw.url, totalBytes: raw.totalBytes }
  } catch {
    return null
  }
}

function discardPart(partPath: string, metaPath: string): void {
  try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch { /* best effort */ }
  try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath) } catch { /* best effort */ }
}

/**
 * A NEW download for URL X removes `.part`/`.part.meta` files belonging to OTHER URLs.
 * Cancel/stall never cleans up — the `.part` stays so a later retry can resume.
 */
function cleanupForeignPartFiles(modelsDir: string, currentUrl: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(modelsDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.gguf.part')) continue
    const partPath = path.join(modelsDir, e.name)
    const metaPath = `${partPath}.meta`
    const meta = readPartMeta(metaPath)
    if (!meta || meta.url !== currentUrl) {
      discardPart(partPath, metaPath)
    }
  }
}

/** `Content-Range: bytes <start>-<end>/<total>` → total, or 0 when unparseable. */
function totalFromContentRange(headerValue: string | null): number {
  const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(headerValue ?? '')
  return m ? parseInt(m[1]!, 10) : 0
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Download cancelled'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Download cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class DownloadStalledError extends Error {
  constructor() {
    super(`Download stalled: no data received for ${Math.round(DOWNLOAD_STALL_TIMEOUT_MS / 1000)}s`)
    this.name = 'DownloadStalledError'
  }
}

/**
 * One download attempt. Resumes an existing `.part` via `Range` when possible; appends on 206,
 * restarts from scratch on 200 (server ignored the Range). Progress-based stall detection:
 * abort when no bytes arrive for {@link DOWNLOAD_STALL_TIMEOUT_MS} — slow-but-moving is fine.
 */
async function attemptRangeDownload(input: {
  url: URL
  partPath: string
  metaPath: string
  modelId: string
  stallTimeoutMs: number
  onProgress?: (p: DownloadProgress) => void
  userSignal?: AbortSignal
}): Promise<void> {
  const { url, partPath, metaPath, modelId, stallTimeoutMs, onProgress, userSignal } = input

  // Validate a pre-existing .part before attempting to continue it.
  let offset = 0
  if (fs.existsSync(partPath)) {
    const meta = readPartMeta(metaPath)
    if (!meta || meta.url !== url.href) {
      discardPart(partPath, metaPath)
    } else {
      offset = fs.statSync(partPath).size
      // Already fully downloaded (e.g. crash between stream end and finalize) — a Range
      // request at EOF would yield 416; skip straight to finalize.
      if (meta.totalBytes > 0 && offset >= meta.totalBytes) return
    }
  }

  const attemptAbort = new AbortController()
  let stalled = false
  const onUserAbort = () => attemptAbort.abort()
  if (userSignal?.aborted) throw new Error('Download cancelled')
  userSignal?.addEventListener('abort', onUserAbort, { once: true })

  let stallTimer: ReturnType<typeof setTimeout> | null = null
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      stalled = true
      attemptAbort.abort()
    }, stallTimeoutMs)
  }

  try {
    const headers: Record<string, string> = {}
    if (offset > 0) headers.Range = `bytes=${offset}-`
    resetStallTimer()
    // Always fetched from the ORIGINAL allowlisted URL — redirect targets (signed CDN URLs)
    // are followed per-request and never persisted.
    const res = await fetch(url.href, { headers, signal: attemptAbort.signal, redirect: 'follow' })

    let total = 0
    let fd: number
    let completed: number
    if (offset > 0 && res.status === 206) {
      total = totalFromContentRange(res.headers.get('content-range'))
      const meta = readPartMeta(metaPath)
      if (meta && total > 0 && meta.totalBytes > 0 && meta.totalBytes !== total) {
        // Same URL but the remote object changed size — not the same file; start over
        // (retryable: the next attempt begins from scratch with no .part).
        discardPart(partPath, metaPath)
        throw new Error('Partial download does not match the remote file anymore — restarting from scratch')
      }
      fd = fs.openSync(partPath, 'a')
      completed = offset
    } else if (res.status === 200) {
      // Fresh download, or the server ignored our Range header — restart from scratch.
      discardPart(partPath, metaPath)
      const totalHeader = res.headers.get('content-length')
      total = totalHeader ? parseInt(totalHeader, 10) : 0
      fd = fs.openSync(partPath, 'w')
      completed = 0
    } else {
      throw new Error(`Download failed: HTTP ${res.status}`)
    }
    if (!res.body) {
      fs.closeSync(fd)
      throw new Error('Download response has no body')
    }

    // Record URL + expected total on first sight so later resumes can validate continuation.
    if (total > 0 && !readPartMeta(metaPath)) {
      fs.writeFileSync(metaPath, JSON.stringify({ url: url.href, totalBytes: total } satisfies PartMeta), 'utf8')
    }

    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.length) {
          resetStallTimer()
          fs.writeSync(fd, value)
          completed += value.length
          const pct = total > 0 ? Math.min(99, Math.round((completed / total) * 100)) : 0
          onProgress?.({
            modelId,
            status: 'downloading',
            progress: pct,
            completed,
            total: total || undefined,
          })
        }
      }
    } finally {
      fs.closeSync(fd)
    }

    if (total > 0 && fs.statSync(partPath).size < total) {
      // Stream ended cleanly but short (connection dropped without an error event).
      throw new DownloadStalledError()
    }
  } catch (err) {
    if (userSignal?.aborted) throw new Error('Download cancelled')
    if (stalled) throw new DownloadStalledError()
    throw err
  } finally {
    if (stallTimer) clearTimeout(stallTimer)
    userSignal?.removeEventListener('abort', onUserAbort)
  }
}

export async function downloadGgufFromAllowedUrl(
  rawUrl: string,
  opts?: {
    onProgress?: (p: DownloadProgress) => void
    signal?: AbortSignal
    /** Test seams — production callers use the defaults. */
    stallTimeoutMs?: number
    retryBackoffMs?: readonly number[]
  },
): Promise<ModelInstallResult> {
  const parsed = assertHttpsHuggingFaceDownloadUrl(rawUrl)
  const fileName = path.basename(parsed.pathname)
  const modelId = modelIdFromGgufFilename(fileName)
  const modelsDir = ensureModelsDir()
  const destPath = destPathForFileName(fileName)
  if (fs.existsSync(destPath)) {
    const err = new Error('MODEL_EXISTS') as Error & { code?: string; destPath?: string; modelId?: string }
    err.code = 'MODEL_EXISTS'
    err.destPath = destPath
    err.modelId = modelId
    throw err
  }

  const partPath = partPathFor(destPath)
  const metaPath = partMetaPathFor(destPath)
  const stallTimeoutMs = opts?.stallTimeoutMs ?? DOWNLOAD_STALL_TIMEOUT_MS
  const backoffSchedule = opts?.retryBackoffMs ?? DOWNLOAD_RETRY_BACKOFF_MS
  const maxAttempts = backoffSchedule.length + 1

  // Starting a NEW download for this URL is the only cleanup point for other URLs' .part files.
  cleanupForeignPartFiles(modelsDir, parsed.href)

  let lastProgress: DownloadProgress = { modelId, status: 'downloading', progress: 0, completed: 0, total: 0 }
  const reportProgress = (p: DownloadProgress) => {
    lastProgress = p
    opts?.onProgress?.(p)
  }
  reportProgress(lastProgress)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await attemptRangeDownload({
        url: parsed,
        partPath,
        metaPath,
        modelId,
        stallTimeoutMs,
        onProgress: reportProgress,
        userSignal: opts?.signal,
      })
      break
    } catch (err) {
      // Cancel leaves the .part in place so a later manual retry can resume.
      if (opts?.signal?.aborted) throw new Error('Download cancelled')
      if (attempt >= maxAttempts) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Download failed after ${maxAttempts} attempts (${reason}). ` +
            'The partial file was kept — retry the same URL to resume, or use "Import from file" with a .gguf you downloaded elsewhere.',
        )
      }
      opts?.onProgress?.({
        modelId,
        status: `stalled — resuming (attempt ${attempt + 1}/${maxAttempts})`,
        progress: lastProgress.progress,
        completed: lastProgress.completed,
        total: lastProgress.total,
      })
      await abortableSleep(backoffSchedule[attempt - 1]!, opts?.signal)
    }
  }

  // Hash the COMPLETE finished file (resume appends included), then atomically promote
  // .part -> .gguf. ensureLocalLlmAfterModelInstall is only triggered by callers after this
  // function resolves — i.e. strictly after successful hash + rename.
  opts?.onProgress?.({ modelId, status: 'validating', progress: 99 })
  try {
    assertGgufMagicHeader(partPath)
    opts?.onProgress?.({ modelId, status: 'computing_sha256', progress: 99 })
    const sha256 = await computeFileSha256Hex(partPath)
    fs.renameSync(partPath, destPath)
    try { if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath) } catch { /* best effort */ }
    await writeSha256Sidecar(destPath, sha256)
    const st = fs.statSync(destPath)
    opts?.onProgress?.({ modelId, status: 'complete', progress: 100, digest: sha256 })
    return { modelId, fileName, destPath, sha256, sizeBytes: st.size }
  } catch (err) {
    // A finished-but-invalid file (bad GGUF magic) can never become valid by resuming.
    discardPart(partPath, metaPath)
    throw err
  }
}

export function readInstalledModelSha256(ggufPath: string): string {
  return readSha256Sidecar(ggufPath)
}

export function deleteInstalledGguf(ggufPath: string): void {
  removeSha256Sidecar(ggufPath)
  if (fs.existsSync(ggufPath)) fs.unlinkSync(ggufPath)
}
