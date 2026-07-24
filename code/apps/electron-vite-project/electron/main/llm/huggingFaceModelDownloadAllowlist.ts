/**
 * HTTPS download allowlist for user-initiated GGUF URL installs (Phase 2).
 * Single source — do not scatter host literals elsewhere.
 */
export const HUGGINGFACE_GGUF_DOWNLOAD_ALLOWED_HOSTS = [
  'huggingface.co',
  'www.huggingface.co',
  'hf.co',
  'www.hf.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co',
] as const

export function assertHttpsHuggingFaceDownloadUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('Download URL is required')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid download URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS download URLs are allowed')
  }
  const host = parsed.hostname.toLowerCase()
  const allowed = HUGGINGFACE_GGUF_DOWNLOAD_ALLOWED_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`),
  )
  if (!allowed) {
    throw new Error(
      `Download host "${host}" is not allowlisted. Use a Hugging Face HTTPS link (huggingface.co or its CDN).`,
    )
  }
  const pathLower = parsed.pathname.toLowerCase()
  if (!pathLower.endsWith('.gguf')) {
    throw new Error('URL must point to a .gguf file')
  }
  return parsed
}
