/**
 * Bundle the depackaging worker + its guest entrypoint into ONE standalone JS
 * file for the golden image. The guest then runs `node worker-bundle.cjs` with
 * NO node_modules present — @noble/curves is bundled in; node `crypto` is the
 * only runtime dependency (built into Node).
 *
 * ── HERMETIC / REPRODUCIBLE BUILD (FIX-SPEC A, docs/build-specs/0021) ──────────
 * The committed `dist/worker-bundle.cjs` is the REFERENCE ARTIFACT. V0 is a
 * rebuild-and-diff: the canonical procedure below must reproduce it byte-for-byte.
 * Re-blessing a hash is rejected as risk routing — any diff is a STOP-and-report.
 *
 * CANONICAL BUILD PROCEDURE (run on the verification machine):
 *   1. Clean checkout for the guest-source paths:
 *        git status --porcelain -- \
 *          apps/electron-vite-project/electron/main/depackaging-microvm
 *      must be empty.
 *   2. Pinned toolchain from the lockfile — NEVER a floating install:
 *        pnpm install --frozen-lockfile      # (repo is pnpm; npm-equiv of `npm ci`)
 *   3. Build (run from the `code/` directory so input paths are stable):
 *        node apps/electron-vite-project/electron/main/depackaging-microvm/rig/buildWorkerBundle.mjs
 *   4. Verify byte-for-byte against the committed reference:
 *        git diff --exit-code -- \
 *          apps/electron-vite-project/electron/main/depackaging-microvm/rig/dist/worker-bundle.cjs
 *      (or `cmp` against a pristine copy). Any diff → STOP, report; never re-bless.
 *
 * DETERMINISM MEASURES (why the output is environment-independent):
 *   - esbuild version is PINNED and ASSERTED here (fail loudly on mismatch, INV-7).
 *   - esbuild's per-module path-banner comments (`// node_modules/…`, `// apps/…`)
 *     are STRIPPED post-build — they are the only location-sensitive content and
 *     vary if node_modules is symlinked / the build runs from another cwd.
 *   - no sourcemap, fixed `target`, fixed `charset`, LF line endings, no minify
 *     (stable, readable, diff-able), `legalComments:'none'`.
 *   - stable module order is esbuild-deterministic for identical inputs.
 *
 * Alongside the bundle the script writes `dist/worker-bundle.provenance.json`
 * (sha256 of every bundled input source, the lockfile hash, the esbuild version,
 * and this script's own hash). If byte-reproducibility ever breaks on a future
 * toolchain, provenance comparison localizes the cause instead of inviting a
 * re-bless.
 *
 * Platform-agnostic: this bundling + a bare-Node smoke run is verifiable off-rig
 * (Windows/macOS/Linux). It does NOT need crosvm — it proves the guest payload.
 */

import { build, version as esbuildVersion } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(here, 'dist', 'worker-bundle.cjs')
const provenanceFile = path.join(here, 'dist', 'worker-bundle.provenance.json')

// ── Toolchain pin (INV-7: assert, never silently drift) ────────────────────────
const EXPECTED_ESBUILD = '0.21.5'
if (esbuildVersion !== EXPECTED_ESBUILD) {
  console.error(
    `[buildWorkerBundle] FATAL: esbuild version mismatch — expected ${EXPECTED_ESBUILD}, got ${esbuildVersion}.\n` +
      `The reproducible build is pinned to esbuild ${EXPECTED_ESBUILD}. Run \`pnpm install --frozen-lockfile\` ` +
      `from the canonical lockfile, or update EXPECTED_ESBUILD + the committed bundle together in one reviewed commit.`,
  )
  process.exit(1)
}

/** Walk up from `here` to the repo `code/` dir (the one holding pnpm-lock.yaml). */
function findLockfile(start) {
  let dir = start
  for (let i = 0; i < 12; i++) {
    const p = path.join(dir, 'pnpm-lock.yaml')
    if (fs.existsSync(p)) return p
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function sha256File(p) {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex')
}

/**
 * Strip esbuild's per-module path-banner comments. These are the ONLY
 * location-sensitive lines in the output. They have a distinctive shape — a
 * column-0 `// <path>` whose payload is a single whitespace-free token ending in
 * a source extension — which never matches the library's own inline/prose
 * comments (those are indented and/or contain spaces and don't end in .ts/.js).
 */
function stripModuleBanners(text) {
  const bannerRe = /^\/\/ \S+\.(?:c?[jt]s|mjs)$/
  return text
    .split('\n')
    .filter((line) => !bannerRe.test(line))
    .join('\n')
}

const result = await build({
  entryPoints: [path.join(here, 'guestEntry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  charset: 'utf8',
  sourcemap: false,
  minify: false,
  write: false,
  metafile: true,
  // electron is never reachable from the worker path (only type-only imports of
  // QuarantineBlobFile, which esbuild erases). Mark it external defensively so a
  // stray import can never silently pull the electron runtime into the guest.
  external: ['electron'],
  legalComments: 'none',
  logLevel: 'warning',
})

const raw = result.outputFiles.find((f) => f.path.endsWith('worker-bundle.cjs')) ?? result.outputFiles[0]
const cleaned = stripModuleBanners(raw.text)

fs.mkdirSync(path.dirname(outfile), { recursive: true })
fs.writeFileSync(outfile, cleaned, 'utf8')

// ── Provenance (belt and suspenders) ───────────────────────────────────────────
const lockfile = findLockfile(here)
const codeRoot = lockfile ? path.dirname(lockfile) : process.cwd()

// metafile.inputs keys are relative to cwd; resolve, hash, and record each
// relative to the repo `code/` root so provenance is location-independent.
const inputs = {}
for (const key of Object.keys(result.metafile.inputs).sort()) {
  const abs = path.resolve(process.cwd(), key)
  if (!fs.existsSync(abs)) continue
  const rel = path.relative(codeRoot, abs).split(path.sep).join('/')
  inputs[rel] = sha256File(abs)
}

const provenance = {
  artifact: 'worker-bundle.cjs',
  artifact_sha256: createHash('sha256').update(Buffer.from(cleaned, 'utf8')).digest('hex'),
  esbuild_version: esbuildVersion,
  build_script_sha256: sha256File(fileURLToPath(import.meta.url)),
  lockfile: lockfile ? path.relative(codeRoot, lockfile).split(path.sep).join('/') : null,
  lockfile_sha256: lockfile ? sha256File(lockfile) : null,
  determinism: {
    module_banners_stripped: true,
    sourcemap: false,
    minify: false,
    target: 'node18',
    charset: 'utf8',
    line_endings: 'lf',
  },
  inputs,
}

// Pretty-print with sorted keys; no timestamps → the provenance file is itself
// reproducible.
fs.writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2) + '\n', 'utf8')

console.log(`[buildWorkerBundle] wrote ${path.relative(codeRoot, outfile)}`)
console.log(`[buildWorkerBundle]   sha256 = ${provenance.artifact_sha256}`)
console.log(`[buildWorkerBundle]   esbuild = ${esbuildVersion}, inputs = ${Object.keys(inputs).length}`)
console.log(`[buildWorkerBundle] wrote ${path.relative(codeRoot, provenanceFile)}`)
