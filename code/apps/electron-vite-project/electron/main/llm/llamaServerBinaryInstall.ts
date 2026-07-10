/**
 * B0 — llama-server binary provisioning.
 *
 * First-run/on-demand download of the official llama-server build from the
 * ggml-org/llama.cpp GitHub releases (HTTPS, mandatory SHA256 display — same UX pattern as
 * the GGUF model install in `localLlmModelInstall.ts`), extracted to
 * `%LOCALAPPDATA%\Programs\llama.cpp\` — the exact path `LocalLlmManager.initializeServerBinaryPath`
 * already checks second (after the bundled `resourcesPath` check, which stays as a future
 * packaging option and is not touched here).
 *
 * Windows-only extraction (this app targets Windows hosts): uses PowerShell `Expand-Archive`
 * rather than adding a new zip-parsing dependency.
 */

import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { detectNvidiaSmi } from '../inference/gpuStatus'
import { assertHttpsGithubReleaseAssetUrl, LLAMA_CPP_GITHUB_OWNER_REPO } from './llamaServerBinaryDownloadAllowlist'
import { computeFileSha256Hex } from './ggufFileUtils'
import { localLlmManager } from './local-llm-manager'

export type LlamaServerVariant = 'cpu' | 'cuda' | 'vulkan'

export type LlamaServerBinaryInstallProgress = {
  status: 'starting' | 'resolving_release' | 'downloading' | 'extracting' | 'verifying' | 'complete' | 'error'
  progress: number // 0-100
  variant?: LlamaServerVariant
  version?: string
  completed?: number
  total?: number
  sha256?: string
  error?: string
}

type GithubReleaseAsset = { name: string; browser_download_url: string }
type GithubRelease = { tag_name: string; assets: GithubReleaseAsset[] }

let installInFlight: Promise<LlamaServerBinaryInstallProgress> | null = null
let lastProgress: LlamaServerBinaryInstallProgress | null = null
let downloadAbort: AbortController | null = null

export function getLlamaServerBinaryInstallProgress(): LlamaServerBinaryInstallProgress | null {
  return lastProgress
}

export function cancelLlamaServerBinaryInstall(): void {
  downloadAbort?.abort()
  downloadAbort = null
}

function installDir(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || app.getPath('home'), 'AppData', 'Local')
  return path.join(localAppData, 'Programs', 'llama.cpp')
}

/**
 * Recommend a release variant from local hardware — reuses the same NVIDIA-SMI detection as
 * `gpuStatus.ts` so the "GPU available" signal is derived in exactly one place. Vulkan is
 * offered as a manual choice (AMD/Intel iGPU) but never auto-recommended (ambiguous without a
 * broader GPU vendor probe) — defaults to CPU per the B0 spec when detection is ambiguous.
 */
export async function detectRecommendedLlamaServerVariant(): Promise<{
  variant: LlamaServerVariant
  reason: string
}> {
  if (process.platform !== 'win32') {
    return { variant: 'cpu', reason: 'non_windows_platform_defaults_cpu' }
  }
  const smi = await detectNvidiaSmi()
  if (smi.present) {
    return { variant: 'cuda', reason: 'nvidia_smi_detected' }
  }
  return { variant: 'cpu', reason: 'no_nvidia_gpu_detected_defaults_cpu' }
}

async function fetchLatestLlamaCppRelease(signal?: AbortSignal): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${LLAMA_CPP_GITHUB_OWNER_REPO}/releases/latest`, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
    signal,
  })
  if (!res.ok) throw new Error(`GitHub releases lookup failed: HTTP ${res.status}`)
  const json = (await res.json()) as GithubRelease
  if (!Array.isArray(json.assets)) throw new Error('GitHub release response has no assets')
  return json
}

/** Windows x64 asset name pattern, e.g. `llama-b9950-bin-win-cpu-x64.zip` / `...-cuda-12.4-x64.zip`. */
function assetPatternForVariant(variant: LlamaServerVariant): RegExp {
  if (variant === 'cuda') return /^llama-b\d+-bin-win-cuda-[\d.]+-x64\.zip$/i
  if (variant === 'vulkan') return /^llama-b\d+-bin-win-vulkan-x64\.zip$/i
  return /^llama-b\d+-bin-win-cpu-x64\.zip$/i
}

function pickReleaseAsset(release: GithubRelease, variant: LlamaServerVariant): GithubReleaseAsset {
  const pattern = assetPatternForVariant(variant)
  const matches = release.assets.filter((a) => pattern.test(a.name))
  if (matches.length === 0) {
    throw new Error(`No Windows x64 "${variant}" asset found in release ${release.tag_name}`)
  }
  // Multiple CUDA runtime versions may be published (e.g. cuda-12.4 and cuda-13.3) — take the
  // lowest-numbered one for broader driver compatibility.
  matches.sort((a, b) => a.name.localeCompare(b.name))
  return matches[0]!
}

async function extractZipWindows(zipPath: string, destDir: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('llama-server binary auto-install currently supports Windows only')
  }
  fs.mkdirSync(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]
    const proc = spawn('powershell.exe', psArgs, { windowsHide: true })
    let stderr = ''
    proc.stderr?.on('data', (d) => { stderr += String(d) })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Expand-Archive failed (exit ${code}): ${stderr.slice(0, 300)}`))
    })
  })
}

