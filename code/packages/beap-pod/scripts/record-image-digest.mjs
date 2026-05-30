#!/usr/bin/env node
/**
 * Record beap-components:dev OCI digest into expected-image-digest.json after build.
 *
 * Usage (from repo root):
 *   node packages/beap-pod/scripts/record-image-digest.mjs
 *   pnpm --filter @repo/beap-pod run record-image-digest
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_BEAP_IMAGE, beapImageRefCandidates, resolvePodmanImageRef } from './beap-image-ref.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const digestPath = join(__dirname, '..', 'expected-image-digest.json')
const imageRef = process.env.BEAP_IMAGE_REF ?? DEFAULT_BEAP_IMAGE
const canonical = beapImageRefCandidates(imageRef).find((c) => !c.startsWith('localhost/')) ?? imageRef
const [name, tag = 'dev'] = canonical.split(':', 2)

let digest
const inspectRef =
  resolvePodmanImageRef(beapImageRefCandidates(imageRef), (ref) => {
    digest = execFileSync('podman', ['image', 'inspect', ref, '--format', '{{.Digest}}'], {
      encoding: 'utf8',
    }).trim()
    return ref
  }) ?? null

if (!inspectRef) {
  console.error(`Failed to inspect ${imageRef} (or localhost/ alias). Build the image first.`)
  process.exit(1)
}

if (!digest.startsWith('sha256:')) {
  console.error(`Unexpected digest from podman: ${digest}`)
  process.exit(1)
}

let doc = { 'beap-components': {} }
try {
  doc = JSON.parse(readFileSync(digestPath, 'utf8'))
} catch {
  /* new file */
}
if (!doc[name]) doc[name] = {}
doc[name][tag] = digest
doc._doc =
  'Expected OCI digest for beap-components images. Update via record-image-digest after podman build.'

writeFileSync(digestPath, `${JSON.stringify(doc, null, 2)}\n`)
console.log(`Updated ${digestPath}: ${imageRef} → ${digest}`)
