#!/usr/bin/env node
/**
 * Record beap-components:dev digest into agent expected-image-digest.json and install.sh reference.
 *
 * Usage (from repo root):
 *   pnpm --filter @app/edge-agent run update-image-digest
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const digestPath = join(root, 'expected-image-digest.json')
const installPath = join(root, 'install', 'install.sh')
const imageRef = process.env.BEAP_IMAGE_REF ?? 'beap-components:dev'
const [name, tag = 'dev'] = imageRef.split(':', 2)

const digest = execFileSync('podman', ['image', 'inspect', imageRef, '--format', '{{.Digest}}'], {
  encoding: 'utf8',
}).trim()

if (!digest.startsWith('sha256:')) {
  console.error(`Unexpected digest: ${digest}`)
  process.exit(1)
}

let doc = { 'beap-components': {} }
try {
  doc = JSON.parse(readFileSync(digestPath, 'utf8'))
} catch {
  /* new */
}
if (!doc[name]) doc[name] = {}
doc[name][tag] = digest
doc._doc =
  'Expected OCI digest for beap-components on Edge Agent. Update via update-image-digest after podman build.'
writeFileSync(digestPath, `${JSON.stringify(doc, null, 2)}\n`)

let install = readFileSync(installPath, 'utf8')
const pullLine = `podman pull ${imageRef}@sha256:${digest.replace('sha256:', '')}`
if (/podman pull beap-components@sha256:/.test(install)) {
  install = install.replace(/podman pull beap-components@sha256:[a-f0-9]+.*/g, pullLine)
} else if (/BEAP_IMAGE_DIGEST=/.test(install)) {
  install = install.replace(/BEAP_IMAGE_DIGEST=.*/g, `BEAP_IMAGE_DIGEST="${digest}"`)
} else {
  install += `\n# Image digest (update with update-image-digest.mjs)\nBEAP_IMAGE_DIGEST="${digest}"\n${pullLine}\n`
}
writeFileSync(installPath, install)

console.log(`Updated ${digestPath} and ${installPath}: ${imageRef} → ${digest}`)
