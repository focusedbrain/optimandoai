/**
 * GPU / local llama.cpp inference readiness diagnostics for local WR Desk safety gating.
 * Never throws — returns a structured GpuStatus report for UI and assertions.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'

import {
  DEBUG_ACTIVE_LOCAL_MODEL,
  getStoredActiveLocalModelId,
  resolveEffectiveLocalModel,
} from '../llm/activeLocalModelStore'
import { collectLlamacppHttpBasesFromEnv } from '../llm/llamacppHttpBases'

const execAsync = promisify(exec)

export type GpuUnavailableReason =
  | 'NVIDIA_DRIVER_MISSING'
  | 'LOCAL_LLM_NOT_RUNNING'
  | 'LOCAL_LLM_VERSION_TOO_OLD'
  | 'GPU_NOT_DETECTED_BY_LLAMACPP'
  | 'MODEL_TOO_LARGE_FOR_GPU'
  | 'PARTIAL_GPU_OFFLOAD'
  | 'UNKNOWN'

export interface GpuStatus {
  available: boolean
  reason: GpuUnavailableReason | null
  detail: {
    nvidiaSmiPresent: boolean
    nvidiaSmiOutput: string | null
    localLlmRunning: boolean
    localLlmVersion: string | null
    activeModelOnGpu: boolean | null
    activeModelVramUsed: number | null
    activeModelTotal: number | null
    localLlmServerLogTail: string | null
  }
  userMessage: string
  technicalSummary: string
}

/** Baseline kept for the (currently unreachable for llama.cpp — see `firstResponsiveLlamacppBase`) version gate. */
const MIN_GOOD_LLAMACPP_VERSION = '0.4.0'
const STATUS_TTL_MS = 60_000

type CacheEntry = { at: number; status: GpuStatus }

let cachedLocal: CacheEntry | null = null
const remoteCache = new Map<string, CacheEntry>()

export function clearGpuStatusCache(): void {
  cachedLocal = null
  remoteCache.clear()
}

function cacheKeyRemote(origin: string, modelHint: string): string {
  return `${origin.replace(/\/$/, '')}::${modelHint.trim()}`
}

function parseSemverParts(v: string): number[] | null {
  const t = v.trim().replace(/^v/i, '')
  const m = t.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  const major = parseInt(m[1]!, 10)
  const minor = parseInt(m[2]!, 10)
  const patch = m[3] != null ? parseInt(m[3], 10) : 0
  return [major, minor, patch]
}

function semverAtLeast(version: string | null, minimum: string): boolean {
  if (!version) return true
  const a = parseSemverParts(version)
  const b = parseSemverParts(minimum)
  if (!a || !b) return true
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true
    if (a[i]! < b[i]!) return false
  }
  return true
}

function stripBareModelName(name: string): string {
  const t = name.trim().toLowerCase()
  const idx = t.indexOf(':')
  return idx >= 0 ? t.slice(0, idx) : t
}

function matchPsModelRow(
  rows: Array<{ name?: string; model?: string; size?: number; size_vram?: number }>,
  activeModel: string | null,
): { size: number; size_vram: number; name: string } | null {
  if (!activeModel || rows.length === 0) return null
  const want = activeModel.trim().toLowerCase()
  const bare = stripBareModelName(activeModel)
  for (const r of rows) {
    const n = (r.name ?? r.model ?? '').trim().toLowerCase()
    if (!n) continue
    if (n === want || n.startsWith(bare) || bare.startsWith(stripBareModelName(n))) {
      const size = typeof r.size === 'number' ? r.size : 0
      const size_vram = typeof r.size_vram === 'number' ? r.size_vram : -1
      return { size, size_vram, name: r.name ?? r.model ?? want }
    }
  }
  return null
}

/** Reused by B0 (`llamaServerBinaryInstall.ts`) to recommend a CUDA vs. CPU release variant. */
export async function detectNvidiaSmi(): Promise<{ present: boolean; output: string | null }> {
  try {
    const { stdout } = await execAsync('nvidia-smi', { timeout: 8_000, windowsHide: true })
    const o = stdout?.trim() || ''
    return { present: true, output: o || null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/not recognized as an internal or external command|is not recognized|ENOENT|command not found|status 1/i.test(msg) || /spawn .* ENOENT/i.test(msg)) {
      return { present: false, output: null }
    }
    return { present: false, output: msg }
  }
}

