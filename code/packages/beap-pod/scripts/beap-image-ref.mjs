/**
 * Image ref aliases — shared by packaging scripts (Node, no TS build step).
 */

export const DEFAULT_BEAP_IMAGE = 'beap-components:dev'

export function beapImageRefCandidates(imageRef = DEFAULT_BEAP_IMAGE) {
  const out = []
  const add = (ref) => {
    if (ref && !out.includes(ref)) out.push(ref)
  }
  add(imageRef)
  const slash = imageRef.indexOf('/')
  if (slash === -1) {
    add(`localhost/${imageRef}`)
  } else if (imageRef.startsWith('localhost/')) {
    add(imageRef.slice('localhost/'.length))
  }
  return out
}

export function beapImageBuildTags(imageRef = DEFAULT_BEAP_IMAGE) {
  const candidates = beapImageRefCandidates(imageRef)
  const canonical = candidates.find((c) => !c.startsWith('localhost/')) ?? candidates[0]
  const localhost = `localhost/${canonical}`
  return canonical === localhost ? [canonical] : [canonical, localhost]
}

export function resolvePodmanImageRef(candidates, runInspect) {
  for (const candidate of candidates) {
    try {
      runInspect(candidate)
      return candidate
    } catch {
      /* try next */
    }
  }
  return null
}

export function ensurePodmanImageAliases(imageRef, run) {
  const present = resolvePodmanImageRef(beapImageRefCandidates(imageRef), (ref) => {
    run(['image', 'inspect', ref])
  })
  if (!present) return false
  for (const alias of beapImageRefCandidates(imageRef)) {
    if (alias === present) continue
    try {
      run(['image', 'inspect', alias])
    } catch {
      run(['tag', present, alias])
    }
  }
  return true
}
