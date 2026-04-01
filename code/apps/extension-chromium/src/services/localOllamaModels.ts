/**
 * Single canonical source for installed local (Ollama) model names in the extension.
 * Uses the same Electron RPC path as WR Chat / LLM Settings: `llm.status` → `/api/llm/status`.
 */
import { electronRpc } from '../rpc/electronRpc'

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
