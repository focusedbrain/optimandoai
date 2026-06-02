/**
 * Bundle the depackaging worker + its guest entrypoint into ONE standalone JS
 * file for the golden image. The guest then runs `node worker-bundle.cjs` with
 * NO node_modules present — @noble/curves is bundled in; node `crypto` is the
 * only runtime dependency (built into Node).
 *
 * Run:  node apps/electron-vite-project/electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
 * Out:  rig/dist/worker-bundle.cjs   (copy this into the rootfs alongside a node binary)
 *
 * Platform-agnostic: this bundling + a bare-Node smoke run is verifiable off-rig
 * (Windows/macOS/Linux). It does NOT need crosvm — it proves the guest payload.
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [path.join(here, 'guestEntry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(here, 'dist', 'worker-bundle.cjs'),
  // electron is never reachable from the worker path (only type-only imports of
  // QuarantineBlobFile, which esbuild erases). Mark it external defensively so a
  // stray import can never silently pull the electron runtime into the guest.
  external: ['electron'],
  legalComments: 'none',
  logLevel: 'info',
})

console.log('[buildWorkerBundle] wrote rig/dist/worker-bundle.cjs')
