import fs from 'fs'
import os from 'os'
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

export async function downloadGgufFromAllowedUrl(
  rawUrl: string,
  opts?: {
    onProgress?: (p: DownloadProgress) => void
    signal?: AbortSignal
  },
): Promise<ModelInstallResult> {
  const parsed = assertHttpsHuggingFaceDownloadUrl(rawUrl)
  const fileName = path.basename(parsed.pathname)
  const modelId = modelIdFromGgufFilename(fileName)
  ensureModelsDir()
  const destPath = destPathForFileName(fileName)
  if (fs.existsSync(destPath)) {
    const err = new Error('MODEL_EXISTS') as Error & { code?: string; destPath?: string; modelId?: string }
    err.code = 'MODEL_EXISTS'
    err.destPath = destPath
    err.modelId = modelId
    throw err
  }

  const tempPath = path.join(
    os.tmpdir(),
    `wrdesk-gguf-${Date.now()}-${Math.random().toString(16).slice(2)}.part`,
  )

  opts?.onProgress?.({ modelId, status: 'downloading', progress: 0, completed: 0, total: 0 })

  try {
    const res = await fetch(parsed.href, { signal: opts?.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    if (!res.body) throw new Error('Download response has no body')

    const totalHeader = res.headers.get('content-length')
    const total = totalHeader ? parseInt(totalHeader, 10) : 0
    const reader = res.body.getReader()
    const fd = fs.openSync(tempPath, 'w')
    let completed = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.length) {
          fs.writeSync(fd, value)
          completed += value.length
          const pct = total > 0 ? Math.min(99, Math.round((completed / total) * 100)) : 0
          opts?.onProgress?.({
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

    opts?.onProgress?.({ modelId, status: 'validating', progress: 99 })
    return await finalizeGgufImport(tempPath, destPath, opts?.onProgress)
  } catch (err) {
    if (opts?.signal?.aborted) {
      throw new Error('Download cancelled')
    }
    throw err
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    } catch {
      /* cleanup partial temp */
    }
  }
}

export function readInstalledModelSha256(ggufPath: string): string {
  return readSha256Sidecar(ggufPath)
}

export function deleteInstalledGguf(ggufPath: string): void {
  removeSha256Sidecar(ggufPath)
  if (fs.existsSync(ggufPath)) fs.unlinkSync(ggufPath)
}
