/**
 * Host-only persisted policy for Sandbox → Host internal inference (Ollama, direct P2P).
 * - Persisted `allowSandboxInference` remains the UI / IPC mirror of user intent.
 * - `remoteHostInferenceUserChoice` records **explicit** allow vs deny from settings; when `unset`, pairing + ledger
 *   gates in `resolveHostAiRemoteInferencePolicy` decide (default allow for valid internal same-principal Host↔Sandbox).
 * - Size, duration, concurrency, and per-handshake rate are bounded; model selection follows
 *   allowlist / active local model (see `hostInferenceExecute`).
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export type RemoteHostInferenceUserChoice = 'allow' | 'deny' | 'unset'

export interface HostInternalInferencePolicy {
  /**
   * Mirror of persisted toggle; may be false while {@link remoteHostInferenceUserChoice} is `unset`
   * (legacy files) — use `resolveHostAiRemoteInferencePolicy` for whether remote inference is allowed.
   */
  allowSandboxInference: boolean
  /**
   * `allow` / `deny`: user explicitly set Host inference sharing in settings (via IPC).
   * `unset`: no explicit choice on disk (legacy or default) — pairing + ledger rules apply.
   */
  remoteHostInferenceUserChoice: RemoteHostInferenceUserChoice
  /**
   * If non-empty, each entry must be installed; the requested `model` (if any) must be in the list.
   * If empty, an explicit request must be installed; else the active Ollama chat model (if installed), else the first local model.
   */
  modelAllowlist: string[]
  /** Total UTF-8 byte budget for the serialized `messages` payload (approximate, JSON length). */
  maxPromptBytes: number
  /** Max UTF-8 bytes for a single model output (non-streaming). */
  maxOutputBytes: number
  /** Client-side and Host-side Ollama fetch timeout. */
  timeoutMs: number
  /** In-flight cap for internal inference. */
  maxConcurrent: number
  /**
   * Per-handshake rolling limit over 60s for `internal_inference_request` (sliding window, in-process).
   * Default 30; set 0 to use default. Range clamped 1–120 in normalize.
   */
  maxRequestsPerHandshakePerMinute: number
  /**
   * When true, `internal_inference_capabilities_result` lists all installed Ollama models (metadata only).
   * Default false: expose only the resolved active / allowlist chat model (MVP).
   */
  capabilitiesExposeAllInstalledOllama: boolean
}

const DEFAULT_POLICY: HostInternalInferencePolicy = {
  allowSandboxInference: false,
  remoteHostInferenceUserChoice: 'unset',
  modelAllowlist: [],
  maxPromptBytes: 256_000,
  maxOutputBytes: 256_000,
  timeoutMs: 60_000,
  maxConcurrent: 1,
  maxRequestsPerHandshakePerMinute: 30,
  capabilitiesExposeAllInstalledOllama: false,
}

const FILE = 'host-internal-inference-policy.json'

function storePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

