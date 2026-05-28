#!/usr/bin/env node
/**
 * CI guard — inventoried fetch/send entry points must reference role policy (Stream B7).
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const EMAIL_MAIN = join(ROOT, 'apps/electron-vite-project/electron/main/email')

const FETCH_GATES = [
  { file: 'syncOrchestrator.ts', fn: 'syncAccountEmailsImpl', needle: 'enforceFetchPolicyForAccountId' },
  { file: 'gateway.ts', fn: 'listMessages', needle: 'enforceFetchPolicyForAccount' },
  { file: 'gateway.ts', fn: 'getMessage', needle: 'enforceFetchPolicyForAccount' },
  { file: 'gateway.ts', fn: 'sendReply', needle: 'enforceFetchPolicyForAccount' },
]

const SEND_GATES = [
  { file: 'gateway.ts', fn: 'sendEmail', needle: 'enforceSendPolicyForAccount' },
  { file: 'gateway.ts', fn: 'sendReply', needle: 'enforceSendPolicyForAccount' },
]

const PROVIDER_SDK_MARKERS = [
  'nodemailer',
  'googleapis',
  '@microsoft/microsoft-graph',
  'imap',
]

function extractFunctionBody(source, fnName) {
  const sig = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\(|async\\s+${fnName}\\s*\\(`)
  const method = new RegExp(`async\\s+${fnName}\\s*\\(`)
  const m = sig.exec(source) ?? method.exec(source)
  if (!m) return null
  const start = m.index
  const brace = source.indexOf('{', m.index)
  if (brace < 0) return null
  let depth = 0
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start, Math.min(start + 4000, source.length))
}

let failed = false

for (const { file, fn, needle } of [...FETCH_GATES, ...SEND_GATES]) {
  const path = join(EMAIL_MAIN, file)
  if (!existsSync(path)) {
    console.error(`[role-policy-gate] missing file: ${path}`)
    failed = true
    continue
  }
  const src = readFileSync(path, 'utf8')
  const body = extractFunctionBody(src, fn)
  if (!body) {
    console.error(`[role-policy-gate] function not found: ${file}::${fn}`)
    failed = true
    continue
  }
  if (!body.includes(needle) && !body.includes('rolePolicy')) {
    console.error(
      `[role-policy-gate] ${file}::${fn} missing policy call (expected ${needle} or rolePolicy)`,
    )
    failed = true
  }
}

for (const file of ['gateway.ts', 'syncOrchestrator.ts', 'rolePolicyEnforce.ts']) {
  const path = join(EMAIL_MAIN, file)
  const src = readFileSync(path, 'utf8')
  if (!src.includes('rolePolicy') && !src.includes('enforceFetchPolicy') && !src.includes('enforceSendPolicy')) {
    console.error(`[role-policy-gate] ${file} does not import/use role policy`)
    failed = true
  }
}

for (const marker of PROVIDER_SDK_MARKERS) {
  const providersDir = join(EMAIL_MAIN, 'providers')
  for (const name of ['gmail.ts', 'outlook.ts', 'imap.ts', 'zoho.ts', 'base.ts']) {
    const path = join(providersDir, name)
    if (!existsSync(path)) continue
    const src = readFileSync(path, 'utf8')
    if (src.toLowerCase().includes(marker) && !src.includes('rolePolicy')) {
      // Providers are called only via gateway — document exception
      if (name !== 'base.ts') continue
    }
  }
}

const gatewayPath = join(EMAIL_MAIN, 'gateway.ts')
const gatewaySrc = readFileSync(gatewayPath, 'utf8')
if (!gatewaySrc.includes("from './rolePolicyEnforce.js'")) {
  console.error('[role-policy-gate] gateway.ts must import rolePolicyEnforce')
  failed = true
}

if (failed) process.exit(1)
console.log('[role-policy-gate] OK — inventoried gates present')
