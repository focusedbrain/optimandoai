#!/usr/bin/env node
/**
 * CI gate — untrusted BEAP capsule bytes must not be handled in the Electron main process.
 * See SECURITY/ISOLATION.md.
 *
 * Usage: node scripts/check-beap-pod-isolation-gate.mjs
 * Exit 0 = pass, 1 = violations (fails the build).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const ELECTRON_MAIN = join(ROOT, 'apps/electron-vite-project/electron/main')
const MODE_RESOLVER = join(ELECTRON_MAIN, 'ingestion/modeResolver.ts')
const DISPATCHER = join(ELECTRON_MAIN, 'ingestion/ingestionDispatcher.ts')
const IN_PROCESS = join(ELECTRON_MAIN, 'ingestion/processIncomingInputInProcess.ts')

const ALLOWED_INGESTION_MODES = ['EdgeActive', 'HostPodActive', 'Blocked']
const FORBIDDEN_MODE_STRINGS = [
  'LegacyInProcess',
  'Legacy_In_Process',
  'InProcessUntrusted',
  'InProcessExternal',
  'HostInProcess',
]

const ENTRYPOINT_FILES = [
  'p2p/coordinationWs.ts',
  'p2p/relayPull.ts',
  'p2p/p2pServer.ts',
  'handshake/ipc.ts',
  'ingestion/ipc.ts',
  'email/beapEmailIngestion.ts',
  'email/messageRouter.ts',
]

/** Production .ts under electron/main (excludes __tests__). */
function collectProductionTsFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...collectProductionTsFiles(full))
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

function rel(p) {
  return relative(ROOT, p).replace(/\\/g, '/')
}

