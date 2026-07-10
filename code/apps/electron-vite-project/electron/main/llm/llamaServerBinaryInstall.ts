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

export type GithubReleaseAsset = { name: string; browser_download_url: string }
export type GithubRelease = {
  tag_name: string
  assets: GithubReleaseAsset[]
  draft?: boolean
  prerelease?: boolean
}

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

export type PickedReleaseAssets = {
  main: GithubReleaseAsset
  /** CUDA runtime companion zip(s) — extracted into the same install dir as the binary. */
  companions: GithubReleaseAsset[]
}

/**
 * Select all assets required for a working install of `variant` from one release.
 * Returns null when the release is unusable/incomplete for this variant — either the main
 * zip is missing, or (CUDA) the matching `cudart-...` companion has not been uploaded yet.
 * Callers treat null as "try an older release" (assets upload one-by-one after a release is
 * published, which is exactly the race users hit on fresh tags).
 */
export function pickReleaseAssets(
  release: GithubRelease,
  variant: LlamaServerVariant,
): PickedReleaseAssets | null {
  if (release.draft || release.prerelease) return null
  const pattern = assetPatternForVariant(variant)
  const matches = release.assets.filter((a) => pattern.test(a.name))
  if (matches.length === 0) return null
  // Multiple CUDA runtime versions may be published (e.g. cuda-12.4 and cuda-13.3) — take the
  // lowest-numbered one for broader driver compatibility.
  matches.sort((a, b) => a.name.localeCompare(b.name))
  const main = matches[0]!
  if (variant !== 'cuda') return { main, companions: [] }

  // CUDA builds do not bundle the CUDA runtime: without the cudart companion zip
  // (cudart64_*.dll, cublas64_*.dll, cublasLt64_*.dll) llama-server fails to load its CUDA
  // backend on machines without a system-wide CUDA toolkit and silently runs CPU-only.
  const cudaVer = main.name.match(/-cuda-([\d.]+)-x64\.zip$/i)?.[1]
  if (!cudaVer) return null
  const companionRe = new RegExp(
    `^cudart-llama-bin-win-cuda-${cudaVer.replace(/\./g, '\\.')}-x64\\.zip$`,
    'i',
  )
  const companion = release.assets.find((a) => companionRe.test(a.name))
  if (!companion) return null
  return { main, companions: [companion] }
}

async function fetchRecentLlamaCppReleases(signal?: AbortSignal): Promise<GithubRelease[]> {
  const res = await fetch(
    `https://api.github.com/repos/${LLAMA_CPP_GITHUB_OWNER_REPO}/releases?per_page=10`,
    {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    },
  )
  if (!res.ok) throw new Error(`GitHub releases list failed: HTTP ${res.status}`)
  const json = (await res.json()) as GithubRelease[]
  return Array.isArray(json) ? json.filter((r) => Array.isArray(r.assets)) : []
}

/**
 * Release-race fallback: prefer the latest release, but when its asset set is incomplete
 * (fresh tag, assets still uploading) fall back to the newest previous release that has
 * everything this variant needs.
 */
async function resolveInstallableRelease(
  variant: LlamaServerVariant,
  signal?: AbortSignal,
): Promise<{ release: GithubRelease; assets: PickedReleaseAssets }> {
  const latest = await fetchLatestLlamaCppRelease(signal)
  const picked = pickReleaseAssets(latest, variant)
  if (picked) return { release: latest, assets: picked }
  console.warn(
    `[LLAMA_BINARY_INSTALL] release_race latest=${latest.tag_name} variant=${variant} — assets incomplete, scanning previous releases`,
  )
  const recent = await fetchRecentLlamaCppReleases(signal)
  for (const rel of recent) {
    if (rel.tag_name === latest.tag_name) continue
    const p = pickReleaseAssets(rel, variant)
    if (p) {
      console.warn(
        `[LLAMA_BINARY_INSTALL] release_race_fallback using=${rel.tag_name} instead_of=${latest.tag_name}`,
      )
      return { release: rel, assets: p }
    }
  }
  throw new Error(
    `No complete Windows x64 "${variant}" asset set found in the latest llama.cpp releases — GitHub may still be uploading. Try again in a few minutes.`,
  )
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

/** Copy every regular file under `rootDir` (recursively) flat into `destRoot` (companion DLL zips). */
function copyAllFilesFlatIntoRoot(rootDir: string, destRoot: string): void {
  const stack = [rootDir]
  let guard = 0
  while (stack.length > 0 && guard < 5000) {
    guard += 1
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
      else if (e.isFile()) fs.copyFileSync(full, path.join(destRoot, e.name))
    }
  }
}

