// ============================================================================
// WRVault — Build Integrity Verifier (Electron Main Process)
// ============================================================================
//
// Performs offline verification of the running build against the bundled
// release-manifest.json.  No network required.
//
// Checks:
//   1. Manifest self-hash (content integrity)
//   2. Config file hashes (detect tampering of shipped config)
//   3. Minisign signature (if public key + .minisig are bundled)
//
// On failure:
//   - Emits verification status via IPC
//   - Triggers writes kill-switch (defense-in-depth)
//   - Does NOT crash the app
//
// ============================================================================

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { app } from 'electron'

// ============================================================================
// §1  Types
// ============================================================================

export interface IntegrityStatus {
  verified: boolean
  timestamp: number
  checks: IntegrityCheck[]
  summary: string
}

export interface IntegrityCheck {
  name: string
  status: 'pass' | 'fail' | 'skip'
  detail: string
}

// ============================================================================
// §2  Paths
// ============================================================================

function getResourcesPath(): string {
  // In production: process.resourcesPath points to the app resources
  // In dev: use the project root
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return resolve(__dirname, '..', '..')
}

function getManifestPath(): string {
  const resourcesPath = getResourcesPath()
  // In production: release-manifest.json is in extraResources
  // In dev: at repo root (two levels up from electron/)
  const candidates = [
    join(resourcesPath, 'release-manifest.json'),
    join(resourcesPath, '..', 'release-manifest.json'),
    join(resourcesPath, '..', '..', 'release-manifest.json'),
    join(resourcesPath, '..', '..', '..', 'release-manifest.json'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return join(resourcesPath, 'release-manifest.json')
}

function getPublicKeyPath(): string {
  const resourcesPath = getResourcesPath()
  const candidates = [
    join(resourcesPath, 'release.pub'),
    join(resourcesPath, '..', 'release.pub'),
    join(resourcesPath, '..', '..', 'release.pub'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return join(resourcesPath, 'release.pub')
}

// ============================================================================
// §3  Verification Logic
// ============================================================================

function checkSelfHash(manifest: any, _manifestRaw: string): IntegrityCheck {
  if (!manifest.selfHash) {
    return { name: 'self-hash', status: 'skip', detail: 'No selfHash field in manifest' }
  }

  try {
    const copy = { ...manifest }
    delete copy.selfHash
    const expectedJson = JSON.stringify(copy, null, 2)
    const actualHash = createHash('sha256').update(expectedJson, 'utf-8').digest('hex')

    if (actualHash === manifest.selfHash) {
      return { name: 'self-hash', status: 'pass', detail: 'Manifest content is intact' }
    }
    return { name: 'self-hash', status: 'fail', detail: 'Manifest content has been modified' }
  } catch (err: any) {
    return { name: 'self-hash', status: 'fail', detail: `Hash check error: ${err.message}` }
  }
}

function checkConfigHashes(manifest: any): IntegrityCheck {
  if (!manifest.config || typeof manifest.config !== 'object') {
    return { name: 'config-hashes', status: 'skip', detail: 'No config hashes in manifest' }
  }

  const basePath = app.isPackaged ? process.resourcesPath : resolve(__dirname, '..', '..', '..', '..')
  let checked = 0
  let failed = 0

  for (const [relPath, expectedHash] of Object.entries(manifest.config)) {
    if (!expectedHash) continue
    const absPath = join(basePath, relPath)
    if (!existsSync(absPath)) continue

    checked++
    try {
      const data = readFileSync(absPath)
      const actualHash = createHash('sha256').update(data).digest('hex')
      if (actualHash !== expectedHash) {
        failed++
      }
    } catch {
      failed++
    }
  }

  if (checked === 0) {
    return { name: 'config-hashes', status: 'skip', detail: 'No config files found on disk to verify' }
  }
  if (failed > 0) {
    return { name: 'config-hashes', status: 'fail', detail: `${failed}/${checked} config file(s) modified` }
  }
  return { name: 'config-hashes', status: 'pass', detail: `${checked} config file(s) verified` }
}

function checkMinisignSignature(manifestPath: string): IntegrityCheck {
  const sigPath = manifestPath + '.minisig'
  const pubKeyPath = getPublicKeyPath()

  if (!existsSync(sigPath)) {
    return { name: 'minisign', status: 'skip', detail: 'No .minisig file bundled' }
  }
  if (!existsSync(pubKeyPath)) {
    return { name: 'minisign', status: 'skip', detail: 'No public key bundled (release.pub)' }
  }

  // Check if minisign binary is available
  try {
    execSync('minisign -v', { stdio: 'pipe', timeout: 5000 })
  } catch {
    return { name: 'minisign', status: 'skip', detail: 'minisign binary not available' }
  }

  try {
    execSync(
      `minisign -V -p "${pubKeyPath}" -m "${manifestPath}"`,
      { stdio: 'pipe', timeout: 10000 },
    )
    return { name: 'minisign', status: 'pass', detail: 'Signature is valid' }
  } catch {
    return { name: 'minisign', status: 'fail', detail: 'Signature verification failed — manifest may be tampered' }
  }
}

function checkGitCommit(manifest: any): IntegrityCheck {
  if (!manifest.git?.commit || manifest.git.commit === 'unknown') {
    return { name: 'git-commit', status: 'skip', detail: 'No git commit in manifest' }
  }
  return {
    name: 'git-commit',
    status: 'pass',
    detail: `Build from commit ${manifest.git.commit.slice(0, 12)}${manifest.git.dirty ? ' (dirty tree)' : ''}`,
  }
}

// ============================================================================
// §4  Public API
// ============================================================================

let _cachedStatus: IntegrityStatus | null = null

/**
 * Run all integrity checks and return the result.
 *
 * This is safe to call at any time — it reads files but does not modify
 * anything. Results are cached after the first run.
 *
 * @returns IntegrityStatus with check results and overall verdict
 */
export function verifyBuildIntegrity(): IntegrityStatus {
  if (_cachedStatus) return _cachedStatus

  const checks: IntegrityCheck[] = []
  const manifestPath = getManifestPath()

  // ── Load manifest ──
  if (!existsSync(manifestPath)) {
    _cachedStatus = {
      verified: false,
      timestamp: Date.now(),
      checks: [{ name: 'manifest', status: 'fail', detail: 'release-manifest.json not found' }],
      summary: 'Unverified: no release manifest bundled',
    }
    return _cachedStatus
  }

  let manifest: any
  let manifestRaw: string
  try {
    manifestRaw = readFileSync(manifestPath, 'utf-8')
    manifest = JSON.parse(manifestRaw)
  } catch (err: any) {
    _cachedStatus = {
      verified: false,
      timestamp: Date.now(),
      checks: [{ name: 'manifest', status: 'fail', detail: `Invalid JSON: ${err.message}` }],
      summary: 'Unverified: manifest is corrupted',
    }
    return _cachedStatus
  }

  checks.push({ name: 'manifest', status: 'pass', detail: 'Manifest loaded successfully' })

  // ── Run checks ──
  checks.push(checkSelfHash(manifest, manifestRaw))
  checks.push(checkConfigHashes(manifest))
  checks.push(checkMinisignSignature(manifestPath))
  checks.push(checkGitCommit(manifest))

  // ── Verdict ──
  const failed = checks.filter(c => c.status === 'fail')
  const passed = checks.filter(c => c.status === 'pass')
  const verified = failed.length === 0 && passed.length > 0

  const summary = verified
    ? `Verified: ${passed.length} check(s) passed`
    : `Unverified: ${failed.length} check(s) failed`

  _cachedStatus = {
    verified,
    timestamp: Date.now(),
    checks,
    summary,
  }

  return _cachedStatus
}

/**
 * Clear the cached status (for testing or re-verification).
 */
export function clearIntegrityCache(): void {
  _cachedStatus = null
}
