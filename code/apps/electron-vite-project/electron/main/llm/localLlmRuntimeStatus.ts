/**
 * Evidence-based local LLM / Ollama *hardware capability* hints.
 *
 * The Electron app cannot see whether Ollama actually offloads to CUDA/Metal on each request;
 * Ollama decides that internally. We only classify whether the *machine* is plausibly GPU-capable
 * and whether recent HTTP timings suggest a warm (resident) model — never "GPU proven in use".
 */

import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  DEBUG_OLLAMA_RUNTIME_TRACE,
  ollamaRuntimeLog,
  ollamaRuntimeObservedWarmModel,
} from './ollamaRuntimeDiagnostics'
import type { LocalLlmRuntimeClassification, LocalLlmRuntimeInfo } from './types'

const execAsync = promisify(exec)

export type { LocalLlmRuntimeClassification, LocalLlmRuntimeInfo }

type GpuHints = {
  platform: 'windows' | 'darwin' | 'linux' | 'other'
  appleSilicon: boolean
  nvidiaAdapterByName: boolean
  nvidiaSmiResponded: boolean
  amdDiscreteByName: boolean
  /** True when adapters look like iGPU-only (heuristic). */
  integratedOnly: boolean
  adapterNamesSample: string[]
}

let cachedHints: { at: number; hints: GpuHints } | null = null
const HINTS_TTL_MS = 45_000

function execOpts(timeoutMs: number): { timeout: number; windowsHide: boolean; maxBuffer: number } {
  return { timeout: timeoutMs, windowsHide: true, maxBuffer: 512 * 1024 }
}

function linesFromWmicNames(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && l !== 'Name')
}

async function tryNvidiaSmi(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader', execOpts(2500))
    return !!stdout?.trim()
  } catch {
    return false
  }
}

async function detectGpuHintsUncached(): Promise<GpuHints> {
  const platform: GpuHints['platform'] =
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'linux'
          ? 'linux'
          : 'other'

  const cpuModel = os.cpus()[0]?.model ?? ''
  const appleSilicon = platform === 'darwin' && /\bApple\b/i.test(cpuModel)

  const hints: GpuHints = {
    platform,
    appleSilicon,
    nvidiaAdapterByName: false,
    nvidiaSmiResponded: false,
    amdDiscreteByName: false,
    integratedOnly: false,
    adapterNamesSample: [],
  }

  try {
    if (platform === 'windows') {
      const { stdout } = await execAsync('wmic path win32_VideoController get Name', execOpts(5000))
      const lines = linesFromWmicNames(stdout)
      hints.adapterNamesSample = lines.slice(0, 6)
      const joined = lines.join(' | ')
      const lower = joined.toLowerCase()
      if (lower.includes('nvidia')) hints.nvidiaAdapterByName = true
      if (
        /\bradeon\b/i.test(joined) ||
        /\badvanced micro devices\b/i.test(lower) ||
        /\bamd\s+/i.test(joined)
      ) {
        hints.amdDiscreteByName = true
      }
      const looksIntelIgp =
        lower.includes('intel') &&
        (lower.includes('uhd') || lower.includes('hd graphics') || lower.includes('iris'))
      const microsoftBasic = lower.includes('microsoft basic') || lower.includes('remote display')
      hints.integratedOnly =
        !hints.nvidiaAdapterByName &&
        !hints.amdDiscreteByName &&
        lines.length > 0 &&
        (looksIntelIgp || microsoftBasic)
    } else if (platform === 'linux') {
      try {
        const { stdout } = await execAsync('lspci', execOpts(4000))
        const lower = stdout.toLowerCase()
        hints.adapterNamesSample = stdout.split('\n').slice(0, 4).map((l) => l.trim()).filter(Boolean)
        if (lower.includes('nvidia')) hints.nvidiaAdapterByName = true
        if (lower.includes('amd/ati') || lower.includes('advanced micro devices')) hints.amdDiscreteByName = true
        hints.integratedOnly =
          !hints.nvidiaAdapterByName &&
          !hints.amdDiscreteByName &&
          lower.includes('intel corporation') &&
          lower.includes('graphics')
      } catch {
        /* optional on minimal Linux */
      }
    }
  } catch {
    /* best-effort */
  }

  if (platform === 'windows' || platform === 'linux') {
    hints.nvidiaSmiResponded = await tryNvidiaSmi()
  }

  return hints
}