function setProgress(p: LlamaServerBinaryInstallProgress): void {
  lastProgress = p
}

/** Stream one release asset to a temp file, reporting progress into [pctFrom, pctTo]. */
async function downloadAssetToTemp(p: {
  asset: GithubReleaseAsset
  signal: AbortSignal
  variant: LlamaServerVariant
  version: string
  pctFrom: number
  pctTo: number
}): Promise<string> {
  const assetUrl = assertHttpsGithubReleaseAssetUrl(p.asset.browser_download_url)
  const tempZip = path.join(
    os.tmpdir(),
    `llama-server-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`,
  )
  const res = await fetch(assetUrl.href, { signal: p.signal, redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed (${p.asset.name}): HTTP ${res.status}`)
  if (!res.body) throw new Error(`Download response has no body (${p.asset.name})`)
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
        const span = p.pctTo - p.pctFrom
        const pct = total > 0 ? p.pctFrom + Math.min(span, Math.round((completed / total) * span)) : p.pctFrom
        setProgress({
          status: 'downloading',
          progress: pct,
          variant: p.variant,
          version: p.version,
          completed,
          total: total || undefined,
        })
      }
    }
  } finally {
    fs.closeSync(fd)
  }
  return tempZip
}

async function runInstall(variant: LlamaServerVariant): Promise<LlamaServerBinaryInstallProgress> {
  downloadAbort = new AbortController()
  const signal = downloadAbort.signal
  const tempZips: string[] = []
  try {
    setProgress({ status: 'starting', progress: 0, variant })

    setProgress({ status: 'resolving_release', progress: 5, variant })
    const { release, assets } = await resolveInstallableRelease(variant, signal)

    setProgress({ status: 'downloading', progress: 10, variant, version: release.tag_name })
    const mainZip = await downloadAssetToTemp({
      asset: assets.main,
      signal,
      variant,
      version: release.tag_name,
      pctFrom: 10,
      pctTo: assets.companions.length > 0 ? 55 : 70,
    })
    tempZips.push(mainZip)

    const companionZips: string[] = []
    for (const companion of assets.companions) {
      const z = await downloadAssetToTemp({
        asset: companion,
        signal,
        variant,
        version: release.tag_name,
        pctFrom: 55,
        pctTo: 70,
      })
      companionZips.push(z)
      tempZips.push(z)
    }

    setProgress({ status: 'verifying', progress: 75, variant, version: release.tag_name })
    const sha256 = await computeFileSha256Hex(mainZip)

    setProgress({ status: 'extracting', progress: 85, variant, version: release.tag_name, sha256 })
    const destRoot = installDir()
    const extractTmp = path.join(os.tmpdir(), `llama-server-extract-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    try {
      await extractZipWindows(mainZip, extractTmp)
      const found = findExtractedServerBinary(extractTmp)
      if (!found) throw new Error('llama-server(.exe) not found inside downloaded archive')
      fs.mkdirSync(destRoot, { recursive: true })
      flattenIntoRoot(found, destRoot)
      // Companion zips (CUDA runtime DLLs) land flat next to llama-server.exe so the loader
      // finds cudart64/cublas64/cublasLt64 without a system-wide CUDA toolkit.
      for (const z of companionZips) {
        const compTmp = `${extractTmp}-comp-${Math.random().toString(16).slice(2)}`
        try {
          await extractZipWindows(z, compTmp)
          copyAllFilesFlatIntoRoot(compTmp, destRoot)
        } finally {
          try { fs.rmSync(compTmp, { recursive: true, force: true }) } catch { /* best effort */ }
        }
      }
    } finally {
      try { fs.rmSync(extractTmp, { recursive: true, force: true }) } catch { /* best effort */ }
      for (const z of tempZips) {
        try { fs.unlinkSync(z) } catch { /* best effort */ }
      }
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