/** llama-server(.exe) may land at the extraction root or a nested folder depending on zip layout. */
function findExtractedServerBinary(root: string): string | null {
  const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  const stack = [root]
  let depth = 0
  while (stack.length > 0 && depth < 5000) {
    depth += 1
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile() && e.name.toLowerCase() === binaryName.toLowerCase()) return full
    }
  }
  return null
}

/** Flatten a nested extraction (binary + its sibling DLLs) up into `destRoot` if needed. */
function flattenIntoRoot(binaryPath: string, destRoot: string): void {
  const srcDir = path.dirname(binaryPath)
  if (path.resolve(srcDir) === path.resolve(destRoot)) return
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isFile()) continue
    const src = path.join(srcDir, e.name)
    const dest = path.join(destRoot, e.name)
    fs.copyFileSync(src, dest)
  }
}

function setProgress(p: LlamaServerBinaryInstallProgress): void {
  lastProgress = p
}

async function runInstall(variant: LlamaServerVariant): Promise<LlamaServerBinaryInstallProgress> {
  downloadAbort = new AbortController()
  const signal = downloadAbort.signal
  try {
    setProgress({ status: 'starting', progress: 0, variant })

    setProgress({ status: 'resolving_release', progress: 5, variant })
    const release = await fetchLatestLlamaCppRelease(signal)
    const asset = pickReleaseAsset(release, variant)
    const assetUrl = assertHttpsGithubReleaseAssetUrl(asset.browser_download_url)

    const tempZip = path.join(os.tmpdir(), `llama-server-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`)
    setProgress({ status: 'downloading', progress: 10, variant, version: release.tag_name })
    const res = await fetch(assetUrl.href, { signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
    if (!res.body) throw new Error('Download response has no body')
    const totalHeader = res.headers.get('content-length')
    const total = totalHeader ? parseInt(totalHeader, 10) : 0
    const reader = res.body.getReader()
    const fd = fs.openSync(tempZip, 'w')
    let completed = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.length) {
          fs.writeSync(fd, value)
          completed += value.length
          const pct = total > 0 ? 10 + Math.min(60, Math.round((completed / total) * 60)) : 10
          setProgress({
            status: 'downloading',
            progress: pct,
            variant,
            version: release.tag_name,
            completed,
            total: total || undefined,
          })
        }
      }
    } finally {
      fs.closeSync(fd)
    }

    setProgress({ status: 'verifying', progress: 75, variant, version: release.tag_name })
    const sha256 = await computeFileSha256Hex(tempZip)

    setProgress({ status: 'extracting', progress: 85, variant, version: release.tag_name, sha256 })
    const destRoot = installDir()
    const extractTmp = path.join(os.tmpdir(), `llama-server-extract-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    try {
      await extractZipWindows(tempZip, extractTmp)
      const found = findExtractedServerBinary(extractTmp)
      if (!found) throw new Error('llama-server(.exe) not found inside downloaded archive')
      fs.mkdirSync(destRoot, { recursive: true })
      flattenIntoRoot(found, destRoot)
    } finally {
      try { fs.rmSync(extractTmp, { recursive: true, force: true }) } catch { /* best effort */ }
      try { fs.unlinkSync(tempZip) } catch { /* best effort */ }
    }

    localLlmManager.refreshServerBinaryPath()
    if (!localLlmManager.isBinaryAvailable()) {
      throw new Error('Extraction completed but llama-server binary was not found at the expected install path')
    }
    // Binary is now present — if a GGUF model is already installed, start the server immediately
    // (mirrors the existing post-model-install auto-start in `ensureLocalLlmAfterModelInstall`).
    const { ensureLocalLlmAfterModelInstall } = await import('./localLlmLifecycle')
    void ensureLocalLlmAfterModelInstall('binary_install_complete')

    const done: LlamaServerBinaryInstallProgress = {
      status: 'complete',
      progress: 100,
      variant,
      version: release.tag_name,
      sha256,
    }
    setProgress(done)
    return done
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const failed: LlamaServerBinaryInstallProgress = {
      status: 'error',
      progress: lastProgress?.progress ?? 0,
      variant,
      error: signal.aborted ? 'Install cancelled' : msg.slice(0, 300),
    }
    setProgress(failed)
    throw err
  } finally {
    downloadAbort = null
  }
}

export async function installLlamaServerBinary(
  variant: LlamaServerVariant,
): Promise<LlamaServerBinaryInstallProgress> {
  if (installInFlight) return installInFlight
  installInFlight = runInstall(variant).finally(() => {
    installInFlight = null
  })
  return installInFlight
}
