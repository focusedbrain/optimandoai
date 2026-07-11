/**
 * MIRROR of `apps/electron-vite-project/electron/main/llm/localModelIdentity.ts` (single source of
 * truth is the electron module — keep the logic byte-identical, do not fork behavior here).
 * Mirrored because the extension build cannot import across app packages (same pattern as
 * `hostInferenceRouteIds.ts`).
 *
 * Canonical identity for local GGUF models: one model, three historical spellings — full Windows
 * path, GGUF filename, canonical name (filename without `.gguf`) — plus stale Ollama-era tags.
 * Everything outbound uses the CANONICAL name; every identity comparison resolves through the
 * alias set instead of strict string equality.
 */

/** Canonical local model name: path basename without a trailing `.gguf` (case-insensitive). */
export function canonicalLocalModelName(idOrPath: string | null | undefined): string {
  const s = String(idOrPath ?? '').trim()
  if (!s) return ''
  const base = s.split(/[\\/]/).pop() ?? s
  return base.replace(/\.gguf$/i, '').trim()
}

/**
 * Alias-resolve `requested` against `installedNames` (any spelling on either side).
 * @returns the canonical name of the matching installed model, or null when nothing resolves
 *          (e.g. a stale Ollama-era tag like `gemma4:12b-it-q8_0`).
 */
export function resolveLocalModelAlias(
  requested: string | null | undefined,
  installedNames: readonly string[],
): string | null {
  const req = String(requested ?? '').trim()
  if (!req) return null
  const reqCanon = canonicalLocalModelName(req)
  if (!reqCanon) return null
  for (const n of installedNames) {
    const name = String(n ?? '').trim()
    if (!name) continue
    if (name === req) return canonicalLocalModelName(name)
    if (canonicalLocalModelName(name) === reqCanon) return canonicalLocalModelName(name)
  }
  return null
}

/** True when the two model ids refer to the same model under alias resolution. */
export function localModelIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalLocalModelName(a)
  const cb = canonicalLocalModelName(b)
  return Boolean(ca) && ca === cb
}

/** Canonicalize + de-duplicate a model name list, preserving first-seen order. */
export function dedupeCanonicalModelNames(names: readonly (string | null | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of names) {
    const c = canonicalLocalModelName(n)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}
