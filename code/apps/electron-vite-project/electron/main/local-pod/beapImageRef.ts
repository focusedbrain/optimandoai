/**
 * Canonical BEAP pod image reference + localhost alias handling.
 *
 * Podman on Windows/macOS often tags local builds as `localhost/beap-components:dev`
 * while pod.yaml and presence checks use `beap-components:dev`. Both must resolve.
 */

export const DEFAULT_BEAP_IMAGE = 'beap-components:dev'

/** All names that should refer to the same local image for a canonical ref. */
export function beapImageRefCandidates(imageRef = DEFAULT_BEAP_IMAGE): readonly string[] {
  const out: string[] = []
  const add = (ref: string) => {
    if (ref && !out.includes(ref)) out.push(ref)
  }

  add(imageRef)

  const slash = imageRef.indexOf('/')
  if (slash === -1) {
    add(`localhost/${imageRef}`)
    return out
  }

  const host = imageRef.slice(0, slash)
  const remainder = imageRef.slice(slash + 1)
  if (host === 'localhost' && remainder) {
    add(remainder)
  }

  return out
}

/** Primary name used in pod manifests after alias normalization. */
export function canonicalBeapImageRef(imageRef = DEFAULT_BEAP_IMAGE): string {
  const candidates = beapImageRefCandidates(imageRef)
  return candidates.find((c) => !c.startsWith('localhost/')) ?? candidates[0] ?? imageRef
}

/** Localhost-qualified alias for builds on Podman machine platforms. */
export function localhostBeapImageAlias(imageRef = DEFAULT_BEAP_IMAGE): string {
  const canonical = canonicalBeapImageRef(imageRef)
  return `localhost/${canonical}`
}

/** Podman build -t flags for canonical + localhost alias. */
export function beapImageBuildTags(imageRef = DEFAULT_BEAP_IMAGE): readonly string[] {
  const canonical = canonicalBeapImageRef(imageRef)
  const localhost = localhostBeapImageAlias(imageRef)
  return canonical === localhost ? [canonical] : [canonical, localhost]
}