function localLlmServerLogCandidates(): string[] {
  const out: string[] = []
  if (process.platform === 'win32') {
    const lad = process.env.LOCALAPPDATA
    if (lad) out.push(path.join(lad, 'llama.cpp', 'server.log'))
  }
  const home = os.homedir()
  out.push(path.join(home, '.llama.cpp', 'logs', 'server.log'))
  return [...new Set(out)]
}

async function readLocalLlmLogTail(maxLines = 500): Promise<string | null> {
  for (const p of localLlmServerLogCandidates()) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf-8')
      const lines = raw.split(/\r?\n/)
      const slice = lines.slice(Math.max(0, lines.length - maxLines)).join('\n')
      return slice || null
    } catch {
      /* next */
    }
  }
  return null
}

function refineReasonFromLogs(
  tail: string | null,
  fallback: GpuUnavailableReason,
): GpuUnavailableReason {
  if (!tail) return fallback
  const lower = tail.toLowerCase()
  if (lower.includes('no compatible gpus were discovered')) return 'GPU_NOT_DETECTED_BY_LLAMACPP'
  if (lower.includes('cuda driver insufficient')) return 'GPU_NOT_DETECTED_BY_LLAMACPP'
  if (lower.includes('gpu memory insufficient')) return 'MODEL_TOO_LARGE_FOR_GPU'
  if (/loaded\s+\d+\s+layers\s+on\s+gpu/i.test(tail)) return 'PARTIAL_GPU_OFFLOAD'
  return fallback
}

function userMessagesFor(reason: GpuUnavailableReason, minVersion = MIN_GOOD_LLAMACPP_VERSION): string {
  switch (reason) {
    case 'NVIDIA_DRIVER_MISSING':
      return 'NVIDIA GPU driver is not installed or not detected. Install/update the NVIDIA driver from your GPU manufacturer\'s website. AI features are disabled until GPU inference is available.'
    case 'LOCAL_LLM_NOT_RUNNING':
      return 'The local LLM (llama.cpp) is not running. AI features require it to be running with GPU support.'
    case 'LOCAL_LLM_VERSION_TOO_OLD':
      return `The local LLM (llama.cpp) version is too old. Please update to at least version ${minVersion}.`
    case 'GPU_NOT_DETECTED_BY_LLAMACPP':
      return 'llama.cpp cannot detect a GPU. Check that your GPU driver is current and reinstall llama-server if needed.'
    case 'MODEL_TOO_LARGE_FOR_GPU':
      return 'Current model (gemma3:12b) does not fit in available GPU memory. Switch to a smaller model (e.g. llama3.1:8b) in Settings.'
    case 'PARTIAL_GPU_OFFLOAD':
      return 'Current model is partially running on CPU due to insufficient GPU memory. AI features are disabled to prevent thermal damage. Switch to a smaller model in Settings.'
    case 'UNKNOWN':
    default:
      return 'GPU inference could not be verified. Ensure the local LLM (llama.cpp) is running with a GPU-accelerated model load before using AI features.'
  }
}

function buildTechnicalSummary(parts: Record<string, unknown>): string {
  try {
    return JSON.stringify(parts, null, 0)
  } catch {
    return String(parts)
  }
}

async function fetchJsonWithTimeout(url: string, ms: number): Promise<{ ok: boolean; json: unknown }> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(ms) })
    if (!res.ok) return { ok: false, json: null }
    const json = await res.json()
    return { ok: true, json }
  } catch {
    return { ok: false, json: null }
  }
}

async function firstResponsiveLlamacppBase(bases: string[]): Promise<{ base: string; version: string | null } | null> {
  for (const b of bases) {
    const origin = b.replace(/\/$/, '')
    const health = await fetchJsonWithTimeout(`${origin}/health`, 4000)
    if (health.ok) {
      return { base: origin, version: 'llama.cpp' }
    }
    const models = await fetchJsonWithTimeout(`${origin}/v1/models`, 4000)
    if (!models.ok) continue
    return { base: origin, version: 'llama.cpp' }
  }
  return null
}

