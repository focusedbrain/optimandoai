'use strict'

/**
 * Fail the desktop build early when BEAP pod assets required for extraResources are missing.
 */

const fs = require('fs')
const path = require('path')

const workspaceRoot = path.resolve(__dirname, '../../..')
const beapPodDir = path.join(workspaceRoot, 'packages', 'beap-pod')

const REQUIRED = [
  'pod.yaml',
  'pod-local-verify.yaml',
  'pod-remote-edge.yaml',
  'expected-image-digest.json',
  'seccomp/sealer.json',
  'seccomp/depackager.json',
  'seccomp/pdf-parser.json',
  'seccomp/certifier.json',
]

if (!fs.existsSync(beapPodDir)) {
  console.error('[prepare-beap-pod-packaging] packages/beap-pod not found at', beapPodDir)
  process.exit(1)
}

const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(beapPodDir, rel)))
if (missing.length > 0) {
  console.error(
    '[prepare-beap-pod-packaging] Missing BEAP pod assets (electron-builder extraResources):',
    missing.join(', '),
  )
  process.exit(1)
}

console.log('[prepare-beap-pod-packaging] OK — BEAP pod assets ready for packaging')
