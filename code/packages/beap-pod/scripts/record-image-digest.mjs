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

const __dirname = dirname(fileURLToPath(import.meta.url))
const digestPath = join(__dirname, '..', 'expected-image-digest.json')
const imageRef = process.env.BEAP_IMAGE_REF ?? 'beap-components:dev'
const [name, tag = 'dev'] = imageRef.split(':', 2)

let digest
try {
  digest = execFileSync('podman', ['image', 'inspect', imageRef, '--format', '{{.Digest}}'], {
    encoding: 'utf8',
  }).trim()
} catch (err) {
  console.error(`Failed to inspect ${imageRef}. Build the image first.`, err.message ?? err)
  process.exit(1)
}

if (!digest.startsWith('sha256:')) {
  console.error(`Unexpected digest from podman: ${digest}`)
  process.exit(1)
}

let doc = { beap-components: {} }
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