async function fetchV1ModelNames(origin: string): Promise<string[]> {
  const j = await fetchJsonWithTimeout(`${origin}/v1/models`, 5000)
  if (!j.ok) return []
  const data = (j.json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const names: string[] = []
  for (const row of data) {
    const n =
      typeof row === 'object' && row !== null && 'id' in row && typeof (row as { id: unknown }).id === 'string'
        ? String((row as { id: string }).id).trim()
        : ''
    if (n) names.push(n)
  }
  return names
}

/**
 * llama-server has no built-in equivalent of `ollama ps` (per-model VRAM residency). This always
 * returns `[]` for a real llama.cpp endpoint, which routes `probeGpuInferenceStatus` down the
 * "optimistic allow" branch below (model not matched → assume available). Pre-existing behavior,
 * carried over from the Ollama probe as-is; a real llama.cpp VRAM-offload signal is a separate,
 * larger feature and out of scope for this cleanup (no invented mechanisms).
 */
async function fetchPsRows(
  origin: string,
): Promise<Array<{ name?: string; model?: string; size?: number; size_vram?: number }>> {
  const j = await fetchJsonWithTimeout(`${origin.replace(/\/$/, '')}/api/ps`, 5000)
  if (!j.ok) return []
  const models = (j.json as { models?: unknown })?.models
  return Array.isArray(models) ? (models as Array<{ name?: string; model?: string; size?: number; size_vram?: number }>) : []
}

type ProbeScope = 'local-machine' | 'remote-llm-only'

async function probeGpuInferenceStatus(params: {
  httpBases: string[]
  modelHints: string[]
  /** When probing a remote LAN host, skip NVIDIA-SMI — local GPU driver is unrelated. */
  scope: ProbeScope
}): Promise<GpuStatus> {
  const { httpBases, modelHints, scope } = params
  const bases = [...new Set(httpBases.map((b) => b.replace(/\/$/, '')))].filter(Boolean)
  let nvidiaSmiPresent = false
  let nvidiaSmiOutput: string | null = null
  let stoppedForNvidia = false

  if (scope === 'local-machine') {
    if (process.platform !== 'darwin') {
      const smi = await detectNvidiaSmi()
      nvidiaSmiPresent = smi.present
      nvidiaSmiOutput = smi.output
      if (!smi.present) {
        stoppedForNvidia = true
      }
    } else {
      nvidiaSmiPresent = false
      nvidiaSmiOutput = null
    }
  } else {
    nvidiaSmiPresent = false
    nvidiaSmiOutput = null
  }

  const logTail = await readLocalLlmLogTail(500)

  if (stoppedForNvidia) {
    const reason: GpuUnavailableReason = 'NVIDIA_DRIVER_MISSING'
    const userMessage = userMessagesFor(reason)
    return {
      available: false,
      reason,
      detail: {
        nvidiaSmiPresent,
        nvidiaSmiOutput,
        localLlmRunning: false,
        localLlmVersion: null,
        activeModelOnGpu: null,
        activeModelVramUsed: null,
        activeModelTotal: null,
        localLlmServerLogTail: logTail,
      },
      userMessage,
      technicalSummary: buildTechnicalSummary({ reason, stoppedForNvidia, scope }),
    }
  }

  const alive = await firstResponsiveLlamacppBase(bases)
  if (!alive) {
    const reason: GpuUnavailableReason = 'LOCAL_LLM_NOT_RUNNING'
    return {
      available: false,
      reason,
      detail: {
        nvidiaSmiPresent,
        nvidiaSmiOutput,
        localLlmRunning: false,
        localLlmVersion: null,
        activeModelOnGpu: null,
        activeModelVramUsed: null,
        activeModelTotal: null,
        localLlmServerLogTail: logTail,
      },
      userMessage: userMessagesFor(reason),
      technicalSummary: buildTechnicalSummary({ basesTried: bases, reason }),
    }
  }

  const { base: responsiveBase, version: localLlmVersion } = alive

  if (localLlmVersion && !semverAtLeast(localLlmVersion, MIN_GOOD_LLAMACPP_VERSION)) {
    const refined: GpuUnavailableReason = 'LOCAL_LLM_VERSION_TOO_OLD'
    return {
      available: false,
      reason: refined,
      detail: {
        nvidiaSmiPresent,
        nvidiaSmiOutput,
        localLlmRunning: true,
        localLlmVersion,
        activeModelOnGpu: null,
        activeModelVramUsed: null,
        activeModelTotal: null,
        localLlmServerLogTail: logTail,
      },
      userMessage: userMessagesFor(refined),
      technicalSummary: buildTechnicalSummary({ localLlmVersion, minimum: MIN_GOOD_LLAMACPP_VERSION }),
    }
  }

  const installedNames = await fetchV1ModelNames(responsiveBase)
  let activeModel: string | null = null
  const hints = modelHints.map((s) => s.trim()).filter(Boolean)
  if (hints.length > 0) {
    const want = hints[0]!
    if (installedNames.includes(want)) activeModel = want
    else {
      const resolved = resolveEffectiveLocalModel(installedNames, want)
      activeModel = resolved.model
    }
  } else if (installedNames.length > 0) {
    const stored = getStoredActiveLocalModelId()
    const resolved = resolveEffectiveLocalModel(installedNames, stored)
    activeModel = resolved.model
  }

  if (DEBUG_ACTIVE_LOCAL_MODEL) {
    console.warn('[gpuStatus]', { responsiveBase, activeModel, installedCount: installedNames.length })
  }

  const rows = await fetchPsRows(responsiveBase)
  const match = activeModel ? matchPsModelRow(rows, activeModel) : null

  let activeModelOnGpu: boolean | null = null
  let activeModelVramUsed: number | null = null
  let activeModelTotal: number | null = null
  let reason: GpuUnavailableReason | null = null

  if (!match || rows.length === 0 || !activeModel) {
    // Nothing loaded yet or cannot match rows — optimistic allow (mirror legacy inbox preload).
    return {
      available: true,
      reason: null,
      detail: {
        nvidiaSmiPresent,
        nvidiaSmiOutput,
        localLlmRunning: true,
        localLlmVersion,
        activeModelOnGpu: null,
        activeModelVramUsed: null,
        activeModelTotal: null,
        localLlmServerLogTail: logTail,
      },
      userMessage: 'GPU inference looks available (model not loaded yet; first request loads weights).',
      technicalSummary: buildTechnicalSummary({ responsiveBase, activeModel, rows: rows.length }),
    }
  }

  activeModelVramUsed = match.size_vram
  activeModelTotal = match.size
  const eps = Math.max(match.size * 0.015, 8 * 1024 * 1024)

  if (match.size_vram <= 0) {
    reason = refineReasonFromLogs(logTail, nvidiaSmiPresent ? 'MODEL_TOO_LARGE_FOR_GPU' : 'GPU_NOT_DETECTED_BY_LLAMACPP')
    if (!nvidiaSmiPresent && process.platform === 'darwin') {
      reason = refineReasonFromLogs(logTail, 'MODEL_TOO_LARGE_FOR_GPU')
    }
    activeModelOnGpu = false
  } else if (match.size > 0 && match.size_vram + eps < match.size) {
    reason = refineReasonFromLogs(logTail, 'PARTIAL_GPU_OFFLOAD')
    activeModelOnGpu = false
  } else {
    activeModelOnGpu = true
  }

  if (!reason) {
    return {
      available: true,
      reason: null,
      detail: {
        nvidiaSmiPresent,
        nvidiaSmiOutput,
        localLlmRunning: true,
        localLlmVersion,
        activeModelOnGpu: true,
        activeModelVramUsed,
        activeModelTotal,
        localLlmServerLogTail: logTail,
      },
      userMessage: 'GPU inference is available.',
      technicalSummary: buildTechnicalSummary({ responsiveBase, activeModel }),
    }
  }

  const refined = refineReasonFromLogs(logTail, reason)

  return {
    available: false,
    reason: refined,
    detail: {
      nvidiaSmiPresent,
      nvidiaSmiOutput,
      localLlmRunning: true,
      localLlmVersion,
      activeModelOnGpu,
      activeModelVramUsed,
      activeModelTotal,
      localLlmServerLogTail: logTail,
    },
    userMessage: userMessagesFor(refined),
    technicalSummary: buildTechnicalSummary({
      responsiveBase,
      activeModel,
      refined,
      vram: match.size_vram,
      size: match.size,
    }),
  }
}

export async function getGpuStatus(): Promise<GpuStatus> {
  const now = Date.now()
  if (cachedLocal && now - cachedLocal.at < STATUS_TTL_MS) {
    return cachedLocal.status
  }
  const status = await probeGpuInferenceStatus({
    httpBases: collectLlamacppHttpBasesFromEnv(),
    modelHints: [],
    scope: 'local-machine',
  })
  cachedLocal = { at: now, status }
  return status
}

/**
 * Probes GPU offload for a llama.cpp endpoint at a specific origin (e.g. Sandbox → Host LAN URL).
 */
export async function getGpuInferenceStatusRemote(origin: string, modelBareHint: string): Promise<GpuStatus> {
  const o = origin.replace(/\/$/, '')
  const key = cacheKeyRemote(o, modelBareHint)
  const now = Date.now()
  const hit = remoteCache.get(key)
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.status
  const status = await probeGpuInferenceStatus({
    httpBases: [o],
    modelHints: [modelBareHint],
    scope: 'remote-llm-only',
  })
  remoteCache.set(key, { at: now, status })
  return status
}
