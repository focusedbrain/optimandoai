/**
 * Bare-Node smoke test for the guest bundle — proves the worker payload runs on
 * a plain Node runtime (what the golden image provides), with NO Electron, NO
 * vitest, NO crosvm. This is the one platform-agnostic slice of §3 that is
 * verifiable off-rig.
 *
 * Covers ALL THREE guest parse paths (FIX-SPEC A, docs/build-specs/0021 §A.4):
 *   1. `depackage`                       — B1 default (runDepackagingJob, RFC822 MIME)
 *   2. `depackage-email` rfc822          — B2 email worker (depackageEmail)
 *   3. `depackage-email` structured-json — B2.1 D4 walker (depackageEmailStructured, outlook)
 *
 * Run:  node apps/electron-vite-project/electron/main/depackaging-microvm/rig/smokeTest.mjs
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { x25519 } from '@noble/curves/ed25519'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundle = path.join(here, 'dist', 'worker-bundle.cjs')

const sandboxPubB64 = Buffer.from(x25519.getPublicKey(x25519.utils.randomPrivateKey())).toString('base64')

const SECRET = 'SECRET-PAYLOAD'
const boundary = 'B0UND'
const eml = [
  'Subject: smoke test',
  'MIME-Version: 1.0',
  `Content-Type: multipart/mixed; boundary="${boundary}"`,
  '',
  `--${boundary}`,
  'Content-Type: text/plain',
  '',
  'hello from bare node',
  `--${boundary}`,
  'Content-Type: application/octet-stream',
  'Content-Disposition: attachment; filename="a.bin"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from(SECRET).toString('base64'),
  `--${boundary}--`,
  '',
].join('\r\n')
const emlB64 = Buffer.from(eml, 'utf8').toString('base64')

// Minimal Outlook Graph message resource (provider-structured-json form).
const graphJson = JSON.stringify({
  subject: 'smoke test',
  internetMessageId: '<smoke-1@bare.node>',
  toRecipients: [{ emailAddress: { name: 'A', address: 'a@example.com' } }],
  body: { contentType: 'text', content: 'hello from bare node' },
  attachments: [
    {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'a.bin',
      contentType: 'application/octet-stream',
      contentBytes: Buffer.from(SECRET).toString('base64'),
    },
  ],
})

/** A `JobResult` for path 1, or `{result: DepackageEmailResult}` for paths 2/3. */
function unwrap(out) {
  const o = JSON.parse(out)
  return o.result ?? o
}

function runJob(job) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle], { stdio: ['pipe', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code, out }))
    child.stdin.write(JSON.stringify(job))
    child.stdin.end()
  })
}

function checkResult(label, code, out, expectSignature) {
  let r
  try {
    r = unwrap(out)
  } catch (err) {
    console.log(`FAIL  [${label}] could not parse worker output: ${err}\n      raw: ${out.slice(0, 300)}`)
    return false
  }
  const safeTextStr = JSON.stringify(r.safeText ?? null)
  const checks = [
    ['exit code 0', code === 0],
    ['ok === true', r.ok === true],
    ['safeText schema', r.safeText?.schema === 'safe-text/v1'],
    ['body_text present', String(r.safeText?.body_text || '').includes('hello from bare node')],
    ['no plaintext leak in safeText', !safeTextStr.includes(SECRET)],
    ['one encrypted artifact', (r.artifacts || []).length === 1],
  ]
  // Only the B1 `depackage` path produces the in-guest signed JobResult; the
  // email worker returns a DepackageEmailResult that is signed downstream.
  if (expectSignature) {
    checks.push(['result signed', typeof r.result_signing_pub_b64 === 'string' && typeof r.result_signature_b64 === 'string'])
  }
  let pass = true
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${label}] ${name}`)
    if (!ok) pass = false
  }
  return pass
}

const paths = [
  { label: 'depackage', expectSignature: true, job: { jobId: 'smoke-1', inputBytes_b64: emlB64, sandboxPeerX25519PubB64: sandboxPubB64 } },
  {
    label: 'depackage-email/rfc822',
    expectSignature: false,
    job: { jobId: 'smoke-2', kind: 'depackage-email', inputForm: 'rfc822', inputBytes_b64: emlB64, sandboxPeerX25519PubB64: sandboxPubB64 },
  },
  {
    label: 'depackage-email/structured-json',
    expectSignature: false,
    job: {
      jobId: 'smoke-3',
      kind: 'depackage-email',
      inputForm: 'provider-structured-json',
      provider: 'outlook',
      inputBytes_b64: Buffer.from(graphJson, 'utf8').toString('base64'),
      sandboxPeerX25519PubB64: sandboxPubB64,
    },
  },
]

let allPass = true
for (const { label, job, expectSignature } of paths) {
  const { code, out } = await runJob(job)
  if (!checkResult(label, code, out, expectSignature)) allPass = false
}
console.log(
  allPass
    ? '\nSMOKE TEST PASSED — all three parse paths run under bare Node'
    : '\nSMOKE TEST FAILED',
)
process.exitCode = allPass ? 0 : 1
