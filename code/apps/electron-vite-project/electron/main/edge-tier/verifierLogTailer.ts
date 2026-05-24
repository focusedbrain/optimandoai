/**
 * Tail verifier container stdout for JSON audit lines — Phase 3 (P3.10).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { DEFAULT_LOCAL_VERIFY_POD_NAME } from '../local-pod/podRunner.js'
import { ingestVerifierLogLine } from './verificationAudit.js'
import { notifyEdgeVerificationsUpdated } from './ipc.js'

let _tailProcess: ChildProcessWithoutNullStreams | null = null
let _buffer = ''

export function verifierContainerName(podName: string): string {
  return `${podName}-verifier`
}

export function startVerifierLogTail(
  podName: string = DEFAULT_LOCAL_VERIFY_POD_NAME,
): void {
  stopVerifierLogTail()
  const container = verifierContainerName(podName)
  console.log(`[EDGE_TIER] Tailing verifier logs: ${container}`)

  try {
    _tailProcess = spawn('podman', ['logs', '-f', '--tail', '20', container], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.warn('[EDGE_TIER] Failed to start verifier log tail:', (err as Error).message ?? err)
    return
  }

  _tailProcess.stdout.on('data', (chunk: Buffer) => {
    _buffer += chunk.toString('utf8')
    const lines = _buffer.split('\n')
    _buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (ingestVerifierLogLine(line)) {
        notifyEdgeVerificationsUpdated()
      }
    }
  })

  _tailProcess.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trim()
    if (text) console.warn(`[EDGE_TIER] verifier log stderr: ${text.slice(0, 200)}`)
  })

  _tailProcess.on('exit', (code) => {
    console.log(`[EDGE_TIER] Verifier log tail exited (${code ?? 'signal'})`)
    _tailProcess = null
  })
}

export function stopVerifierLogTail(): void {
  if (!_tailProcess) return
  try {
    _tailProcess.kill('SIGTERM')
  } catch {
    /* already stopped */
  }
  _tailProcess = null
  _buffer = ''
}

/** Test seam — inject log lines without podman. */
export function _ingestVerifierLogChunkForTest(text: string): void {
  _buffer += text
  const lines = _buffer.split('\n')
  _buffer = lines.pop() ?? ''
  for (const line of lines) {
    ingestVerifierLogLine(line)
  }
}

export function _resetVerifierLogTailerForTest(): void {
  stopVerifierLogTail()
  _buffer = ''
}
