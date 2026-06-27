#!/usr/bin/env node
/**
 * CI guardrail: RFC1918 / 0.0.0.0 dial literals must not appear in self-call paths.
 * Cross-device advertisement and session bootstrap modules are allowlisted.
 *
 * Usage: node scripts/check-self-call-loopback.cjs
 *        pnpm run check:self-call-loopback
 */
const fs = require('node:fs')
const path = require('node:path')

const CODE_ROOT = path.resolve(__dirname, '..')
const SCAN_ROOT = path.join(CODE_ROOT, 'apps/electron-vite-project/electron/main')

const ALLOWLIST_SUFFIXES = [
  `${path.sep}internalInference${path.sep}hostAiOllamaDirectLanIp.ts`,
  `${path.sep}internalInference${path.sep}hostAiOllamaDirectAdvertisement.ts`,
  `${path.sep}internalInference${path.sep}p2pHostPolicyGet.ts`,
  `${path.sep}internalInference${path.sep}hostInferenceCapabilities.ts`,
  `${path.sep}p2p${path.sep}p2pConfig.ts`,
  `${path.sep}p2p${path.sep}coordinationUrlLocalDial.ts`,
]

const RFC1918_RE =
  /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/
const ZERO_DIAL_RE = /\b(?:https?|wss?):\/\/0\.0\.0\.0(?::|\/)/
const ANNOTATION = 'cross-device-lan-ok'

function isAllowlisted(absPath) {
  const norm = absPath.split(path.sep).join(path.sep)
  if (ALLOWLIST_SUFFIXES.some((s) => norm.endsWith(s.replace(/\//g, path.sep)))) return true
  if (norm.includes(`${path.sep}__tests__${path.sep}`)) return true
  if (norm.endsWith('.test.ts') || norm.endsWith('.test.tsx')) return true
  return false
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) {
      walk(abs, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(abs)
    }
  }
  return out
}

function checkFile(absPath) {
  if (isAllowlisted(absPath)) return []
  const rel = path.relative(CODE_ROOT, absPath)
  const lines = fs.readFileSync(absPath, 'utf8').split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes(ANNOTATION)) continue
    if (RFC1918_RE.test(line)) {
      hits.push({ rel, line: i + 1, kind: 'rfc1918', text: line.trim() })
    }
    if (ZERO_DIAL_RE.test(line)) {
      hits.push({ rel, line: i + 1, kind: '0.0.0.0-dial', text: line.trim() })
    }
  }
  return hits
}

function main() {
  const files = walk(SCAN_ROOT)
  const violations = files.flatMap(checkFile)
  console.log('=== Self-call loopback guardrail ===')
  console.log(`Scanned ${files.length} files under electron/main`)
  if (violations.length === 0) {
    console.log('PASS — no RFC1918 / 0.0.0.0 dial literals in self-call paths')
    process.exit(0)
  }
  console.error('FAIL — forbidden LAN / 0.0.0.0 dial literals (use loopback + cross-device-lan-ok to allow):')
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line} [${v.kind}] ${v.text}`)
  }
  process.exit(1)
}

main()
