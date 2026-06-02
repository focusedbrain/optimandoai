/**
 * Bare-Node smoke test for the guest bundle — proves the worker payload runs on
 * a plain Node runtime (what the golden image provides), with NO Electron, NO
 * vitest, NO crosvm. This is the one platform-agnostic slice of §3 that is
 * verifiable off-rig.
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
  Buffer.from('SECRET-PAYLOAD').toString('base64'),
  `--${boundary}--`,
  '',
].join('\r\n')

const job = {
  jobId: 'smoke-1',
  inputBytes_b64: Buffer.from(eml, 'utf8').toString('base64'),
  sandboxPeerX25519PubB64: sandboxPubB64,
}

const child = spawn(process.execPath, [bundle], { stdio: ['pipe', 'pipe', 'inherit'] })
let out = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.on('exit', (code) => {
  try {
    const result = JSON.parse(out)
    const checks = [
      ['exit code 0', code === 0],
      ['ok === true', result.ok === true],
      ['safeText schema', result.safeText?.schema === 'safe-text/v1'],
      ['body_text present', String(result.safeText?.body_text || '').includes('hello from bare node')],
      ['no plaintext leak in safeText', !JSON.stringify(result.safeText).includes('SECRET-PAYLOAD')],
      ['one encrypted artifact', (result.artifacts || []).length === 1],
      ['result signed', typeof result.result_signature_b64 === 'string'],
    ]
    let allPass = true
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
      if (!ok) allPass = false
    }
    console.log(allPass ? '\nSMOKE TEST PASSED (worker runs under bare Node)' : '\nSMOKE TEST FAILED')
    process.exitCode = allPass ? 0 : 1
  } catch (err) {
    console.error('could not parse worker output:', err, '\nraw:', out.slice(0, 400))
    process.exitCode = 1
  }
})
child.stdin.write(JSON.stringify(job))
child.stdin.end()