/** Remove comments and inline-code spans so doc references do not false-positive as calls. */
function codeOnlyForScan(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/`[^`]*`/g, '``')
}

/**
 * @param {{ injectModeResolverSuffix?: string }} [opts] — test hook: simulate a bypass commit
 */
export function runBeapPodIsolationGate(opts = {}) {
  const violations = []

  // ── 1. IngestionMode type + forbidden legacy modes ─────────────────────────
  let modeResolverSrc = readFileSync(MODE_RESOLVER, 'utf8')
  if (opts.injectModeResolverSuffix) {
    modeResolverSrc += opts.injectModeResolverSuffix
  } else if (process.env.BEAP_GATE_INJECT_LEGACY === '1') {
    modeResolverSrc += "\nexport type IngestionMode = 'LegacyInProcess' | 'Blocked'\n"
  }

  const typeMatch = modeResolverSrc.match(
    /export\s+type\s+IngestionMode\s*=\s*([^;\n]+)/,
  )
  if (!typeMatch) {
    violations.push('modeResolver.ts: missing export type IngestionMode')
  } else {
    const typeBody = typeMatch[1]
    for (const forbidden of FORBIDDEN_MODE_STRINGS) {
      if (typeBody.includes(forbidden) || modeResolverSrc.includes(`'${forbidden}'`)) {
        violations.push(`modeResolver.ts: forbidden ingestion mode "${forbidden}" in type or source`)
      }
    }
    for (const allowed of ALLOWED_INGESTION_MODES) {
      if (!typeBody.includes(allowed)) {
        violations.push(`modeResolver.ts: IngestionMode must include "${allowed}"`)
      }
    }
  }

  for (const forbidden of FORBIDDEN_MODE_STRINGS) {
    if (modeResolverSrc.includes(`return '${forbidden}'`) || modeResolverSrc.includes(`return "${forbidden}"`)) {
      violations.push(`modeResolver.ts: resolveIngestionMode must not return "${forbidden}"`)
    }
  }

  // ── 2. Untrusted crypto / validate — no direct calls outside allowlist ─────
  const allFiles = collectProductionTsFiles(ELECTRON_MAIN)

  const decryptQBeapAllowed = new Set([
    rel(join(ELECTRON_MAIN, 'beap/decryptQBeapPackage.ts')),
  ])

  const validateCapsuleAllowed = new Set([
    rel(IN_PROCESS),
    rel(join(ELECTRON_MAIN, 'ingestion/index.ts')),
  ])

  const inProcessAllowed = new Set([
    rel(IN_PROCESS),
    rel(DISPATCHER),
  ])

  const decryptQuarantineAllowed = new Set([
    rel(join(ELECTRON_MAIN, 'quarantine-encrypt/index.ts')),
  ])

  for (const filePath of allFiles) {
    const r = rel(filePath)
    const content = readFileSync(filePath, 'utf8')
    const scanned = codeOnlyForScan(content)
    const base = basename(filePath)

    if (/decryptQBeapPackage\s*\(/.test(scanned) && !decryptQBeapAllowed.has(r)) {
      violations.push(`${r}: decryptQBeapPackage() — untrusted depackage must use dispatchDepackageQBeap → pod only`)
    }

    if (/validateCapsule\s*\(/.test(scanned) && !validateCapsuleAllowed.has(r)) {
      violations.push(`${r}: validateCapsule() on raw input outside trusted in-process module`)
    }

    if (/processIncomingInputInProcess\s*\(/.test(scanned) && !inProcessAllowed.has(r)) {
      violations.push(`${r}: processIncomingInputInProcess() — only ingestionDispatcher may call this`)
    }

    if (/decryptQuarantineBlob\s*\(/.test(scanned) && !decryptQuarantineAllowed.has(r)) {
      violations.push(`${r}: decryptQuarantineBlob() — quarantine inner decrypt must stay in pod path (blocked in beapEmailIngestion)`)
    }

    for (const forbidden of FORBIDDEN_MODE_STRINGS) {
      if (base === 'modeResolver.ts' || base === 'securityInvariant.ts') continue
      if (content.includes(forbidden)) {
        violations.push(`${r}: references forbidden mode string "${forbidden}"`)
      }
    }
  }

  // ── 3. Dispatcher must not route external input to in-process ───────────────
  const dispatcherSrc = readFileSync(DISPATCHER, 'utf8')
  if (!dispatcherSrc.includes('sourceType === \'internal\'')) {
    violations.push('ingestionDispatcher.ts: missing internal-only branch for processIncomingInputInProcess')
  }
  if (/processIncomingInputInProcess\s*\([^)]*sourceType/.test(dispatcherSrc)) {
    const block = dispatcherSrc.slice(
      dispatcherSrc.indexOf('export async function dispatchProcessIncomingInput'),
      dispatcherSrc.indexOf('export async function dispatchDepackageQBeap'),
    )
    if (!block.includes("if (sourceType === 'internal')")) {
      violations.push('ingestionDispatcher.ts: processIncomingInputInProcess must be guarded by sourceType === internal')
    }
  }
  if (/LegacyInProcess|legacyInProcess|legacy_in_process/.test(dispatcherSrc)) {
    violations.push('ingestionDispatcher.ts: must not reference LegacyInProcess routing')
  }

  // ── 4. Main BEAP entry points must use processIncomingInput / pod depackage ─
  for (const entry of ENTRYPOINT_FILES) {
    const p = join(ELECTRON_MAIN, entry)
    const content = readFileSync(p, 'utf8')
    const usesPipeline =
      content.includes('processIncomingInput(') || content.includes('dispatchDepackageQBeap(')
    if (!usesPipeline) {
      violations.push(`${rel(p)}: BEAP entry point must call processIncomingInput or dispatchDepackageQBeap`)
    }
    if (/decryptQBeapPackage\s*\(/.test(codeOnlyForScan(content))) {
      violations.push(`${rel(p)}: must not call decryptQBeapPackage directly`)
    }
    if (/processIncomingInputInProcess\s*\(/.test(codeOnlyForScan(content))) {
      violations.push(`${rel(p)}: must not bypass dispatcher with processIncomingInputInProcess`)
    }
  }

  // ── 5. Runtime invariant module present ───────────────────────────────────
  const invariantPath = join(ELECTRON_MAIN, 'security/securityInvariant.ts')
  try {
    const inv = readFileSync(invariantPath, 'utf8')
    if (!inv.includes('SecurityInvariantError')) {
      violations.push('security/securityInvariant.ts: missing SecurityInvariantError')
    }
    if (!inv.includes('assertExternalUntrustedViaPodOnly')) {
      violations.push('security/securityInvariant.ts: missing assertExternalUntrustedViaPodOnly')
    }
  } catch {
    violations.push('security/securityInvariant.ts: missing (required for runtime defense)')
  }

  if (!dispatcherSrc.includes('assertExternalUntrustedViaPodOnly')) {
    violations.push('ingestionDispatcher.ts: must call assertExternalUntrustedViaPodOnly before external dispatch')
  }
  const inProcessSrc = readFileSync(IN_PROCESS, 'utf8')
  if (!inProcessSrc.includes('assertTrustedInternalSourceOnly')) {
    violations.push('processIncomingInputInProcess.ts: must call assertTrustedInternalSourceOnly')
  }

  // ── 6. Forbidden main-process untrusted depackage / PDF parse helpers ───────
  const beapEmailIngestionPath = join(ELECTRON_MAIN, 'email/beapEmailIngestion.ts')
  let beapEmailIngestionSrc = readFileSync(beapEmailIngestionPath, 'utf8')
  if (process.env.BEAP_GATE_INJECT_PBEAP_DECODE === '1') {
    beapEmailIngestionSrc +=
      "\nexport function beapPackageToMainProcessDepackaged() { Buffer.from('x'.payload,'base64'); return { depackaged_json: null, depackaged_metadata: '{}' } }\n"
  }
  const beapEmailScanned = codeOnlyForScan(beapEmailIngestionSrc)

  if (/beapPackageToMainProcessDepackaged/.test(beapEmailIngestionSrc)) {
    violations.push(
      'beapEmailIngestion.ts: beapPackageToMainProcessDepackaged removed — use pod depackage only',
    )
  }
  if (/extractPBeapCapsule/.test(beapEmailIngestionSrc)) {
    violations.push('beapEmailIngestion.ts: extractPBeapCapsule removed — use pod depackage only')
  }
  if (/Buffer\.from\s*\(\s*[^,]+\.payload\s*,\s*['"]base64['"]\s*\)/.test(beapEmailScanned)) {
    violations.push(
      'beapEmailIngestion.ts: main-process pBEAP base64 decode forbidden — use dispatchDepackageQBeap',
    )
  }

  const pdfExtractAllowed = new Set([
    rel(join(ELECTRON_MAIN, 'email/pdfExtractInProcess.ts')),
  ])

  for (const filePath of allFiles) {
    const r = rel(filePath)
    const scanned = codeOnlyForScan(readFileSync(filePath, 'utf8'))
    if (/extractPdfTextInProcess\s*\(/.test(scanned) && !pdfExtractAllowed.has(r)) {
      violations.push(
        `${r}: extractPdfTextInProcess() — untrusted PDF must use pod depackager (pdfPodClient)`,
      )
    }
  }

  // ── 7. Relay coordination-service — no in-process capsule validation bypass ─
  const coordServerPath = join(ROOT, 'packages/coordination-service/src/server.ts')
  const coordPreflightPath = join(
    ROOT,
    'packages/coordination-service/src/relayPodIsolationPreflight.ts',
  )
  try {
    const coordServer = readFileSync(coordServerPath, 'utf8')
    const coordPreflight = readFileSync(coordPreflightPath, 'utf8')

    if (/validateInput\s*\(/.test(codeOnlyForScan(coordServer))) {
      violations.push(
        'coordination-service/server.ts: validateInput() forbidden — relay capsules must use validateRelayCapsuleViaIngestor only',
      )
    }
    if (!coordServer.includes('validateRelayCapsuleViaIngestor')) {
      violations.push(
        'coordination-service/server.ts: must call validateRelayCapsuleViaIngestor for relay capsules',
      )
    }
    if (/COORD_BEAP_ISOLATION_SKIP/.test(coordPreflight) && /isRelayIsolationPreflightSkipped/.test(coordPreflight)) {
      const skipBlock = coordPreflight.slice(
        coordPreflight.indexOf('export function isRelayIsolationPreflightSkipped'),
        coordPreflight.indexOf('export async function runRelayPodIsolationPreflight'),
      )
      if (skipBlock.includes('COORD_BEAP_ISOLATION_SKIP')) {
        violations.push(
          'relayPodIsolationPreflight.ts: COORD_BEAP_ISOLATION_SKIP must not skip isolation (fatal at startup only)',
        )
      }
    }
    if (!coordPreflight.includes('COORD_BEAP_ISOLATION_SKIP')) {
      violations.push(
        'relayPodIsolationPreflight.ts: must fatal-exit when COORD_BEAP_ISOLATION_SKIP is set',
      )
    }
  } catch {
    violations.push('coordination-service isolation gate: missing server.ts or relayPodIsolationPreflight.ts')
  }

  return { ok: violations.length === 0, violations }
}

function main() {
  const { ok, violations } = runBeapPodIsolationGate()
  if (ok) {
    console.log('[beap-pod-isolation-gate] OK — untrusted capsule bytes confined to pod path')
    process.exit(0)
  }
  console.error('[beap-pod-isolation-gate] FATAL — isolation boundary violated:')
  for (const v of violations) {
    console.error(`  - ${v}`)
  }
  console.error('[beap-pod-isolation-gate] See SECURITY/ISOLATION.md')
  process.exit(1)
}

if (process.argv[1]?.includes('check-beap-pod-isolation-gate.mjs')) {
  main()
}
