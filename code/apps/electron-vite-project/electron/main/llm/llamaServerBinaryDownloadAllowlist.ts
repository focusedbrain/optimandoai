/**
 * HTTPS download allowlist for the llama-server binary provisioning flow (B0).
 * Same UX pattern as the GGUF HTTPS install (`huggingFaceModelDownloadAllowlist.ts`):
 * host allowlist + mandatory SHA256 display, no curated/mirrored copy of the binary.
 */

export const LLAMA_SERVER_RELEASE_ALLOWED_HOSTS = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com',
] as const

export const LLAMA_CPP_GITHUB_OWNER_REPO = 'ggml-org/llama.cpp'

export function assertHttpsGithubReleaseAssetUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim()
  if (!trimmed) throw new Error('Release asset URL is required')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid release asset URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS download URLs are allowed')
  }
  const host = parsed.hostname.toLowerCase()
  const allowed = LLAMA_SERVER_RELEASE_ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  if (!allowed) {
    throw new Error(
      `Download host "${host}" is not allowlisted. Only official ggml-org/llama.cpp GitHub release assets are permitted.`,
    )
  }
  const pathLower = parsed.pathname.toLowerCase()
  if (!pathLower.endsWith('.zip')) {
    throw new Error('URL must point to a .zip release asset')
  }
  return parsed
}
