/**
 * Single canonical source for installed local (Ollama) model names in the extension.
 * Uses the same Electron RPC path as WR Chat / LLM Settings: `llm.status` → `/api/llm/status`.
 *
 * Direct `GET {ollamaBase}/api/tags` is used when the wizard needs models for a specific
 * endpoint (must match the URL the user configured).
 */
import { electronRpc } from '../rpc/electronRpc'
import { DEFAULT_OLLAMA_ENDPOINT } from '../shared/ui/customModeTypes'

export type InstalledLocalModelsResult = {
  ok: boolean
  /** Model id strings as reported by Ollama (e.g. `gemma:2b`). */
  names: string[]
  ollamaInstalled?: boolean
  ollamaRunning?: boolean
  error?: string
}

function unwrapStatusPayload(result: {
  success: boolean
  data?: unknown
  error?: string
}): { ok: boolean; status: Record<string, unknown> | null } {
  if (!result.success || result.data == null) {
    return { ok: false, status: null }
  }
  const raw = result.data as Record<string, unknown>
  const inner = raw.data !== undefined ? (raw.data as Record<string, unknown>) : raw
  const ok = (raw.ok as boolean | undefined) ?? result.success
  return { ok: Boolean(ok), status: inner }
}

/**
 * Returns installed Ollama model names from the backend. No static list.
 * On failure or when Ollama is down, `names` is empty and `ok`/`error` describe why.
 */
/**
 * Lists models from a running Ollama instance at `endpoint` (e.g. http://127.0.0.1:11434).
 * Returns [] on network/CORS failure — caller may fall back to {@link fetchInstalledLocalModelNames}.
 */
export async function fetchOllamaModelNamesFromEndpoint(
  endpoint: string | undefined,
  timeoutMs = 12_000,
): Promise<string[]> {
  const raw = (endpoint ?? DEFAULT_OLLAMA_ENDPOINT).trim().replace(/\/$/, '')
  if (!raw.startsWith('http')) return []
  try {
    const res = await fetch(`${raw}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return []
    const j = (await res.json()) as { models?: Array<{ name?: string }> }
    const models = j?.models
    if (!Array.isArray(models)) return []
    const names = models
      .map((m) => (typeof m?.name === 'string' ? m.name.trim() : ''))
      .filter(Boolean)
    return [...new Set(names)]
  } catch {
    return []
  }
}

export async function fetchInstalledLocalModelNames(): Promise<InstalledLocalModelsResult> {
  try {
    const result = await electronRpc('llm.status', undefined, 20000)
    const { ok, status } = unwrapStatusPayload(result)
    if (!ok || !status) {
      return {
        ok: false,
        names: [],
        error: result.error || 'LLM status unavailable',
      }
    }
    const installed = Boolean(status.installed)
    const running = Boolean(status.running)
    if (!installed || !running) {
      return {
        ok: true,
        names: [],
        ollamaInstalled: installed,
        ollamaRunning: running,
      }
    }
    const modelsInstalled = status.modelsInstalled as Array<{ name?: string }> | undefined
    const names = (modelsInstalled || [])
      .map((m) => (typeof m?.name === 'string' ? m.name : ''))
      .filter(Boolean)
    return {
      ok: true,
      names,
      ollamaInstalled: true,
      ollamaRunning: true,
    }
  } catch (e) {
    return {
      ok: false,
      names: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** Escape model id for use in HTML option value / text (attribute context). */
export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
