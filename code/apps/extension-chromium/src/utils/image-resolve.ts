/**
 * Shared image resolution & base64 helpers used by PopupChatView and sidepanel.
 *
 * Centralised here so the two implementations can never diverge again.
 */

const ORCHESTRATOR_BASE_URL = 'http://127.0.0.1:51248'

// ─── Internal helpers ────────────────────────────────────────────────────────

function isLikelyFilesystemPath(s: string): boolean {
  if (!s || s.length < 2) return false
  if (/^[A-Za-z]:[\\/]/.test(s)) return true
  if (s.startsWith('\\\\')) return true
  return false
}

function pathToFileUrlString(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  if (/^[A-Za-z]:/.test(normalized)) return 'file:///' + normalized
  if (normalized.startsWith('//')) return 'file:' + normalized
  return 'file://' + normalized
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Try to resolve a blob: or file: URL to a data URL via the orchestrator HTTP API.
 *  Used when cross-process fetch of blob: URLs fails (Electron dashboard context). */
async function resolveViaOrchestrator(imageUrl: string, secret: string | null): Promise<string | null> {
  try {
    const r = await fetch(`${ORCHESTRATOR_BASE_URL}/api/util/resolve-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' },
      body: JSON.stringify({ url: imageUrl }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { ok?: boolean; dataUrl?: string }
    if (j.ok && typeof j.dataUrl === 'string' && j.dataUrl.startsWith('data:')) return j.dataUrl
    return null
  } catch {
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Extract base64 payload from a data URL.
 *
 * Returns `null` when:
 * - the input is not a `data:` URL,
 * - the input has no comma separator,
 * - the extracted payload is shorter than 100 chars (can't be a real image).
 */
export function toBase64ForOllama(dataUrl: string): string | null {
  if (!dataUrl) return null
  if (!dataUrl.startsWith('data:')) return null
  const idx = dataUrl.indexOf(',')
  if (idx === -1) return null
  const b64 = dataUrl.slice(idx + 1)
  if (b64.length < 100) return null
  return b64
}

/**
 * Returns true only when `b64` looks like a real vision-model payload.
 *
 * Rejects:
 * - null / too-short strings
 * - raw URL schemes that leaked through (blob:, file:, http)
 * - Windows drive-letter or UNC paths
 * - Strings whose first 10 chars contain path separators
 */
export function isPlausibleVisionBase64(b64: string | null): boolean {
  if (!b64 || b64.length < 100) return false
  if (b64.startsWith('blob:') || b64.startsWith('file:') || b64.startsWith('http')) return false
  if (/^[A-Za-z]:[\\/]/.test(b64)) return false
  if (b64.startsWith('\\\\')) return false
  // NOTE: do NOT reject on '/' in first 10 chars — base64 alphabet includes '/' and JPEG encodes to '/9j/4...'
  return true
}

/**
 * Resolve any image reference to a `data:` URL suitable for base64 extraction.
 *
 * Resolution order:
 *   1. Already a data URL → return as-is.
 *   2. blob: / file: → direct fetch (works in extension popup / sidepanel renderer).
 *   3. blob: / file: fetch fails → orchestrator HTTP fallback when `isDashboard` or
 *      a `secret` is supplied (Electron dashboard cross-process case).
 *   4. Windows filesystem path → convert to file: URL, attempt fetch, then fallback.
 *   5. All attempts exhausted → return `null` so callers degrade to text-only.
 *
 * NEVER returns a raw blob:/file:/path string — that causes [img-0] Ollama errors.
 */
export async function resolveImageUrlForBackend(
  imageUrl: string,
  opts?: { secret?: string | null; isDashboard?: boolean },
): Promise<string | null> {
  if (!imageUrl) return null
  if (imageUrl.startsWith('data:')) return imageUrl

  if (imageUrl.startsWith('blob:') || imageUrl.startsWith('file:')) {
    try {
      const r = await fetch(imageUrl)
      const blob = await r.blob()
      const dataUrl = await blobToDataUrl(blob)
      if (dataUrl.startsWith('data:')) return dataUrl
    } catch {
      // Direct fetch failed — expected in Electron dashboard cross-process context.
    }
    if (opts?.isDashboard || opts?.secret !== undefined) {
      const via = await resolveViaOrchestrator(imageUrl, opts?.secret ?? null)
      if (via) return via
    }
    console.warn('[WRChat] image resolve failed — blob/file fetch failed and no orchestrator fallback:', imageUrl.slice(0, 80))
    return null
  }

  if (isLikelyFilesystemPath(imageUrl)) {
    try {
      const r = await fetch(pathToFileUrlString(imageUrl))
      const blob = await r.blob()
      const dataUrl = await blobToDataUrl(blob)
      if (dataUrl.startsWith('data:')) return dataUrl
    } catch {
      // Filesystem path fetch failed.
    }
    if (opts?.isDashboard || opts?.secret !== undefined) {
      const via = await resolveViaOrchestrator(imageUrl, opts?.secret ?? null)
      if (via) return via
    }
    console.warn('[WRChat] image resolve failed — filesystem path unreadable:', imageUrl.slice(0, 80))
    return null
  }

  console.warn('[WRChat] image resolve failed — unrecognised URL format:', imageUrl.slice(0, 80))
  return null
}