function readDisk(): HostInternalInferencePolicy {
  const p = storePath()
  try {
    if (!fs.existsSync(p)) {
      return { ...DEFAULT_POLICY }
    }
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<HostInternalInferencePolicy>
    return normalizePolicy(raw)
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

function normalizeRemoteChoice(p: Partial<HostInternalInferencePolicy>): RemoteHostInferenceUserChoice {
  const c = p.remoteHostInferenceUserChoice
  if (c === 'deny') return 'deny'
  if (c === 'allow') return 'allow'
  if (c === 'unset') return 'unset'
  if (p.allowSandboxInference === true) return 'allow'
  return 'unset'
}

function normalizePolicy(p: Partial<HostInternalInferencePolicy>): HostInternalInferencePolicy {
  const allowSandboxInference = p.allowSandboxInference === true
  const remoteHostInferenceUserChoice = normalizeRemoteChoice({ ...p, allowSandboxInference })
  return {
    allowSandboxInference,
    remoteHostInferenceUserChoice,
    modelAllowlist: Array.isArray(p.modelAllowlist)
      ? p.modelAllowlist.map((s) => String(s).trim()).filter(Boolean)
      : [],
    maxPromptBytes:
      typeof p.maxPromptBytes === 'number' && p.maxPromptBytes > 0 && p.maxPromptBytes < 10_000_000
        ? Math.floor(p.maxPromptBytes)
        : DEFAULT_POLICY.maxPromptBytes,
    maxOutputBytes:
      typeof p.maxOutputBytes === 'number' && p.maxOutputBytes > 0 && p.maxOutputBytes < 10_000_000
        ? Math.floor(p.maxOutputBytes)
        : DEFAULT_POLICY.maxOutputBytes,
    timeoutMs:
      typeof p.timeoutMs === 'number' && p.timeoutMs >= 1_000 && p.timeoutMs <= 600_000
        ? Math.floor(p.timeoutMs)
        : DEFAULT_POLICY.timeoutMs,
    maxConcurrent:
      typeof p.maxConcurrent === 'number' && p.maxConcurrent >= 1 && p.maxConcurrent <= 8
        ? Math.floor(p.maxConcurrent)
        : DEFAULT_POLICY.maxConcurrent,
    maxRequestsPerHandshakePerMinute: (() => {
      if (p.maxRequestsPerHandshakePerMinute === 0) {
        return DEFAULT_POLICY.maxRequestsPerHandshakePerMinute
      }
      if (
        typeof p.maxRequestsPerHandshakePerMinute === 'number' &&
        p.maxRequestsPerHandshakePerMinute >= 1 &&
        p.maxRequestsPerHandshakePerMinute <= 120
      ) {
        return Math.floor(p.maxRequestsPerHandshakePerMinute)
      }
      return DEFAULT_POLICY.maxRequestsPerHandshakePerMinute
    })(),
    capabilitiesExposeAllInstalledOllama: p.capabilitiesExposeAllInstalledOllama === true,
  }
}

let cached: HostInternalInferencePolicy | null = null

function loadCached(): HostInternalInferencePolicy {
  if (cached != null) return cached
  try {
    cached = readDisk()
  } catch {
    cached = { ...DEFAULT_POLICY }
  }
  return cached
}

export function getHostInternalInferencePolicy(): HostInternalInferencePolicy {
  return { ...loadCached() }
}

export function setHostInternalInferencePolicy(partial: Partial<HostInternalInferencePolicy>): HostInternalInferencePolicy {
  const cur = loadCached()
  const mergeIn: Partial<HostInternalInferencePolicy> = { ...cur, ...partial }
  /**
   * `allowSandboxInference: false` must mean explicit user deny **only** when the IPC payload does not also
   * carry `remoteHostInferenceUserChoice: 'unset'` (e.g. merged `getHostPolicy()` spread). Otherwise we would
   * persist `deny` on every settings save and block Host advertisement after restart.
   */
  if ('allowSandboxInference' in partial) {
    mergeIn.allowSandboxInference = partial.allowSandboxInference === true
    if (partial.allowSandboxInference === true) {
      mergeIn.remoteHostInferenceUserChoice = 'allow'
    } else if ('remoteHostInferenceUserChoice' in partial && partial.remoteHostInferenceUserChoice !== undefined) {
      const rc = partial.remoteHostInferenceUserChoice
      if (rc === 'deny' || rc === 'allow' || rc === 'unset') {
        mergeIn.remoteHostInferenceUserChoice = rc
      } else {
        mergeIn.remoteHostInferenceUserChoice = 'deny'
      }
    } else {
      mergeIn.remoteHostInferenceUserChoice = 'deny'
    }
  }
  const merged = normalizePolicy(mergeIn)
  cached = merged
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify(merged, null, 2), 'utf8')
  } catch (e) {
    console.warn('[host-inference-policy] write failed', (e as Error)?.message)
  }
  return { ...cached }
}

/** @internal tests */
export function _resetHostInferencePolicyForTests(p: HostInternalInferencePolicy): void {
  cached = normalizePolicy({ ...DEFAULT_POLICY, ...p })
}