export async function getGpuAccelerationHintsCached(): Promise<GpuHints> {
  if (cachedHints && Date.now() - cachedHints.at < HINTS_TTL_MS) return cachedHints.hints
  const hints = await detectGpuHintsUncached()
  cachedHints = { at: Date.now(), hints }
  return hints
}

function buildSummaryAndEvidence(
  classification: LocalLlmRuntimeClassification,
  hints: GpuHints,
  warmObservation: boolean,
): { summary: string; evidence?: string; runtimeObservation: LocalLlmRuntimeInfo['runtimeObservation'] } {
  const warm: LocalLlmRuntimeInfo['runtimeObservation'] = warmObservation ? 'recent_warm_loads' : 'none'
  let evidence = `platform=${hints.platform}`
  if (hints.adapterNamesSample.length) {
    evidence += `; adapters=${hints.adapterNamesSample.slice(0, 3).join('; ')}`
  }
  if (hints.nvidiaSmiResponded) evidence += '; nvidia-smi responded'
  if (warmObservation) evidence += '; recent /api/chat reports low load_duration (model likely resident; GPU vs CPU not determined)'

  switch (classification) {
    case 'gpu_capable':
      return {
        summary: 'GPU-capable local runtime likely (hardware suggests accelerated inference is available).',
        evidence,
        runtimeObservation: warm,
      }
    case 'gpu_unconfirmed':
      return {
        summary: 'Local Ollama reachable — GPU use not confirmed from this app.',
        evidence,
        runtimeObservation: warm,
      }
    case 'cpu_likely':
      return {
        summary: 'Local runtime appears CPU-bound (no discrete NVIDIA/AMD detected).',
        evidence,
        runtimeObservation: warm,
      }
    default:
      return {
        summary: 'Could not determine local acceleration profile.',
        evidence,
        runtimeObservation: warm,
      }
  }
}

/**
 * Conservative classification. Never claims CUDA/Metal is active — only hardware + reachability hints.
 */
export function classifyLocalLlmRuntime(hints: GpuHints, ollamaRunning: boolean): LocalLlmRuntimeClassification {
  if (!ollamaRunning) return 'unknown'

  if (hints.appleSilicon) return 'gpu_capable'

  if (hints.nvidiaSmiResponded || hints.nvidiaAdapterByName) return 'gpu_capable'

  if (hints.amdDiscreteByName) return 'gpu_unconfirmed'

  if (hints.integratedOnly) return 'cpu_likely'

  if (hints.platform === 'darwin' && !hints.appleSilicon) return 'gpu_unconfirmed'

  if (!hints.nvidiaAdapterByName && !hints.amdDiscreteByName && hints.adapterNamesSample.length === 0)
    return 'gpu_unconfirmed'

  return 'gpu_unconfirmed'
}

export async function buildLocalLlmRuntimeInfo(params: {
  ollamaRunning: boolean
  activeModel?: string
}): Promise<LocalLlmRuntimeInfo> {
  if (!params.ollamaRunning) {
    const info: LocalLlmRuntimeInfo = {
      classification: 'unknown',
      summary: 'Start local Ollama to assess acceleration hints.',
      evidence: 'Ollama HTTP API not reachable on the configured port.',
      runtimeObservation: 'none',
    }
    if (DEBUG_OLLAMA_RUNTIME_TRACE) {
      ollamaRuntimeLog('localLlmRuntime:classified', {
        classification: 'unknown',
        ollamaRunning: false,
        activeModel: params.activeModel ?? null,
      })
    }
    return info
  }

  const hints = await getGpuAccelerationHintsCached()
  const warm = ollamaRuntimeObservedWarmModel()
  const classification = classifyLocalLlmRuntime(hints, true)

  const { summary, evidence, runtimeObservation } = buildSummaryAndEvidence(classification, hints, warm)

  const info: LocalLlmRuntimeInfo = {
    classification,
    summary,
    evidence,
    runtimeObservation,
  }

  if (DEBUG_OLLAMA_RUNTIME_TRACE) {
    ollamaRuntimeLog('localLlmRuntime:classified', {
      classification,
      activeModel: params.activeModel ?? null,
      ollamaRunning: params.ollamaRunning,
      appleSilicon: hints.appleSilicon,
      nvidiaAdapter: hints.nvidiaAdapterByName,
      nvidiaSmi: hints.nvidiaSmiResponded,
      amdDiscrete: hints.amdDiscreteByName,
      integratedOnlyHeuristic: hints.integratedOnly,
      runtimeObservation,
    })
  }

  return info
}
